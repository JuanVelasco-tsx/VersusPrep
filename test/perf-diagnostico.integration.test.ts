/**
 * HARNESS DE MEDICIÓN DE RENDIMIENTO (test de INTEGRACIÓN, skippeable).
 *
 * Recrea el harness usado en el diagnóstico previo para medir el costo real de
 * las operaciones de fusión del `MergeOrchestrator` contra `vpk.exe` REAL, con
 * una Workshop sintética de 35 .vpk. Se corren los MISMOS 3 casos que en el
 * diagnóstico previo, ahora CON las optimizaciones ya aplicadas, para tener
 * números DESPUÉS comparables con los de ANTES.
 *
 * NO es un test de aserciones (no valida comportamiento): es una herramienta de
 * MEDICIÓN. Escribe su reporte por `console.log` Y por `appendFileSync` a
 * RESULTS_FILE (`test/perf-resultados.txt`, junto a este archivo - portable,
 * no una ruta de una máquina en particular), que se SOBRESCRIBE al inicio del
 * `beforeAll` (`writeFileSync`) para que contenga SOLO los números de esta
 * corrida. Excluido de git (ver `.gitignore`, `perf-resultados.txt`).
 *
 * SKIPPEABLE: solo corre si `vpk.exe` existe en la ruta conocida
 * ({@link VPK_EXE_PATH}); si no, se SALTA con `describe.skip` (otra máquina/CI).
 *
 * Qué cambió en el código (qué esperar):
 *   1. `MergeOrchestrator.#resolveOrderedAddons` ya NO llama `AddonScanner.scan()`
 *      completo: usa `AddonScanner.resolveByIds(...)` (deriva vpkPath + exists por
 *      candidato, sin `vpk l` ni recorrer toda la Workshop) => la fase "scan" debe
 *      caer de ~750-790ms a casi nada y desaparecer el `vpk l` duplicado.
 *   2. `MergeEngine.merge` extrae con POOL de concurrencia (DEFAULT_VPK_CONCURRENCY=4),
 *      no serial => la fase "merge" debe bajar por ~4x.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, test } from "vitest";

import Database from "better-sqlite3";

import {
  AddonScanner,
  BackupManager,
  CollisionResolver,
  GameInfoEditor,
  MergeEngine,
  MergeOrchestrator,
  ProcessGuard,
  SqliteLocalStore,
  VpkTool,
} from "../src/main/domain/index.js";
import type {
  AddonManifestEntry,
  CommandResult,
  CommandRunner,
  CommandRunOptions,
  ElevationOutcome,
  ElevationService,
  GamePaths,
  MergeProgressEvent,
  ProcessListProvider,
} from "../src/main/domain/index.js";
import { ChildProcessCommandRunner } from "../src/main/data/child-process-command-runner.js";
import { RealAddonFileSystem } from "../src/main/data/addon-file-system.js";
import { RealBackupFileSystem } from "../src/main/data/backup-file-system.js";
import { RealCollisionFileSystem } from "../src/main/data/collision-file-system.js";
import { RealGameInfoFileSystem } from "../src/main/data/game-info-file-system.js";
import { RealMergeFileSystem } from "../src/main/data/merge-file-system.js";
import { RealMergeOrchestratorFileSystem } from "../src/main/data/merge-orchestrator-file-system.js";
import { VPK_EXE_PATH } from "./helpers/vpk-fixtures.js";

// `vpk.exe` disponible ⇒ corre; ausente ⇒ se salta toda la suite.
const VPK_AVAILABLE = existsSync(VPK_EXE_PATH);
const suite = VPK_AVAILABLE ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Constantes del harness (idénticas al diagnóstico previo).
// ---------------------------------------------------------------------------
const ADDON_COUNT = 35;
const FILES_PER_ADDON = 40;
const ADDON_ID_BASE = 300_000_000;
// Portable: junto a este archivo, no una ruta de una máquina en particular
// (bug reportado tras el merge de kiro/perf-diagnostico - la ruta original,
// `C:\kiro-perf-diag\...`, solo existía en esa máquina y rompía el test en
// cualquier otra). Bajo ESM (`module: NodeNext`) no hay `__dirname`, así que
// se deriva desde `import.meta.url`, mismo criterio que `HELPER_DIR` en
// `test/helpers/vpk-fixtures.ts`.
const RESULTS_FILE = join(dirname(fileURLToPath(import.meta.url)), "perf-resultados.txt");

// Paths internos COMPARTIDOS entre todos los addons (para forzar colisiones).
const SHARED_COLLISION_PATHS = Array.from(
  { length: 5 },
  (_, i) => `materials/shared/common_${i}.vmt`,
);

// ---------------------------------------------------------------------------
// SpyCommandRunner: envuelve ChildProcessCommandRunner y mide performance.now()
// por invocación, clasificando por args[0] ("l"=list, "x"=extract, else=pack).
// ---------------------------------------------------------------------------
interface VpkStat {
  count: number;
  ms: number;
}
interface VpkStats {
  list: VpkStat;
  extract: VpkStat;
  pack: VpkStat;
}

class SpyCommandRunner implements CommandRunner {
  readonly stats: VpkStats = {
    list: { count: 0, ms: 0 },
    extract: { count: 0, ms: 0 },
    pack: { count: 0, ms: 0 },
  };
  readonly #inner: CommandRunner;

  constructor(inner: CommandRunner) {
    this.#inner = inner;
  }

  reset(): void {
    this.stats.list = { count: 0, ms: 0 };
    this.stats.extract = { count: 0, ms: 0 };
    this.stats.pack = { count: 0, ms: 0 };
  }

  async run(
    executable: string,
    args: readonly string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult> {
    const start = performance.now();
    try {
      return await this.#inner.run(executable, args, options);
    } finally {
      const elapsed = performance.now() - start;
      const kind = args[0] === "l" ? "list" : args[0] === "x" ? "extract" : "pack";
      this.stats[kind].count += 1;
      this.stats[kind].ms += elapsed;
    }
  }
}

// ---------------------------------------------------------------------------
// phaseDurations: deriva duración por fase desde los eventos onProgress. La
// duración de la fase del evento i es (t[i+1] - t[i]); la última fase va hasta
// `endTime`. Si un step se repite, se acumula.
// ---------------------------------------------------------------------------
interface PhaseSample {
  step: MergeProgressEvent["step"];
  t: number;
}

function phaseDurations(
  samples: readonly PhaseSample[],
  endTime: number,
): Map<string, number> {
  const durations = new Map<string, number>();
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i]!;
    const next = i + 1 < samples.length ? samples[i + 1]!.t : endTime;
    const delta = next - cur.t;
    durations.set(cur.step, (durations.get(cur.step) ?? 0) + delta);
  }
  return durations;
}

// ---------------------------------------------------------------------------
// Dobles mínimos: juego nunca corriendo + elevación siempre ya-escribible.
// ---------------------------------------------------------------------------
const NEVER_RUNNING: ProcessListProvider = {
  listRunningProcessNames(): Promise<string[]> {
    return Promise.resolve([]);
  },
};

const ALWAYS_WRITABLE: ElevationService = {
  isElevated: () => true,
  needsElevation: async () => false,
  ensureCanWrite: async (): Promise<ElevationOutcome> => ({ kind: "already-writable" }),
  handleWriteFailure: async (): Promise<ElevationOutcome> => ({ kind: "already-writable" }),
  relaunchElevated: async (): Promise<ElevationOutcome> => ({ kind: "already-writable" }),
  isProtectedPath: () => false,
};

// ---------------------------------------------------------------------------
// Utilidades de reporte.
// ---------------------------------------------------------------------------
function fmt(ms: number): string {
  return `${Math.round(ms)}ms`;
}

function reportLines(lines: string[]): void {
  const block = lines.join("\n");
  // eslint-disable-next-line no-console
  console.log(block);
  appendFileSync(RESULTS_FILE, `${block}\n\n`, "utf8");
}

function phaseLines(durations: Map<string, number>): string[] {
  // Orden estable de las fases del orquestador.
  const order: MergeProgressEvent["step"][] = [
    "guard",
    "scan",
    "elevation",
    "restarting",
    "backup",
    "merge",
    "install",
    "gameinfo",
    "saveManifest",
    "done",
    "failed",
  ];
  const out: string[] = [];
  for (const step of order) {
    if (durations.has(step)) {
      out.push(`fase ${step}: ${fmt(durations.get(step)!)}`);
    }
  }
  return out;
}

function vpkLine(stats: VpkStats): string {
  return (
    `vpk invocaciones: ` +
    `list=${stats.list.count} (${fmt(stats.list.ms)}), ` +
    `extract=${stats.extract.count} (${fmt(stats.extract.ms)}), ` +
    `pack=${stats.pack.count} (${fmt(stats.pack.ms)})`
  );
}

// ---------------------------------------------------------------------------
// Suite.
// ---------------------------------------------------------------------------
suite("Diagnóstico de rendimiento DESPUÉS de optimizaciones (35 addons)", () => {
  // Directorios temporales a limpiar.
  const tempDirs: string[] = [];
  let db: Database.Database;

  // Estado compartido del setup.
  let orchestrator: MergeOrchestrator;
  let localStore: SqliteLocalStore;
  let spy: SpyCommandRunner;
  let addonIds: string[];
  // Buffer de eventos de progreso (compartido; se resetea por caso).
  let phases: PhaseSample[] = [];

  beforeAll(async () => {
    // Sobrescribir el archivo de resultados: SOLO los números de esta corrida.
    writeFileSync(
      RESULTS_FILE,
      `# Resultados de rendimiento DESPUÉS de optimizaciones — ${new Date().toISOString()}\n\n`,
      "utf8",
    );

    const realRunner = new ChildProcessCommandRunner();
    spy = new SpyCommandRunner(realRunner);
    const vpkTool = new VpkTool(spy, VPK_EXE_PATH);
    // Un VpkTool con el runner REAL (sin spy) para GENERAR los fixtures, así el
    // spy no contamina sus mediciones con el empaquetado de setup.
    const setupVpkTool = new VpkTool(realRunner, VPK_EXE_PATH);

    // Raíces temporales.
    const workshopFolder = mkdtempSync(join(tmpdir(), "l4d2-perf-workshop-"));
    const gameRoot = mkdtempSync(join(tmpdir(), "l4d2-perf-gameroot-"));
    const scanTempDir = mkdtempSync(join(tmpdir(), "l4d2-perf-scan-"));
    const workRoot = mkdtempSync(join(tmpdir(), "l4d2-perf-work-"));
    const buildDir = mkdtempSync(join(tmpdir(), "l4d2-perf-build-"));
    tempDirs.push(workshopFolder, gameRoot, scanTempDir, workRoot, buildDir);

    // -----------------------------------------------------------------------
    // Generar la Workshop sintética: ADDON_COUNT .vpk reales con vpk.exe.
    // Cada addon: ~FILES_PER_ADDON archivos dummy en materials/models/sound +
    // los SHARED_COLLISION_PATHS (para forzar colisiones entre addons).
    // -----------------------------------------------------------------------
    addonIds = [];
    for (let a = 0; a < ADDON_COUNT; a++) {
      const addonId = String(ADDON_ID_BASE + a);
      addonIds.push(addonId);
      const src = join(buildDir, addonId);

      const subdirs = ["materials", "models", "sound"] as const;
      for (let f = 0; f < FILES_PER_ADDON; f++) {
        const sub = subdirs[f % subdirs.length]!;
        const rel = join(sub, `dummy_${String(f).padStart(3, "0")}.bin`);
        const abs = join(src, rel);
        mkdirSync(join(src, sub), { recursive: true });
        writeFileSync(abs, `addon ${addonId} file ${f}\n`.repeat(4), "utf8");
      }
      // Paths compartidos (colisiones): contenido DISTINTO por addon.
      for (const shared of SHARED_COLLISION_PATHS) {
        const abs = join(src, ...shared.split("/"));
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, `shared ${shared} from addon ${addonId}\n`, "utf8");
      }

      // Empaquetar y renombrar a <workshop>/<id>.vpk.
      const packed = await setupVpkTool.pack(src, `fixture:${addonId}`);
      const dest = join(workshopFolder, `${addonId}.vpk`);
      rmSync(dest, { force: true });
      // Mover el .vpk empaquetado a la Workshop.
      // (renameSync puede fallar entre volúmenes; ambos están en tmpdir, mismo volumen).
      const { renameSync } = await import("node:fs");
      renameSync(packed, dest);
    }

    // -----------------------------------------------------------------------
    // gameRoot temporal con gameinfo.txt (bloque SearchPaths válido, EOL CRLF).
    // -----------------------------------------------------------------------
    const left4dead2Dir = join(gameRoot, "left4dead2");
    mkdirSync(left4dead2Dir, { recursive: true });
    const gameInfoFile = join(left4dead2Dir, "gameinfo.txt");
    const CRLF = "\r\n";
    const gameInfoContent = [
      '"GameInfo"',
      "{",
      "\tFileSystem",
      "\t{",
      "\t\tSearchPaths",
      "\t\t{",
      "\t\t\tGame\tupdate",
      "\t\t\tGame\tleft4dead2_dlc3",
      "\t\t\tGame\tleft4dead2",
      "\t\t\tGame\thl2",
      "\t\t}",
      "\t}",
      "}",
      "",
    ].join(CRLF);
    writeFileSync(gameInfoFile, gameInfoContent, "utf8");

    // GamePaths completo.
    const paths: GamePaths = {
      steamPath: gameRoot,
      gameRoot,
      left4dead2Dir,
      workshopFolder,
      vpkToolPath: VPK_EXE_PATH,
      gameInfoFile,
      modsvsFolder: join(gameRoot, "modsvs"),
    };

    // -----------------------------------------------------------------------
    // Ensamblar el dominio REAL.
    // -----------------------------------------------------------------------
    const addonScanner = new AddonScanner(new RealAddonFileSystem(), vpkTool, scanTempDir);
    const mergeEngine = new MergeEngine(
      vpkTool,
      new RealMergeFileSystem(),
      new CollisionResolver(new RealCollisionFileSystem()),
    );
    const backupManager = new BackupManager(new RealBackupFileSystem());
    const gameInfoEditor = new GameInfoEditor(new RealGameInfoFileSystem());
    db = new Database(":memory:");
    localStore = new SqliteLocalStore(db);
    const processGuard = new ProcessGuard(NEVER_RUNNING);

    orchestrator = new MergeOrchestrator({
      processGuard,
      elevationService: ALWAYS_WRITABLE,
      backupManager,
      mergeEngine,
      gameInfoEditor,
      localStore,
      addonScanner,
      fs: new RealMergeOrchestratorFileSystem(),
      paths,
      workRoot,
      onProgress: (e) => phases.push({ step: e.step, t: performance.now() }),
    });

    localStore.savePaths(paths);

    // Confirmar preset activo "modsvs" (la migración de SqliteLocalStore lo
    // siembra; por si acaso, fijarlo si quedó null).
    if (localStore.getActivePresetId() === null) {
      localStore.setActivePresetId("modsvs");
    }
  }, 300_000);

  afterAll(() => {
    db?.close();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Entradas de manifiesto a partir de ids, con priorityOrder ascendente. */
  function entriesOf(ids: readonly string[]): AddonManifestEntry[] {
    return ids.map((addonId, index) => ({ addonId, priorityOrder: index }));
  }

  // -------------------------------------------------------------------------
  // CASO 1: switch a preset vacío.
  // -------------------------------------------------------------------------
  test(
    "CASO 1: switch a preset vacío",
    async () => {
      spy.reset();
      phases = [];

      const tCreateStart = performance.now();
      const created = localStore.createPreset("perf-test-vacio", []);
      const createMs = performance.now() - tCreateStart;

      const tSwitchStart = performance.now();
      await orchestrator.switchActivePreset(created.id);
      const tSwitchEnd = performance.now();
      const switchMs = tSwitchEnd - tSwitchStart;

      const durations = phaseDurations(phases, tSwitchEnd);

      reportLines([
        "=== CASO 1: switch a preset vacío ===",
        `createPreset: ${fmt(createMs)}`,
        `switchActivePreset (total): ${fmt(switchMs)}`,
        ...phaseLines(durations),
        vpkLine(spy.stats),
      ]);
    },
    300_000,
  );

  // -------------------------------------------------------------------------
  // CASO 2: switch A=10 -> B=15 (viniendo de A).
  // -------------------------------------------------------------------------
  test(
    "CASO 2: switch A(10) -> B(15)",
    async () => {
      const presetA = localStore.createPreset("perf-test-A", entriesOf(addonIds.slice(0, 10)));
      const presetB = localStore.createPreset("perf-test-B", entriesOf(addonIds.slice(0, 15)));

      // Llevar el estado a A: aplicar A, B, y volver a A.
      await orchestrator.switchActivePreset(presetA.id);
      await orchestrator.switchActivePreset(presetB.id);
      await orchestrator.switchActivePreset(presetA.id);

      // MEDIR: switch B viniendo de A.
      spy.reset();
      phases = [];
      const tStart = performance.now();
      await orchestrator.switchActivePreset(presetB.id);
      const tEnd = performance.now();
      const totalMs = tEnd - tStart;

      const durations = phaseDurations(phases, tEnd);

      reportLines([
        "=== CASO 2: switch A(10 addons) -> B(15 addons) ===",
        `switchActivePreset (total): ${fmt(totalMs)}`,
        ...phaseLines(durations),
        vpkLine(spy.stats),
      ]);
    },
    300_000,
  );

  // -------------------------------------------------------------------------
  // CASO 3: applyActiveSet con los 35 addons.
  // -------------------------------------------------------------------------
  test(
    "CASO 3: applyActiveSet 35 addons",
    async () => {
      // Asegurar preset activo "modsvs" antes de applyActiveSet.
      if (localStore.getActivePresetId() !== "modsvs") {
        localStore.setActivePresetId("modsvs");
      }

      spy.reset();
      phases = [];
      const tStart = performance.now();
      await orchestrator.applyActiveSet(entriesOf(addonIds));
      const tEnd = performance.now();
      const totalMs = tEnd - tStart;

      const durations = phaseDurations(phases, tEnd);

      reportLines([
        "=== CASO 3: applyActiveSet 35 addons ===",
        `applyActiveSet (total): ${fmt(totalMs)}`,
        ...phaseLines(durations),
        vpkLine(spy.stats),
      ]);
    },
    300_000,
  );
});
