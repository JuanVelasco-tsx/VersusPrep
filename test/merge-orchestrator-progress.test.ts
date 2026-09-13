import { describe, expect, test } from "vitest";

import { MergeOrchestrator } from "../src/main/domain/index.js";
import { buildOrchestrator } from "./helpers/orchestrator-doubles.js";
import type {
  AddonManifestEntry,
  MergeProgressEvent,
} from "../src/main/domain/index.js";

/**
 * Tests del canal de progreso OPCIONAL del MergeOrchestrator (campo aditivo
 * `onProgress` de MergeOrchestratorDeps). Verifican:
 *   1. Que un applyActiveSet exitoso emite los pasos en el orden EXACTO.
 *   2. Que SIN onProgress el comportamiento es idéntico (no revienta).
 *   3. Que resumePendingOperation emite la secuencia sin "guard" ni "elevation".
 *
 * El canal de progreso es un array separado del `log` cronológico del harness
 * (que registra otras cosas); acá se captura con un listener propio inyectado en
 * `deps.onProgress`.
 */

const ENTRIES: AddonManifestEntry[] = [
  { addonId: "111", priorityOrder: 0 },
  { addonId: "222", priorityOrder: 1 },
];
const SCANNED = ["111", "222"];

/** Captura los `step` emitidos, en orden de emisión. */
function progressCollector(): { steps: MergeProgressEvent["step"][]; onProgress: (e: MergeProgressEvent) => void } {
  const steps: MergeProgressEvent["step"][] = [];
  return { steps, onProgress: (e) => steps.push(e.step) };
}

describe("MergeOrchestrator — progreso (canal aditivo onProgress)", () => {
  test("applyActiveSet exitoso emite los pasos en el orden exacto", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.backupFs.existing = true; // hay un pak01_dir.vpk que respaldar
    const p = progressCollector();
    const orch = new MergeOrchestrator({ ...h.deps, onProgress: p.onProgress });

    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("success");
    // NOTA (BUG-009): el step "backup" aparece DOS veces consecutivas. El fix
    // agregó un `ensureDir(modsvsFolder)` reactivo ANTES del backup real, y ese
    // paso reutiliza el mismo `#emit("backup")` (comparte el manejo reactivo con
    // el backup). Así, la secuencia observable emite "backup" (creación de modsvs)
    // seguido de "backup" (respaldo del pak01 previo). Es un artefacto conocido
    // del fix; el aserto refleja el comportamiento REAL del código.
    expect(p.steps).toEqual([
      "guard",
      "scan",
      "elevation",
      "backup",
      "backup",
      "merge",
      "install",
      "gameinfo",
      "saveManifest",
      "done",
    ]);
  });

  test("SIN onProgress el comportamiento es idéntico (no emite, no revienta)", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.backupFs.existing = true;
    // deps NO trae onProgress; se construye tal cual.
    const orch = new MergeOrchestrator(h.deps);

    const res = await orch.applyActiveSet(ENTRIES);

    // Mismo resultado que el camino feliz de siempre.
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.installedManifest).toEqual(ENTRIES);
    }
    // El flujo materializó igual (orden de operaciones intacto en el log del harness).
    expect(h.log).toEqual([
      "ensureCanWrite",
      "backup",
      "install",
      "gameinfo",
      "saveManifest",
    ]);
  });

  test("UAC denegado emite 'failed' ANTES de retornar status:failure (P-26)", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.elevation.ensureCanWriteOutcome = { kind: "denied", reason: "El usuario canceló el UAC." };
    const p = progressCollector();
    const orch = new MergeOrchestrator({ ...h.deps, onProgress: p.onProgress });

    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("failure");
    // Antes de P-26 la secuencia terminaba en "elevation" sin ningún step
    // terminal: el renderer no tenía forma de detectar por este canal que la
    // operación fallida había terminado.
    expect(p.steps).toEqual(["guard", "scan", "elevation", "failed"]);
  });

  test("catch de VpkToolError en el merge emite 'failed' ANTES de retornar status:failure (P-26)", async () => {
    const h = buildOrchestrator({ scannedIds: SCANNED });
    h.backupFs.existing = true;
    h.mergeEngine.throwOnMerge(() => Object.assign(new Error("vpk x fallo"), { addonId: "222" }));
    const p = progressCollector();
    const orch = new MergeOrchestrator({ ...h.deps, onProgress: p.onProgress });

    const res = await orch.applyActiveSet(ENTRIES);

    expect(res.status).toBe("failure");
    if (res.status === "failure") {
      expect(res.addonId).toBe("222");
    }
    // "failed" reemplaza el silencio previo: antes de P-26 la secuencia
    // terminaba en "merge" sin señalizar el fallo por este canal.
    expect(p.steps).toEqual(["guard", "scan", "elevation", "backup", "backup", "merge", "failed"]);
  });

  test("resumePendingOperation emite la secuencia sin 'guard' ni 'elevation'", async () => {
    const pending: AddonManifestEntry[] = [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ];
    const h = buildOrchestrator({ pendingSession: pending, scannedIds: SCANNED });
    const p = progressCollector();
    const orch = new MergeOrchestrator({ ...h.deps, onProgress: p.onProgress });

    const res = await orch.resumePendingOperation();

    expect(res?.status).toBe("success");
    // El resume NO chequea ProcessGuard (sin "guard") ni re-eleva (sin "elevation").
    // NOTA (BUG-009): "backup" aparece DOS veces por el mismo motivo que en el
    // applyActiveSet: el `ensureDir(modsvsFolder)` reactivo del fix emite "backup"
    // antes del respaldo real. Artefacto conocido del fix; se aserta el real.
    expect(p.steps).toEqual([
      "scan",
      "backup",
      "backup",
      "merge",
      "install",
      "gameinfo",
      "saveManifest",
      "done",
    ]);
  });
});