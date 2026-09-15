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
  Preset,
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
  // BUG-009: `modsvs` cuelga de `<gameRoot>` (raíz del juego), NO de `left4dead2\`.
  // Es la topología CORRECTA confirmada por el usuario (P-01) y por `derivePaths`
  // en `path-detector.ts` (`joinWindows(gameRoot, "modsvs")`). El valor anterior
  // (`<gameRoot>\left4dead2\modsvs`) reflejaba el bug y estaba mal.
  modsvsFolder: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\modsvs",
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

/**
 * GameInfoEditor mockeado: registra la llamada y puede lanzar. `#materialize`
 * (P-30, Paso 3) llama `switchFolderEntry` para TODOS los caminos (legado
 * incluido, con `previous: null`) — `ensureModsvsFirst` se conserva acá por si
 * algún test la invoca directo, pero ya no la usa el orquestador.
 */
export class FakeGameInfoEditor {
  readonly log: string[];
  result: GameInfoEditResult = { appliedCase: "unchanged", changed: false };
  #throwOn: (() => Error) | null = null;
  /** Argumentos de cada llamada a `switchFolderEntry`, en orden. */
  readonly switchCalls: Array<{ gameInfoFile: string; previous: string | null; next: string }> = [];

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
  switchFolderEntry(
    gameInfoFile: string,
    previous: string | null,
    next: string,
  ): Promise<GameInfoEditResult> {
    this.log.push("gameinfo");
    this.switchCalls.push({ gameInfoFile, previous, next });
    if (this.#throwOn !== null) return Promise.reject(this.#throwOn());
    return Promise.resolve(this.result);
  }
}

/** AddonScanner mockeado: devuelve un ScannedAddon por cada id configurado. */
export class FakeAddonScanner {
  constructor(private readonly scannedIds: string[]) {}
  #toScannedAddon(id: string): ScannedAddon {
    return {
      id,
      vpkPath: `${TEST_PATHS.workshopFolder}\\${id}.vpk`,
      coverPath: null,
      info: null,
      mtimeMs: 0,
      sizeBytes: 0,
    };
  }
  scan(_workshopFolder: string): Promise<ScannedAddon[]> {
    return Promise.resolve(this.scannedIds.map((id) => this.#toScannedAddon(id)));
  }
  // (P-perf, Paso 1) Mismo contrato que AddonScanner.resolveByIds real: un id
  // que no esté entre los configurados se reporta como "missing" (primer
  // faltante), replicando la detección temprana de addon ausente que antes
  // hacía el scan completo (DECISIÓN 5 de merge-orchestrator).
  resolveByIds(
    _workshopFolder: string,
    addonIds: readonly string[],
  ): Promise<{ kind: "ok"; addons: ScannedAddon[] } | { kind: "missing"; addonId: string }> {
    const known = new Set(this.scannedIds);
    for (const id of addonIds) {
      if (!known.has(id)) return Promise.resolve({ kind: "missing", addonId: id });
    }
    return Promise.resolve({
      kind: "ok",
      addons: addonIds.map((id) => this.#toScannedAddon(id)),
    });
  }
}

/** LocalStore mockeado en memoria con log de saveManifest/clearPendingSession. */
export class FakeLocalStore implements LocalStore {
  readonly log: string[];
  manifest: AddonManifestEntry[];
  pendingSession: AddonManifestEntry[] | null;
  savedManifest: AddonManifestEntry[] | null = null;
  #presets = new Map<string, Preset>();
  #activePresetId: string | null = null;
  #presetSeq = 0;
  /** Llamadas a `updatePresetEntries`, en orden (P-30, Paso 4.5b). */
  readonly updatePresetEntriesCalls: Array<{ id: string; entries: AddonManifestEntry[] }> = [];

  constructor(
    log: string[],
    init?: { manifest?: AddonManifestEntry[]; pendingSession?: AddonManifestEntry[] | null },
  ) {
    this.log = log;
    this.manifest = init?.manifest ?? [];
    this.pendingSession = init?.pendingSession ?? null;
    // (P-30, Paso 4.5b) Replica la migración REAL de SqliteLocalStore: una
    // base "nueva" siempre arranca con un preset activo (id fijo "modsvs",
    // ver DEFAULT_PRESET_FOLDER_ID/DECISIÓN 6-bis), sembrado con el
    // `manifest` inicial. Sin esto, `#runPublic` (que ahora EXIGE un preset
    // activo) fallaría en TODOS los tests existentes de apply/add/remove.
    const seedEntries = init?.manifest ?? [];
    this.#presets.set("modsvs", {
      id: "modsvs",
      name: "Principal",
      description: null,
      entries: [...seedEntries],
    });
    this.#activePresetId = "modsvs";
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
  listPresets(): Preset[] {
    return [...this.#presets.values()];
  }
  getPreset(id: string): Preset | null {
    return this.#presets.get(id) ?? null;
  }
  createPreset(name: string, entries: AddonManifestEntry[], description?: string | null): Preset {
    const preset: Preset = {
      id: `preset-fake-${this.#presetSeq++}`,
      name,
      description: description ?? null,
      entries: [...entries],
    };
    this.#presets.set(preset.id, preset);
    return preset;
  }
  renamePreset(id: string, newName: string): void {
    const preset = this.#presets.get(id);
    if (preset !== undefined) preset.name = newName;
  }
  deletePreset(id: string): void {
    this.#presets.delete(id);
    if (this.#activePresetId === id) this.#activePresetId = null;
  }
  getActivePresetId(): string | null {
    return this.#activePresetId;
  }
  setActivePresetId(id: string): void {
    this.#activePresetId = id;
  }
  updatePresetEntries(id: string, entries: AddonManifestEntry[]): void {
    this.log.push("saveManifest"); // mismo nombre de log que antes (el step de progreso no cambió, ver DECISIÓN en merge-orchestrator.ts).
    this.updatePresetEntriesCalls.push({ id, entries: [...entries] });
    const preset = this.#presets.get(id);
    if (preset !== undefined) preset.entries = [...entries];
  }
}

/** BackupFileSystem mockeado (para el BackupManager real): configurable. */
export class FakeBackupFs {
  readonly log: string[];
  existing = false;
  /**
   * Último destino (`dst`) recibido por `copyFile` del backup, o `null` si no se
   * copió (p. ej. no había fuente que respaldar). Permite verificar en qué carpeta
   * quedó el `.backup` (BUG-009 Property 1).
   */
  backupDest: string | null = null;
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
  copyFile(_src: string, dst: string): Promise<void> {
    this.log.push("backup");
    this.backupDest = dst;
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
  /**
   * Último destino (`dst`) recibido por `copyFile` del paso de INSTALACIÓN, o
   * `null` si aún no se instaló. Permite verificar en qué carpeta quedó el
   * `pak01_dir.vpk` fusionado (BUG-009 Property 1).
   */
  installDest: string | null = null;
  /**
   * Longitud del log cronológico compartido en el instante en que se invocó
   * `ensureDir(dir)`, por cada `dir`. Permite verificar el ORDEN relativo de la
   * creación de un directorio respecto de `backup`/`install`/`gameinfo` SIN
   * contaminar el log (que otros tests asertan con `toEqual`). BUG-009: la creación
   * de `modsvs` debe ocurrir ANTES del paso de backup.
   */
  readonly ensureDirLogIndex = new Map<string, number>();
  #throwOnInstall: (() => Error) | null = null;
  /**
   * Hook OPCIONAL para simular un fallo de `ensureDir` SOLO cuando el `dir`
   * coincide con `#throwOnEnsureDirTarget` (BUG-009 caso EACCES/EPERM en la
   * creación de `modsvs`). Por defecto no está configurado: `ensureDir` es un
   * no-op y NO afecta a los tests existentes que crean `workDir`/`modsvs`.
   */
  #throwOnEnsureDir: (() => Error) | null = null;
  #throwOnEnsureDirTarget: string | null = null;

  constructor(log: string[]) {
    this.log = log;
  }
  throwOnInstall(factory: () => Error): void {
    this.#throwOnInstall = factory;
  }
  /**
   * Configura `ensureDir` para que LANCE (con el error de `factory`) únicamente
   * cuando se lo invoque con `targetDir`. Cualquier otro directorio (p. ej. el
   * `workDir` temporal) sigue siendo un no-op. Permite ejercitar el manejo
   * reactivo de permisos al crear `modsvs` sin alterar el resto del flujo.
   */
  throwOnEnsureDir(targetDir: string, factory: () => Error): void {
    this.#throwOnEnsureDirTarget = targetDir;
    this.#throwOnEnsureDir = factory;
  }
  ensureDir(dir: string): Promise<void> {
    this.ensuredDirs.push(dir);
    // Se captura la posición en el log ANTES de que se registren pasos posteriores
    // (backup/install). No se escribe en el log para no romper los tests que
    // aseveran su contenido exacto con `toEqual`.
    if (!this.ensureDirLogIndex.has(dir)) {
      this.ensureDirLogIndex.set(dir, this.log.length);
    }
    if (this.#throwOnEnsureDir !== null && dir === this.#throwOnEnsureDirTarget) {
      return Promise.reject(this.#throwOnEnsureDir());
    }
    return Promise.resolve();
  }
  copyFile(_src: string, dst: string): Promise<void> {
    this.log.push("install");
    this.installDest = dst;
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