import { describe, expect, test } from "vitest";

import { GameInfoEditError, MergeOrchestrator } from "../src/main/domain/index.js";
import { TEST_PATHS, buildOrchestrator } from "./helpers/orchestrator-doubles.js";
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
    // Se persistió en las entries del preset ACTIVO (P-30, Paso 4.5b: ya NO
    // en el manifest legado, ver `local-store.ts`).
    expect(h.store.updatePresetEntriesCalls).toEqual([{ id: "modsvs", entries: ENTRIES }]);
    expect(h.store.getPreset("modsvs")?.entries).toEqual(ENTRIES);
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
    // Instancia REAL de GameInfoEditError: así el chequeo `err instanceof
    // GameInfoEditError` de #failureFromError se ejercita de verdad (con un mock
    // duck-typed, instanceof daría false y el test pasaría por la rama genérica).
    const gameInfoErr = new GameInfoEditError("missing-search-paths", "no hay SearchPaths");
    h.gameInfo.throwOnEnsure(() => gameInfoErr);
    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("failure");
    // La rama `instanceof GameInfoEditError` produce este mensaje formateado
    // ESPECÍFICO (distinto de la rama genérica de #failureFromError).
    if (res.status === "failure") {
      expect(res.error).toBe(
        "No se pudo editar gameinfo.txt (missing-search-paths): no hay SearchPaths",
      );
      // No es de permisos: NO se propaga un addonId (esa rama sí lo haría).
      expect(res.addonId).toBeUndefined();
    }
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
    // El preset ACTIVO guardado tiene 111 con el NUEVO priorityOrder, sin
    // duplicar (P-30, Paso 4.5b: ya no el manifest legado).
    const saved = h.store.getPreset("modsvs")?.entries ?? [];
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
    expect(h.store.getPreset("modsvs")?.entries).toEqual(manifest);
    expect(h.mergeCalls[0]?.orderedAddons.map((a) => a.id)).toEqual(["111"]);
  });
});

// ---------------------------------------------------------------------------
// P-30, Paso 4.5b — applyActiveSet/addAddon/removeAddon operan sobre el
// preset ACTIVO (convergencia), no sobre un Active_Set global suelto.
// ---------------------------------------------------------------------------

describe("MergeOrchestrator — applyActiveSet/addAddon/removeAddon operan sobre el preset ACTIVO (P-30, Paso 4.5b)", () => {
  test("applyActiveSet materializa hacia la carpeta del preset ACTIVO, y solo actualiza SUS entries — no las de otro preset", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    const armas = h.store.createPreset("Armas", []);
    h.store.setActivePresetId(armas.id);

    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("success");
    // Fusiona hacia <gameRoot>\<idDeArmas>, no hacia modsvs.
    expect(h.fs.installDest).toBe(`${TEST_PATHS.gameRoot}\\${armas.id}\\pak01_dir.vpk`);
    // Se persistió en "Armas", el preset activo...
    expect(h.store.getPreset(armas.id)?.entries).toEqual(ENTRIES);
    // ...y el preset "modsvs" (Principal, no activo) NUNCA se tocó.
    expect(h.store.getPreset("modsvs")?.entries).toEqual([]);
    expect(h.store.updatePresetEntriesCalls).toEqual([{ id: armas.id, entries: ENTRIES }]);
  });

  test("cambiar el preset activo y volver a agregar un addon lo agrega al preset CORRECTO (el nuevo activo, no el anterior)", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    // "modsvs" (Principal) ya tiene un addon de antes.
    h.store.updatePresetEntries("modsvs", [{ addonId: "111", priorityOrder: 0 }]);
    const skins = h.store.createPreset("Skins", []);
    h.store.setActivePresetId(skins.id);

    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.addAddon("222", 0);

    expect(res.status).toBe("success");
    // "222" se agregó a "Skins" (el preset ahora activo)...
    expect(h.store.getPreset(skins.id)?.entries).toEqual([{ addonId: "222", priorityOrder: 0 }]);
    // ...y "modsvs" (el preset ANTERIOR) sigue con su addon original, intacto.
    expect(h.store.getPreset("modsvs")?.entries).toEqual([{ addonId: "111", priorityOrder: 0 }]);
  });

  test("sin ningún preset activo (edge case): falla definitivo, sin tocar nada", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.store.deletePreset("modsvs"); // deja getActivePresetId() en null (ver DECISIÓN 6)

    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("failure");
    if (res.status === "failure") {
      expect(res.error).toMatch(/preset activo/i);
    }
    expect(h.log).toEqual([]); // ni guard, ni scan, ni elevación: corta ANTES de todo eso.
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
    // CLAVE (FIX 1): la resolución ocurre ANTES de la elevación, así que un addon
    // faltante NO llega a disparar ensureCanWrite (no hay prompt UAC innecesario).
    expect(h.log).not.toContain("ensureCanWrite");
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

// ---------------------------------------------------------------------------
// switchActivePreset (P-30, Paso 3)
// ---------------------------------------------------------------------------

describe("MergeOrchestrator — switchActivePreset (P-30, Paso 3)", () => {
  test("éxito: fusiona en <gameRoot>\\<presetId> (no modsvs), gameinfo queda apuntando SOLO al nuevo y el puntero de activo se actualiza", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    const preset = h.store.createPreset("Armas", ENTRIES);
    h.store.setActivePresetId("preset-old"); // preset previamente activo, DISTINTO del destino

    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.switchActivePreset(preset.id);

    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.installedManifest).toEqual(ENTRIES);
    }

    // El destino de la fusión es la carpeta TÉCNICA del preset, hermana de
    // modsvs (<gameRoot>\<presetId>), nunca <gameRoot>\modsvs.
    const destFolder = `${TEST_PATHS.gameRoot}\\${preset.id}`;
    expect(h.fs.ensuredDirs).toContain(destFolder);
    expect(h.fs.installDest).toBe(`${destFolder}\\pak01_dir.vpk`);

    // gameinfo: UNA sola llamada que quita el preset ANTERIOR y asegura el
    // NUEVO (ver DECISIÓN 7 en game-info-editor.ts) — nunca dos escrituras.
    expect(h.gameInfo.switchCalls).toEqual([
      { gameInfoFile: TEST_PATHS.gameInfoFile, previous: "preset-old", next: preset.id },
    ]);

    // El puntero de activo se actualiza SOLO tras el éxito.
    expect(h.store.getActivePresetId()).toBe(preset.id);
  });

  test("switch hacia el preset YA activo: previous es null (nada que quitar)", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    const preset = h.store.createPreset("Armas", ENTRIES);
    h.store.setActivePresetId(preset.id); // ya era el activo

    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.switchActivePreset(preset.id);

    expect(res.status).toBe("success");
    expect(h.gameInfo.switchCalls).toEqual([
      { gameInfoFile: TEST_PATHS.gameInfoFile, previous: null, next: preset.id },
    ]);
  });

  test("presetId inexistente: fallo definitivo, SIN tocar gameinfo.txt, el puntero de activo ni el filesystem", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.store.setActivePresetId("preset-actual");

    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.switchActivePreset("preset-no-existe");

    expect(res.status).toBe("failure");
    if (res.status === "failure") {
      expect(res.error).toContain("preset-no-existe");
    }
    expect(h.gameInfo.switchCalls).toEqual([]);
    expect(h.store.getActivePresetId()).toBe("preset-actual");
    expect(h.fs.ensuredDirs).toEqual([]);
    expect(h.log).toEqual([]);
  });

  test("fallo A MITAD DE CAMINO (instalación) NO deja el puntero actualizado ni llega a tocar gameinfo.txt", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    const preset = h.store.createPreset("Armas", ENTRIES);
    h.store.setActivePresetId("preset-old");
    h.fs.throwOnInstall(() => errno("ENOSPC")); // no es error de permisos -> already-writable -> fallo definitivo

    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.switchActivePreset(preset.id);

    expect(res.status).toBe("failure");
    // El fallo ocurrió ANTES del paso de gameinfo: switchFolderEntry NUNCA se
    // llamó, así que gameinfo.txt sigue mostrando exactamente lo que tenía
    // antes (el preset ANTERIOR) — nunca queda con cero ni con dos presets.
    expect(h.gameInfo.switchCalls).toEqual([]);
    // El puntero de activo NO se adelanta ante un fallo.
    expect(h.store.getActivePresetId()).toBe("preset-old");
  });

  test("fallo A MITAD DE CAMINO (el propio paso de gameinfo) NO deja el puntero actualizado", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    const preset = h.store.createPreset("Armas", ENTRIES);
    h.store.setActivePresetId("preset-old");
    h.gameInfo.throwOnEnsure(() => new Error("fallo simulado en gameinfo"));

    const orch = new MergeOrchestrator(h.deps);
    const res = await orch.switchActivePreset(preset.id);

    expect(res.status).toBe("failure");
    // Se INTENTÓ (es el paso que falló), pero el puntero de activo sigue
    // siendo el preset ANTERIOR: un fallo acá nunca lo adelanta. La
    // atomicidad de la escritura en sí (que el archivo en disco nunca quede a
    // medio transformar) la prueba game-info-editor.test.ts directamente.
    expect(h.gameInfo.switchCalls).toHaveLength(1);
    expect(h.store.getActivePresetId()).toBe("preset-old");
  });
});