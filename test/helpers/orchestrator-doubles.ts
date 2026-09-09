import type {
  AddonManifestEntry,
  ElevationOutcome,
  ElevationService,
  GameInfoEditResult,
  GamePaths,
  LocalStore,
  MergeOrchestratorDeps,
  MergeOrchestratorFileSystem,
  MergeReport,
  PendingOperation,
  ProcessListProvider,
  ScannedAddon,
} from "../../src/main/domain/index.js";
import {
  BackupManager,
  ProcessGuard,
} from "../../src/main/domain/index.js";

/**
 * Dobles en memoria COMPARTIDOS para los tests del MergeOrchestrator (Sección 18,
 * tareas 18.3 y 18.4). Todo el I/O real (disco, vpk.exe, procesos, UAC) se
 * sustituye por dobles inyectados; los dobles REGISTRAN un log cronológico de las
 * operaciones para poder verificar orden y precondiciones (mismo criterio que los
 * tests de MergeEngine/BackupManager). NINGÚN doble toca disco ni lanza procesos.
 */

/** GamePaths de prueba con rutas Windows fijas (no se tocan en disco). */
export const TEST_PATHS: GamePaths = {
  steamPath: "C:\\Steam",
  gameRoot: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2",
  left4dead2Dir: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2",
  workshopFolder:
    "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\addons\\workshop",
  vpkToolPath: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\bin\\vpk.exe",
  gameInfoFile:
    "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\gameinfo.txt",
  modsvsFolder: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\modsvs",
};

/** Registro de una invocación a MergeEngine.merge. */
export interface MergeCall {
  orderedAddons: ScannedAddon[];
  workDir: string;
}

/** Provider de procesos configurable (para ProcessGuard). */
class FakeProcessListProvider implements ProcessListProvider {
  constructor(private readonly running: boolean) {}
  listRunningProcessNames(): Promise<string[]> {
    return Promise.resolve(this.running ? ["left4dead2.exe"] : ["explorer.exe"]);
  }
}

/**
 * MergeEngine mockeado: registra `orderedAddons`/`workDir` de cada `merge`, puede
 * devolver un MergeReport inyectable y opcionalmente LANZAR (para simular
 * VpkToolError). Extiende la clase real solo para satisfacer el tipo; su lógica
 * NO se ejecuta (se sobreescribe `merge`).
 */
export class FakeMergeEngine {
  readonly calls: MergeCall[] = [];
  report: MergeReport = { collisions: [] };
  vpkPath = "C:\\work\\pak01_dir.vpk";
  #throwOn: (() => Error) | null = null;

  throwOnMerge(factory: () => Error): void {
    this.#throwOn = factory;
  }

  merge(
    orderedAddons: readonly ScannedAddon[],
    _paths: GamePaths,
    workDir: string,
  ): Promise<{ vpkPath: string; report: MergeReport }> {
    this.calls.push({ orderedAddons: [...orderedAddons], workDir });
    if (this.#throwOn !== null) return Promise.reject(this.#throwOn());
    return Promise.resolve({ vpkPath: this.vpkPath, report: this.report });
  }
}

/** ElevationService mockeado configurable por outcome de cada camino. */
export class FakeElevationService implements ElevationService {
  ensureCanWriteOutcome: ElevationOutcome = { kind: "already-writable" };
  handleWriteFailureOutcome: ElevationOutcome | null = null;
  readonly log: string[];

  constructor(log: string[]) {
    this.log = log;
  }

  isProtectedPath(): boolean {
    return false;
  }
  isElevated(): boolean {
    return false;
  }
  needsElevation(): Promise<boolean> {
    return Promise.resolve(false);
  }
  ensureCanWrite(
    _gameRoot: string,
    _entries: readonly AddonManifestEntry[],
    _operationType: PendingOperation["type"],
  ): Promise<ElevationOutcome> {
    this.log.push("ensureCanWrite");
    return Promise.resolve(this.ensureCanWriteOutcome);
  }
  handleWriteFailure(
    error: NodeJS.ErrnoException,
    _pending: PendingOperation,
    _entries: readonly AddonManifestEntry[],
  ): Promise<ElevationOutcome> {
    this.log.push("handleWriteFailure");
    // Por defecto: si el error es de permisos, comportamiento configurable; si no,
    // already-writable (no era de permisos -> se propaga el error original).
    const code = error.code;
    const isPerm = code === "EACCES" || code === "EPERM";
    if (!isPerm) return Promise.resolve({ kind: "already-writable" });
    return Promise.resolve(
      this.handleWriteFailureOutcome ?? { kind: "already-writable" },
    );
  }
  relaunchElevated(): Promise<ElevationOutcome> {
    return Promise.resolve({ kind: "elevated-handoff" });
  }
}

/** GameInfoEditor mockeado: registra la llamada y puede lanzar. */
export class FakeGameInfoEditor {
  readonly log: string[];
  result: GameInfoEditResult = { appliedCase: "unchanged", changed: false };
  #throwOn: (() => Error) | null = null;

  constructor(log: string[]) {
    this.log = log;
  }
  throwOnEnsure(factory: () => Error): void {
    this.#throwOn = factory;
  }
  ensureModsvsFirst(_gameInfoFile: string): Promise<GameInfoEditResult> {
    this.log.push("gameinfo");
    if (this.#throwOn !== null) return Promise.reject(this.#throwOn());
    return Promise.resolve(this.result);
  }
}

/** AddonScanner mockeado: devuelve un ScannedAddon por cada id configurado. */
export class FakeAddonScanner {
  constructor(private readonly scannedIds: string[]) {}
  scan(_workshopFolder: string): Promise<ScannedAddon[]> {
    return Promise.resolve(
      this.scannedIds.map((id) => ({
        id,
        vpkPath: `${TEST_PATHS.workshopFolder}\\${id}.vpk`,
        coverPath: null,
        info: null,
      })),
    );
  }
}

/** LocalStore mockeado en memoria con log de saveManifest/clearPendingSession. */
export class FakeLocalStore implements LocalStore {
  readonly log: string[];
  manifest: AddonManifestEntry[];
  pendingSession: AddonManifestEntry[] | null;
  savedManifest: AddonManifestEntry[] | null = null;

  constructor(
    log: string[],
    init?: { manifest?: AddonManifestEntry[]; pendingSession?: AddonManifestEntry[] | null },
  ) {
    this.log = log;
    this.manifest = init?.manifest ?? [];
    this.pendingSession = init?.pendingSession ?? null;
  }

  getPaths(): GamePaths | null {
    return TEST_PATHS;
  }
  savePaths(): void {}
  getManifest(): AddonManifestEntry[] {
    return [...this.manifest];
  }
  saveManifest(entries: AddonManifestEntry[]): void {
    this.log.push("saveManifest");
    this.savedManifest = [...entries];
  }
  savePendingSession(entries: AddonManifestEntry[]): void {
    this.pendingSession = [...entries];
  }
  getPendingSession(): AddonManifestEntry[] | null {
    return this.pendingSession === null ? null : [...this.pendingSession];
  }
  clearPendingSession(): void {
    this.log.push("clearPendingSession");
    this.pendingSession = null;
  }
}

/** BackupFileSystem mockeado (para el BackupManager real): configurable. */
class FakeBackupFs {
  readonly log: string[];
  existing = false;
  #throwOnCopy: (() => Error) | null = null;

  constructor(log: string[]) {
    this.log = log;
  }
  throwOnCopy(factory: () => Error): void {
    this.#throwOnCopy = factory;
  }
  exists(_path: string): Promise<boolean> {
    return Promise.resolve(this.existing);
  }
  copyFile(_src: string, _dst: string): Promise<void> {
    this.log.push("backup");
    if (this.#throwOnCopy !== null) return Promise.reject(this.#throwOnCopy());
    return Promise.resolve();
  }
}

/**
 * FS propio del orquestador mockeado: registra ensureDir/copyFile(install)/
 * removeDir y puede lanzar en la instalación. Registra los workDir creados y
 * removidos para verificar la limpieza.
 */
export class FakeOrchestratorFs implements MergeOrchestratorFileSystem {
  readonly log: string[];
  readonly ensuredDirs: string[] = [];
  readonly removedDirs: string[] = [];
  #throwOnInstall: (() => Error) | null = null;

  constructor(log: string[]) {
    this.log = log;
  }
  throwOnInstall(factory: () => Error): void {
    this.#throwOnInstall = factory;
  }
  ensureDir(dir: string): Promise<void> {
    this.ensuredDirs.push(dir);
    return Promise.resolve();
  }
  copyFile(_src: string, _dst: string): Promise<void> {
    this.log.push("install");
    if (this.#throwOnInstall !== null) return Promise.reject(this.#throwOnInstall());
    return Promise.resolve();
  }
  removeDir(dir: string): Promise<void> {
    this.removedDirs.push(dir);
    return Promise.resolve();
  }
}

/** Handles a los dobles construidos, para poder inspeccionarlos en los tests. */
export interface OrchestratorHarness {
  deps: MergeOrchestratorDeps;
  log: string[];
  mergeCalls: MergeCall[];
  mergeEngine: FakeMergeEngine;
  elevation: FakeElevationService;
  gameInfo: FakeGameInfoEditor;
  store: FakeLocalStore;
  backupFs: FakeBackupFs;
  fs: FakeOrchestratorFs;
}

export interface BuildOptions {
  installedManifest?: AddonManifestEntry[];
  pendingSession?: AddonManifestEntry[] | null;
  scannedIds?: string[];
  gameRunning?: boolean;
}

/**
 * Construye un MergeOrchestrator con dobles en memoria y un LOG cronológico
 * compartido. Usa el ProcessGuard y el BackupManager REALES sobre proveedores
 * mockeados (para ejercitar su lógica real), y dobles directos para el resto.
 */
export function buildOrchestrator(opts: BuildOptions = {}): OrchestratorHarness {
  const log: string[] = [];

  const processGuard = new ProcessGuard(
    new FakeProcessListProvider(opts.gameRunning ?? false),
  );

  const elevation = new FakeElevationService(log);

  const backupFs = new FakeBackupFs(log);
  const backupManager = new BackupManager(backupFs);

  const mergeEngine = new FakeMergeEngine();
  const gameInfo = new FakeGameInfoEditor(log);
  const store = new FakeLocalStore(log, {
    manifest: opts.installedManifest ?? [],
    pendingSession: opts.pendingSession ?? null,
  });
  const scanner = new FakeAddonScanner(opts.scannedIds ?? []);
  const fs = new FakeOrchestratorFs(log);

  const deps: MergeOrchestratorDeps = {
    processGuard,
    elevationService: elevation,
    backupManager,
    // Los dobles no extienden las clases reales; el cast documenta que cumplen el
    // MISMO contrato estructural que el orquestador consume (merge/ensureModsvsFirst/scan).
    mergeEngine: mergeEngine as unknown as MergeOrchestratorDeps["mergeEngine"],
    gameInfoEditor: gameInfo as unknown as MergeOrchestratorDeps["gameInfoEditor"],
    localStore: store,
    addonScanner: scanner as unknown as MergeOrchestratorDeps["addonScanner"],
    fs,
    paths: TEST_PATHS,
    workRoot: "C:\\work",
  };

  return {
    deps,
    log,
    mergeCalls: mergeEngine.calls,
    mergeEngine,
    elevation,
    gameInfo,
    store,
    backupFs,
    fs,
  };
}