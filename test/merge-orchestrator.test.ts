import { describe, expect, test } from "vitest";

import { MergeOrchestrator } from "../src/main/domain/index.js";
import { buildOrchestrator } from "./helpers/orchestrator-doubles.js";
import type { AddonManifestEntry } from "../src/main/domain/index.js";

/**
 * Unit tests de la Sección 18 (Tarea 18.4): orden y precondiciones del
 * MergeOrchestrator. Se inyectan dobles en memoria (ver `helpers/orchestrator-doubles.ts`)
 * y se verifica el ORDEN cronológico de operaciones vía un log compartido, más
 * los cortes por precondición y el manejo reactivo de permisos. Complementan (no
 * reemplazan) el property test 18.3 (Property 13).
 */

const ENTRIES: AddonManifestEntry[] = [
  { addonId: "111", priorityOrder: 0 },
  { addonId: "222", priorityOrder: 1 },
];
const SCANNED = ["111", "222"];

function errno(code: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`simulado ${code}`);
  e.code = code;
  return e;
}

describe("MergeOrchestrator — precondición del juego (Req 4.1, 4.2)", () => {
  test("aborta si el juego está corriendo, sin tocar nada más", async () => {
    const h = buildOrchestrator({ gameRunning: true, scannedIds: SCANNED });
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);
    expect(res.status).toBe("failure");
    if (res.status === "failure") expect(res.error).toContain("left4dead2.exe");
    // No se llamó a elevación, ni merge, ni ninguna escritura.
    expect(h.log).toEqual([]);
    expect(h.mergeCalls.length).toBe(0);
  });
});

describe("MergeOrchestrator — orden del camino feliz", () => {
  test("backup -> merge -> instalar -> gameinfo -> manifest, en ese orden", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.backupFs.existing = true; // hay un pak01_dir.vpk que respaldar
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.installedManifest).toEqual(ENTRIES);
    }
    // El log cronológico prueba el orden exacto (merge no escribe en log; se
    // verifica su posición por los pasos que lo rodean).
    expect(h.log).toEqual([
      "ensureCanWrite",
      "backup",
      "install",
      "gameinfo",
      "saveManifest",
    ]);
    // merge se llamó una vez, con los addons en orden ascendente.
    expect(h.mergeCalls.length).toBe(1);
    expect(h.mergeCalls[0]?.orderedAddons.map((a) => a.id)).toEqual(["111", "222"]);
    // Se persistió el manifest final.
    expect(h.store.savedManifest).toEqual(ENTRIES);
  });
});

describe("MergeOrchestrator — aborto por backup fallido (Req 5.2)", () => {
  test("backup falla (no-permisos) -> fallo definitivo sin llamar a merge", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.backupFs.existing = true;
    h.backupFs.throwOnCopy(() => errno("ENOSPC")); // no es de permisos
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("failure");
    // El backup pasó por handleWriteFailure (already-writable) y NO se llamó a merge.
    expect(h.log).toEqual(["ensureCanWrite", "backup", "handleWriteFailure"]);
    expect(h.mergeCalls.length).toBe(0);
    // workDir se limpió igual (finally).
    expect(h.fs.removedDirs.length).toBe(1);
  });
});

describe("MergeOrchestrator — manejo reactivo de EACCES/EPERM en cada paso", () => {
  const steps: Array<{
    name: string;
    arm: (h: ReturnType<typeof buildOrchestrator>) => void;
  }> = [
    {
      name: "backup",
      arm: (h) => {
        h.backupFs.existing = true;
        h.backupFs.throwOnCopy(() => errno("EACCES"));
      },
    },
    {
      name: "install",
      arm: (h) => h.fs.throwOnInstall(() => errno("EPERM")),
    },
    {
      name: "gameinfo",
      arm: (h) => h.gameInfo.throwOnEnsure(() => errno("EACCES")),
    },
  ];

  for (const step of steps) {
    test(`${step.name}: EACCES/EPERM + elevated-handoff -> status "elevating"`, async () => {
      const h = buildOrchestrator({ scannedIds: SCANNED });
      h.elevation.handleWriteFailureOutcome = { kind: "elevated-handoff" };
      step.arm(h);
      const orch = new MergeOrchestrator(h.deps);
      const res = await orch.applyActiveSet(ENTRIES);
      expect(res.status).toBe("elevating");
      expect(h.log).toContain("handleWriteFailure");
      expect(h.fs.removedDirs.length).toBe(1); // limpieza incluso en elevación
    });

    test(`${step.name}: EACCES/EPERM + UAC cancelado (denied) -> fallo definitivo`, async () => {
      const h = buildOrchestrator({ scannedIds: SCANNED });
      h.elevation.handleWriteFailureOutcome = { kind: "denied", reason: "cancelado" };
      step.arm(h);
      const orch = new MergeOrchestrator(h.deps);
      const res = await orch.applyActiveSet(ENTRIES);
      expect(res.status).toBe("failure");
      if (res.status === "failure") expect(res.error).toContain("UAC");
      expect(h.log).toContain("handleWriteFailure");
    });
  }
});

describe("MergeOrchestrator — GameInfoEditError no-permisos NO eleva (Req 6.10)", () => {
  test("SearchPaths ausente -> fallo definitivo sin disparar elevación", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    // GameInfoEditError se importa indirectamente; simulamos un error con name.
    const gameInfoErr = Object.assign(new Error("no hay SearchPaths"), {
      name: "GameInfoEditError",
      reason: "missing-search-paths" as const,
    });
    h.gameInfo.throwOnEnsure(() => gameInfoErr);
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("failure");
    // handleWriteFailure se invoca (el paso está envuelto) pero devuelve
    // already-writable porque el error no es de permisos -> se propaga.
    expect(h.log).toContain("gameinfo");
    expect(h.log).toContain("handleWriteFailure");
  });
});

describe("MergeOrchestrator — ensureCanWrite proactivo corta antes de backup", () => {
  test("elevated-handoff proactivo -> status 'elevating' sin llegar a backup", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.elevation.ensureCanWriteOutcome = { kind: "elevated-handoff" };
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);
    expect(res.status).toBe("elevating");
    // Solo se llamó a ensureCanWrite; nunca backup/merge/instalar.
    expect(h.log).toEqual(["ensureCanWrite"]);
    expect(h.mergeCalls.length).toBe(0);
  });

  test("denied proactivo -> fallo definitivo por UAC cancelado", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.elevation.ensureCanWriteOutcome = { kind: "denied", reason: "cancelado" };
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);
    expect(res.status).toBe("failure");
    if (res.status === "failure") expect(res.error).toContain("UAC");
    expect(h.log).toEqual(["ensureCanWrite"]);
  });
});

describe("MergeOrchestrator — resolución add/remove (DECISIÓN 4)", () => {
  test("addAddon sobre un addonId ya presente actualiza su priorityOrder (upsert)", async () => {
    const manifest: AddonManifestEntry[] = [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ];
    const h = buildOrchestrator({ installedManifest: manifest, scannedIds: SCANNED });
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.addAddon("111", 9); // reubica 111 al final
    expect(res.status).toBe("success");
    // El manifest guardado tiene 111 con el NUEVO priorityOrder, sin duplicar.
    const saved = h.store.savedManifest ?? [];
    expect(saved.filter((e) => e.addonId === "111").length).toBe(1);
    expect(saved.find((e) => e.addonId === "111")?.priorityOrder).toBe(9);
    // El orden pasado a merge (ascendente): 222 (1) antes que 111 (9).
    expect(h.mergeCalls[0]?.orderedAddons.map((a) => a.id)).toEqual(["222", "111"]);
  });

  test("removeAddon sobre un addonId ausente es no-op (éxito, sin cambiar el set)", async () => {
    const manifest: AddonManifestEntry[] = [{ addonId: "111", priorityOrder: 0 }];
    const h = buildOrchestrator({ installedManifest: manifest, scannedIds: SCANNED });
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.removeAddon("999"); // no está
    expect(res.status).toBe("success");
    expect(h.store.savedManifest).toEqual(manifest);
    expect(h.mergeCalls[0]?.orderedAddons.map((a) => a.id)).toEqual(["111"]);
  });
});

describe("MergeOrchestrator — addon candidato ausente del escaneo (DECISIÓN 5)", () => {
  test("un addonId candidato que no está en la Workshop -> fallo con ese addonId", async () => {
    // Escaneo solo tiene 111; el candidato pide 111 y 333.
    const h = buildOrchestrator({ scannedIds: ["111"] });
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet([
      { addonId: "111", priorityOrder: 0 },
      { addonId: "333", priorityOrder: 1 },
    ]);
    expect(res.status).toBe("failure");
    if (res.status === "failure") expect(res.addonId).toBe("333");
    // Falló al resolver, antes de crear el workDir/backup: no hubo merge.
    expect(h.mergeCalls.length).toBe(0);
  });
});

describe("MergeOrchestrator — limpieza del workDir (P-14)", () => {
  test("se limpia en éxito", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);
    expect(res.status).toBe("success");
    expect(h.fs.removedDirs.length).toBe(1);
    // El dir removido es el mismo que se creó.
    expect(h.fs.ensuredDirs).toContain(h.fs.removedDirs[0]);
  });

  test("se limpia en fallo (merge lanza VpkToolError)", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    const vpkErr = Object.assign(new Error("vpk x falló"), { addonId: "222" });
    h.mergeEngine.throwOnMerge(() => vpkErr);
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);
    expect(res.status).toBe("failure");
    if (res.status === "failure") expect(res.addonId).toBe("222");
    expect(h.fs.removedDirs.length).toBe(1);
  });
});

describe("MergeOrchestrator — resumePendingOperation (Tarea 18.2)", () => {
  test("devuelve null si no hay sesión pendiente", async () => {
    const h = buildOrchestrator({ pendingSession: null, scannedIds: SCANNED });
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.resumePendingOperation();
    expect(res).toBeNull();
    // No hizo nada.
    expect(h.log).toEqual([]);
  });

  test("materializa SIN ensureCanWrite y limpia la sesión al terminar", async () => {
    const pending: AddonManifestEntry[] = [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ];
    const h = buildOrchestrator({ pendingSession: pending, scannedIds: SCANNED });
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.resumePendingOperation();
    expect(res).not.toBeNull();
    expect(res?.status).toBe("success");
    // NO se llamó a ensureCanWrite (la instancia elevada ya puede escribir).
    expect(h.log).not.toContain("ensureCanWrite");
    // Sí materializó (backup/install/gameinfo/manifest) y limpió la sesión al final.
    expect(h.log).toContain("saveManifest");
    expect(h.log[h.log.length - 1]).toBe("clearPendingSession");
    expect(h.store.getPendingSession()).toBeNull();
  });

  test("resume con candidato vacío ([]) aplica un Active_Set vacío y limpia la sesión", async () => {
    const h = buildOrchestrator({ pendingSession: [], scannedIds: SCANNED });
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.resumePendingOperation();
    expect(res?.status).toBe("success");
    // merge se llamó con 0 addons.
    expect(h.mergeCalls[0]?.orderedAddons.length).toBe(0);
    expect(h.log).toContain("clearPendingSession");
  });
});