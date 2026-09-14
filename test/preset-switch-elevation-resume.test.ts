import { describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

import {
  BackupManager,
  ElevationServiceImpl,
  MergeOrchestrator,
  PENDING_SESSION_HANDLE,
  ProcessGuard,
  SqliteLocalStore,
} from "../src/main/domain/index.js";
import type {
  ElevationOsProvider,
  MergeOrchestratorDeps,
  PendingOperation,
  ProcessListProvider,
  RelaunchOutcome,
} from "../src/main/domain/index.js";
import { parseResumeArgs } from "../src/main/app/composition-root.js";
import { buildRelaunchArgs } from "../src/main/data/elevation-os-provider.js";
import {
  FakeAddonScanner,
  FakeBackupFs,
  FakeGameInfoEditor,
  FakeMergeEngine,
  FakeOrchestratorFs,
  TEST_PATHS,
} from "./helpers/orchestrator-doubles.js";

/**
 * P-30, Paso 3.5 — cierra la DECISIÓN 8 de merge-orchestrator.ts.
 *
 * Antes de este paso, un `switchActivePreset` que disparaba elevación UAC
 * (relanzo, PROACTIVO o REACTIVO) resumía en la instancia elevada como un
 * `applyActiveSet` NORMAL, fusionando hacia `modsvs` en vez de hacia la
 * carpeta del preset — el switch se completaba MAL. Estos tests ejercitan el
 * flujo COMPLETO extremo a extremo, en ambas vías de elevación:
 *
 *   1. `switchActivePreset(presetId)` dispara elevación (proactiva o
 *      reactiva) -> `status: "elevating"`, con la `PendingOperation` REAL
 *      que `relaunchAsAdmin` recibió (capturada por el fake de SO),
 *      verificando que lleva `type: "switchActivePreset"` + `presetId`.
 *   2. Esa `PendingOperation` sobrevive el ROUND-TRIP real por argv
 *      (`buildRelaunchArgs` -> `parseResumeArgs`, el mecanismo real que
 *      cruza a la instancia elevada), no solo se asume en memoria.
 *   3. `resumePendingOperation(pending)` (simulando la instancia YA elevada,
 *      misma `LocalStore` real subyacente) completa el switch REAL: funde
 *      hacia `<gameRoot>\<presetId>` (NO `modsvs`), gameinfo.txt queda
 *      apuntando SOLO a esa carpeta (quitando la entrada del preset anterior
 *      que la migración de `SqliteLocalStore` había dejado activo), y el
 *      puntero de activo se actualiza.
 *
 * `LocalStore` (SQLite real en memoria) y `ElevationService` son REALES
 * (mismo criterio que `elevation-service.test.ts`); el resto de las
 * dependencias del orquestador son los dobles ya compartidos de
 * `orchestrator-doubles.ts`, reutilizados tal cual porque no son el foco de
 * estos tests.
 */

/**
 * ElevationOsProvider fake configurable: `canWriteDirectly` controla si
 * `probeWrite` dice que se puede escribir sin elevar (usado por el camino
 * PROACTIVO, `needsElevation`). Captura el `pending` que recibe
 * `relaunchAsAdmin`, sin importar por qué vía (proactiva o reactiva) se llegó ahí.
 */
class ConfigurableOsProvider implements ElevationOsProvider {
  capturedPending: PendingOperation | null = null;
  constructor(private readonly canWriteDirectly: boolean) {}
  isElevated(): boolean {
    return false;
  }
  probeWrite(): Promise<boolean> {
    return Promise.resolve(this.canWriteDirectly);
  }
  relaunchAsAdmin(pending: PendingOperation): Promise<RelaunchOutcome> {
    this.capturedPending = pending;
    return Promise.resolve("launched");
  }
}

/** ProcessListProvider fake: el juego nunca está corriendo. */
class GameNotRunningProvider implements ProcessListProvider {
  listRunningProcessNames(): Promise<string[]> {
    return Promise.resolve(["explorer.exe"]);
  }
}

/** Doblez de I/O compartidos por ambos tests, con LocalStore/ElevationService REALES. */
function buildHarness(osProvider: ElevationOsProvider) {
  const db: DatabaseType = new Database(":memory:");
  const store = new SqliteLocalStore(db);
  const elevation = new ElevationServiceImpl(osProvider, store);
  const processGuard = new ProcessGuard(new GameNotRunningProvider());
  const log: string[] = [];
  const mergeEngine = new FakeMergeEngine();
  const gameInfo = new FakeGameInfoEditor(log);
  const scanner = new FakeAddonScanner(["111", "222"]);
  const backupFs = new FakeBackupFs(log);
  const fs = new FakeOrchestratorFs(log);
  const backupManager = new BackupManager(backupFs);

  const deps: MergeOrchestratorDeps = {
    processGuard,
    elevationService: elevation,
    backupManager,
    mergeEngine: mergeEngine as unknown as MergeOrchestratorDeps["mergeEngine"],
    gameInfoEditor: gameInfo as unknown as MergeOrchestratorDeps["gameInfoEditor"],
    localStore: store,
    addonScanner: scanner as unknown as MergeOrchestratorDeps["addonScanner"],
    fs,
    paths: TEST_PATHS,
    workRoot: "C:\\work",
  };

  return { db, store, orch: new MergeOrchestrator(deps), fs, gameInfo };
}

describe("switchActivePreset + resumePendingOperation tras elevación UAC (P-30, Paso 3.5)", () => {
  test("elevación PROACTIVA (needsElevation): resume hacia la carpeta del preset correcto, no hacia modsvs", async () => {
    // canWriteDirectly = false -> needsElevation() da true -> ensureCanWrite
    // dispara la elevación PROACTIVA, antes de escribir nada.
    const osProvider = new ConfigurableOsProvider(false);
    const { db, store, orch, fs, gameInfo } = buildHarness(osProvider);

    // La migración de P-30 Paso 1 ya dejó un preset "Principal" ACTIVO al
    // construir el store (manifest vacío en ese momento). Se captura su id:
    // es el preset "ANTERIOR" que el switch debe quitar de gameinfo.txt al
    // completar el resume.
    const principalId = store.getActivePresetId();
    expect(principalId).not.toBeNull();

    const preset = store.createPreset("Armas", [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ]);

    // --- switchActivePreset dispara elevación (instancia SIN privilegios) ---
    const elevatingResult = await orch.switchActivePreset(preset.id);
    expect(elevatingResult).toEqual({ status: "elevating" });

    // La PendingOperation REAL que se le pasó a relaunchAsAdmin lleva el tipo
    // y el presetId correctos (antes de este paso, esto hubiera sido
    // { type: "applyActiveSet", resumeHandle } sin ningún presetId).
    expect(osProvider.capturedPending).toEqual({
      type: "switchActivePreset",
      resumeHandle: PENDING_SESSION_HANDLE,
      presetId: preset.id,
    });
    // El puntero de activo TODAVÍA no cambió: el switch no se completó.
    expect(store.getActivePresetId()).toBe(principalId);

    // --- La PendingOperation sobrevive el round-trip REAL por argv ---
    const argv = buildRelaunchArgs([], osProvider.capturedPending!);
    const parsed = parseResumeArgs(argv);
    expect(parsed).toEqual(osProvider.capturedPending);

    // --- Resume en la instancia "elevada" (misma LocalStore real) ---
    const result = await orch.resumePendingOperation(parsed ?? undefined);

    expect(result?.status).toBe("success");

    // Fusionó hacia <gameRoot>\<presetId>, NO hacia modsvs.
    const destFolder = `${TEST_PATHS.gameRoot}\\${preset.id}`;
    expect(fs.ensuredDirs).toContain(destFolder);
    expect(fs.installDest).toBe(`${destFolder}\\pak01_dir.vpk`);
    expect(fs.installDest).not.toContain("modsvs");

    // gameinfo.txt: UNA sola escritura que quita el preset ANTERIOR
    // (Principal, el que dejó activo la migración) y asegura el NUEVO.
    expect(gameInfo.switchCalls).toEqual([
      { gameInfoFile: TEST_PATHS.gameInfoFile, previous: principalId, next: preset.id },
    ]);

    // El puntero de activo se actualizó al preset destino.
    expect(store.getActivePresetId()).toBe(preset.id);
    // La sesión pendiente se limpió al terminar el resume.
    expect(store.getPendingSession()).toBeNull();

    db.close();
  });

  test("elevación REACTIVA (falla de permisos a mitad de #materialize): la PendingOperation también lleva type+presetId correctos", async () => {
    // canWriteDirectly = true -> el camino PROACTIVO da already-writable (no
    // relanza todavía); es la ESCRITURA REAL (instalar) la que falla con
    // EACCES, disparando handleWriteFailure (camino REACTIVO, item 5 del
    // pedido: confirmar que #writeStep arma el pending completo también).
    const osProvider = new ConfigurableOsProvider(true);
    const { db, store, orch, fs } = buildHarness(osProvider);
    fs.throwOnInstall(() => Object.assign(new Error("sin permiso"), { code: "EACCES" }));

    const preset = store.createPreset("Armas", [{ addonId: "111", priorityOrder: 0 }]);

    const result = await orch.switchActivePreset(preset.id);

    expect(result).toEqual({ status: "elevating" });
    // La PendingOperation construida por #writeStep (camino REACTIVO) lleva
    // el presetId igual que la del camino proactivo — sin el fix, #writeStep
    // seguía armando { type: "switchActivePreset", resumeHandle } SIN
    // presetId, y parseResumeArgs la hubiera rechazado por incompleta.
    expect(osProvider.capturedPending).toEqual({
      type: "switchActivePreset",
      resumeHandle: PENDING_SESSION_HANDLE,
      presetId: preset.id,
    });
    // El round-trip por argv también preserva el presetId acá.
    const argv = buildRelaunchArgs([], osProvider.capturedPending!);
    expect(parseResumeArgs(argv)).toEqual(osProvider.capturedPending);

    db.close();
  });
});
