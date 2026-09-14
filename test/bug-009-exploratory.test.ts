import { describe, expect, test } from "vitest";

import {
  BackupManager,
  MergeOrchestrator,
  PathDetector,
  ProcessGuard,
} from "../src/main/domain/index.js";
import type {
  AddonManifestEntry,
  ElevationOutcome,
  ElevationService,
  FileReadResult,
  FileSystemProbe,
  GameInfoEditResult,
  GamePaths,
  LocalStore,
  ManualPathProvider,
  ManualPathRequest,
  ManualPathResponse,
  MergeOrchestratorDeps,
  MergeOrchestratorFileSystem,
  MergeReport,
  Preset,
  ProcessListProvider,
  RegistryReader,
  ScannedAddon,
} from "../src/main/domain/index.js";

/**
 * BUG-009 — Fase EXPLORATORIA (bug condition checking).
 *
 * OBJETIVO: reproducir el bug sobre el código ACTUAL (SIN fix) para CONFIRMAR la
 * causa raíz. Los asertos de estos tests codifican el comportamiento CORRECTO /
 * ESPERADO (el Merged_Package y su backup SIEMPRE bajo `<gameRoot>\modsvs\`, y
 * `modsvsFolder` re-derivado a `<gameRoot>\modsvs`). Por eso, sobre el código sin
 * fix, DEBEN FALLAR: la falla confirma que el bug existe y valida las hipótesis A
 * y B del design. Tras el fix (tarea 5.2 los re-ejecuta) pasarán.
 *
 * NO se debe "arreglar" el test ni el código para que pasen en esta fase: la
 * falla es el resultado ESPERADO.
 *
 * Cubre:
 *  - Caso a) Detección fresca desvía a la raíz (Hipótesis A / Requirements 1.3, 2.3).
 *  - Caso b) `#materialize` no crea `modsvs` (Hipótesis B / Requirements 1.1, 2.1).
 *  - Caso c) `installTarget`/`backupPath` fuera de `modsvs` (Requirements 1.1, 1.2, 2.1, 2.2, 2.4).
 */

// ---------------------------------------------------------------------------
// Utilidades de ruta Windows (mismas convenciones que el dominio).
// ---------------------------------------------------------------------------

const DISK_SEP = "\\";

/** Une un directorio con un segmento usando `\` sin duplicar separadores. */
function joinWindows(dir: string, segment: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  const seg = segment.replace(/^[\\/]+/, "");
  return `${trimmed}${DISK_SEP}${seg}`;
}

/** Devuelve el directorio contenedor de una ruta Windows (`parentDir`). */
function parentDir(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = trimmed.lastIndexOf(DISK_SEP);
  return idx <= 0 ? trimmed : trimmed.slice(0, idx);
}

// ===========================================================================
// CASO a) — Detección fresca desvía `modsvsFolder` a la raíz del juego.
//
// Reproduce Hipótesis A: `modsvsFolder` está en REQUIRED_PATH_KEYS; en una
// instalación fresca `<gameRoot>\modsvs` NO existe, así que `verifyPathsOnDisk`
// lo marca faltante, `#verifyThenManual` lo pide vía ManualPathProvider y el
// usuario elige la RAÍZ del juego (que sí existe). Resultado sobre F:
// `modsvsFolder = <gameRoot>` en vez de `<gameRoot>\modsvs`.
// ===========================================================================

const STEAM = "C:\\Program Files (x86)\\Steam";
const LIB = "D:\\SteamLibrary";
const GAME_ROOT = "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2";
const L4D2_DIR = `${GAME_ROOT}\\left4dead2`;
const WORKSHOP = `${L4D2_DIR}\\addons\\workshop`;
const VPK_TOOL = `${GAME_ROOT}\\bin\\vpk.exe`;
const GAMEINFO = `${L4D2_DIR}\\gameinfo.txt`;
const EXPECTED_MODSVS = joinWindows(GAME_ROOT, "modsvs");
const VDF_PATH = `${STEAM}\\steamapps\\libraryfolders.vdf`;

/** VDF con L4D2 (550) en la biblioteca D:. */
function vdfWithL4D2OnD(): string {
  return `
"libraryfolders"
{
    "0" { "path" "${STEAM.replace(/\\/g, "\\\\")}" "apps" { "440" "1" } }
    "1" { "path" "${LIB.replace(/\\/g, "\\\\")}" "apps" { "550" "2" } }
}
`;
}

/** RegistryReader mockeado: devuelve un SteamPath fijo. */
class MockRegistry implements RegistryReader {
  constructor(private readonly value: string | null) {}
  async readValue(): Promise<string | null> {
    return this.value;
  }
}

/** FS en memoria: set de rutas existentes + contenidos de archivos de texto. */
class MockFs implements FileSystemProbe {
  #existing: Set<string>;
  #files: Map<string, string>;
  constructor(existing: Iterable<string> = [], files: Iterable<[string, string]> = []) {
    this.#existing = new Set(existing);
    this.#files = new Map(files);
  }
  async readTextFile(path: string): Promise<FileReadResult> {
    const content = this.#files.get(path);
    return content === undefined ? { ok: false } : { ok: true, content };
  }
  async exists(path: string): Promise<boolean> {
    return this.#existing.has(path);
  }
}

/**
 * ManualPathProvider que, ante CUALQUIER selección requerida de `modsvsFolder`,
 * responde con la RAÍZ del juego (reproduce al usuario que no encuentra `modsvs`
 * y termina eligiendo `...\Left 4 Dead 2\`).
 */
class RootChoosingManual implements ManualPathProvider {
  readonly requests: ManualPathRequest[] = [];
  constructor(private readonly gameRoot: string) {}
  async requestPath(request: ManualPathRequest): Promise<ManualPathResponse> {
    this.requests.push(request);
    if (request.kind === "required-path" && request.pathKey === "modsvsFolder") {
      // El usuario elige la raíz del juego (existe → pasa la re-verificación).
      return { kind: "selected", path: this.gameRoot };
    }
    return { kind: "cancelled" };
  }
}

describe("BUG-009 caso a) detección fresca NO debe desviar modsvsFolder a la raíz", () => {
  test("detect() re-deriva modsvsFolder = <gameRoot>\\modsvs en instalación fresca (sin modsvs en disco)", async () => {
    // Instalación FRESCA: TODAS las rutas requeridas existen MENOS `<gameRoot>\modsvs`.
    // La raíz del juego (GAME_ROOT) sí existe (para que la elija el usuario).
    const fs = new MockFs(
      [GAME_ROOT, WORKSHOP, VPK_TOOL, GAMEINFO],
      [[VDF_PATH, vdfWithL4D2OnD()]],
    );
    const manual = new RootChoosingManual(GAME_ROOT);
    const detector = new PathDetector({
      registry: new MockRegistry(STEAM),
      fs,
      manual,
    });

    const result = await detector.detect();

    // Comportamiento ESPERADO/correcto: la ausencia de `modsvs` en una instalación
    // fresca NO debe romper ni desviar la detección; `modsvsFolder` debe resolver
    // a `<gameRoot>\modsvs`, sin pedir selección manual de `modsvs`.
    //
    // Sobre el código SIN fix esto FALLA: `modsvs` está en REQUIRED_PATH_KEYS, se
    // pide manualmente y el usuario elige la raíz -> modsvsFolder = <gameRoot>.
    expect(result.kind).toBe("ready");
    const modsvsFolder =
      result.kind === "ready" ? result.paths.modsvsFolder : undefined;
    expect(modsvsFolder).toBe(EXPECTED_MODSVS);

    // No debería haberse pedido `modsvsFolder` por selección manual.
    const askedForModsvs = manual.requests.some(
      (r) => r.kind === "required-path" && r.pathKey === "modsvsFolder",
    );
    expect(askedForModsvs).toBe(false);
  });
});

// ===========================================================================
// CASO b) y c) — `#materialize` DEBE crear `modsvs` y colgar install/backup de él.
//
// Verifican el FLUJO CORREGIDO de `#materialize`: tras el fix, `#materialize`
// hace `ensureDir(this.#paths.modsvsFolder)` ANTES del backup y deriva
// `installTarget`/`backupPath` de `modsvsFolder`. Por eso estos casos construyen
// `GamePaths` con la topología CORRECTA que produce `derivePaths` tras el fix:
// `modsvsFolder = <gameRoot>\modsvs`.
//
// NOTA IMPORTANTE: la variante "modsvsFolder persistido = <gameRoot>" (el desvío
// del bug) ya NO ocurre en el flujo real, porque `detect()` re-deriva
// `modsvsFolder = <gameRoot>\modsvs` en cada corrida (Cambio 2/3, probado
// end-to-end por el CASO a). `#materialize` NO reubica un path ya corrupto: su
// responsabilidad es crear y usar el `modsvsFolder` que recibe. Como en el flujo
// real ese valor SIEMPRE llega derivado a `<gameRoot>\modsvs`, los casos b/c usan
// esa topología corregida (no la raíz desviada, que sería una premisa que el fix
// de `detect()` ya elimina).
//
// Se construyen dobles PROPIOS (no los compartidos) que CAPTURAN las rutas de
// destino de `copyFile` de instalación y de backup, y el ORDEN de las llamadas.
// ===========================================================================

/**
 * `GamePaths` con la topología CORRECTA post-fix: `modsvsFolder = <gameRoot>\modsvs`
 * (el valor que `derivePaths`/`detect()` producen tras el fix, ver CASO a).
 */
const FIXED_PATHS: GamePaths = {
  steamPath: STEAM,
  gameRoot: GAME_ROOT,
  left4dead2Dir: L4D2_DIR,
  workshopFolder: WORKSHOP,
  vpkToolPath: VPK_TOOL,
  gameInfoFile: GAMEINFO,
  // Topología correcta: modsvs cuelga de <gameRoot> (re-derivada en detect()).
  modsvsFolder: EXPECTED_MODSVS,
};

class FakeProcessListProvider implements ProcessListProvider {
  listRunningProcessNames(): Promise<string[]> {
    return Promise.resolve(["explorer.exe"]);
  }
}

class FakeElevation implements ElevationService {
  isProtectedPath(): boolean {
    return false;
  }
  isElevated(): boolean {
    return false;
  }
  needsElevation(): Promise<boolean> {
    return Promise.resolve(false);
  }
  ensureCanWrite(): Promise<ElevationOutcome> {
    return Promise.resolve({ kind: "already-writable" });
  }
  handleWriteFailure(): Promise<ElevationOutcome> {
    return Promise.resolve({ kind: "already-writable" });
  }
  relaunchElevated(): Promise<ElevationOutcome> {
    return Promise.resolve({ kind: "elevated-handoff" });
  }
}

class FakeMergeEngine {
  vpkPath = "C:\\work\\pak01_dir.vpk";
  merge(
    _addons: readonly ScannedAddon[],
    _paths: GamePaths,
    _workDir: string,
  ): Promise<{ vpkPath: string; report: MergeReport }> {
    return Promise.resolve({ vpkPath: this.vpkPath, report: { collisions: [] } });
  }
}

class FakeGameInfoEditor {
  ensureModsvsFirst(): Promise<GameInfoEditResult> {
    return Promise.resolve({ appliedCase: "unchanged", changed: false });
  }
  // (P-30, Paso 3) `#materialize` llama switchFolderEntry para TODOS los
  // caminos (legado incluido); este archivo no ejercita presets, alcanza con
  // el mismo resultado fijo que ya devolvía ensureModsvsFirst.
  switchFolderEntry(): Promise<GameInfoEditResult> {
    return Promise.resolve({ appliedCase: "unchanged", changed: false });
  }
}

class FakeAddonScanner {
  constructor(private readonly ids: string[]) {}
  scan(): Promise<ScannedAddon[]> {
    return Promise.resolve(
      this.ids.map((id) => ({
        id,
        vpkPath: `${WORKSHOP}\\${id}.vpk`,
        coverPath: null,
        info: null,
        mtimeMs: 0,
        sizeBytes: 0,
      })),
    );
  }
}

class FakeLocalStore implements LocalStore {
  savedManifest: AddonManifestEntry[] | null = null;
  constructor(private readonly manifest: AddonManifestEntry[] = []) {}
  getPaths(): GamePaths | null {
    return FIXED_PATHS;
  }
  savePaths(): void {}
  getManifest(): AddonManifestEntry[] {
    return [...this.manifest];
  }
  saveManifest(entries: AddonManifestEntry[]): void {
    this.savedManifest = [...entries];
  }
  savePendingSession(): void {}
  getPendingSession(): AddonManifestEntry[] | null {
    return null;
  }
  clearPendingSession(): void {}
  // (P-30, Paso 4.5b) `#runPublic` ahora EXIGE un preset activo: se simula
  // uno fijo ("modsvs", igual que la migración real) sembrado con el
  // `manifest` del constructor, para que applyActiveSet/addAddon/removeAddon
  // sigan funcionando sin cambiar el resto de este archivo (fuera del alcance
  // de BUG-009).
  listPresets(): Preset[] {
    return [{ id: "modsvs", name: "Principal", description: null, entries: [...this.manifest] }];
  }
  getPreset(id: string): Preset | null {
    return id === "modsvs"
      ? { id, name: "Principal", description: null, entries: [...this.manifest] }
      : null;
  }
  createPreset(name: string, entries: AddonManifestEntry[]): Preset {
    return { id: "preset-fake", name, description: null, entries };
  }
  renamePreset(): void {}
  deletePreset(): void {}
  getActivePresetId(): string | null {
    return "modsvs";
  }
  setActivePresetId(): void {}
  updatePresetEntries(): void {}
}

/** BackupFileSystem que registra el destino de la copia de backup y el orden. */
class RecordingBackupFs {
  backupDest: string | null = null;
  constructor(
    private readonly log: string[],
    private readonly sourceExists: boolean,
  ) {}
  exists(_path: string): Promise<boolean> {
    return Promise.resolve(this.sourceExists);
  }
  copyFile(_src: string, dst: string): Promise<void> {
    this.log.push("backup");
    this.backupDest = dst;
    return Promise.resolve();
  }
}

/**
 * FS del orquestador que CAPTURA los `ensureDir` (en orden) y el destino de la
 * copia de INSTALACIÓN. Registra en el log compartido para verificar el orden
 * relativo a `backup`.
 */
class RecordingOrchestratorFs implements MergeOrchestratorFileSystem {
  readonly ensuredDirs: string[] = [];
  installDest: string | null = null;
  constructor(private readonly log: string[]) {}
  ensureDir(dir: string): Promise<void> {
    this.ensuredDirs.push(dir);
    this.log.push(`ensureDir:${dir}`);
    return Promise.resolve();
  }
  copyFile(_src: string, dst: string): Promise<void> {
    this.log.push("install");
    this.installDest = dst;
    return Promise.resolve();
  }
  removeDir(_dir: string): Promise<void> {
    return Promise.resolve();
  }
}

interface Harness {
  orchestrator: MergeOrchestrator;
  log: string[];
  backupFs: RecordingBackupFs;
  fs: RecordingOrchestratorFs;
}

/** Arma un MergeOrchestrator real con los dobles que capturan rutas/orden. */
function buildHarness(opts: { sourceExists: boolean; scannedIds: string[] }): Harness {
  const log: string[] = [];
  const backupFs = new RecordingBackupFs(log, opts.sourceExists);
  const fs = new RecordingOrchestratorFs(log);
  const deps: MergeOrchestratorDeps = {
    processGuard: new ProcessGuard(new FakeProcessListProvider()),
    elevationService: new FakeElevation(),
    backupManager: new BackupManager(backupFs),
    mergeEngine: new FakeMergeEngine() as unknown as MergeOrchestratorDeps["mergeEngine"],
    gameInfoEditor: new FakeGameInfoEditor() as unknown as MergeOrchestratorDeps["gameInfoEditor"],
    localStore: new FakeLocalStore(),
    addonScanner: new FakeAddonScanner(opts.scannedIds) as unknown as MergeOrchestratorDeps["addonScanner"],
    fs,
    paths: FIXED_PATHS,
    workRoot: "C:\\work",
  };
  return { orchestrator: new MergeOrchestrator(deps), log, backupFs, fs };
}

describe("BUG-009 caso b) #materialize DEBE crear modsvs (ensureDir) antes del backup", () => {
  test("ensureDir(modsvsFolder) se invoca ANTES del backup", async () => {
    // sourceExists=true para que BackupManager copie y registre el paso "backup"
    // en el log: sólo así el orden relativo ensureDir(modsvs) -> backup es
    // observable. Con sourceExists=false el backup es no-op (no registra nada).
    const harness = buildHarness({ sourceExists: true, scannedIds: ["a"] });
    const entries: AddonManifestEntry[] = [{ addonId: "a", priorityOrder: 0 }];

    const result = await harness.orchestrator.applyActiveSet(entries);
    expect(result.status).toBe("success");

    // Comportamiento ESPERADO: se debe crear la carpeta modsvs.
    // El destino correcto de la carpeta es `<gameRoot>\modsvs`.
    const ensuredModsvs = harness.fs.ensuredDirs.includes(EXPECTED_MODSVS);
    expect(ensuredModsvs).toBe(true);

    // Y debe ocurrir ANTES del paso de backup.
    // Con el fix: `#materialize` llama `ensureDir(<gameRoot>\modsvs)` antes del
    // backup. Sobre el código SIN fix fallaba: `ensureDir` solo se invocaba con
    // el workDir, nunca con `modsvsFolder`, así que este índice era -1.
    const ensureIdx = harness.log.indexOf(`ensureDir:${EXPECTED_MODSVS}`);
    const backupIdx = harness.log.indexOf("backup");
    expect(ensureIdx).toBeGreaterThanOrEqual(0);
    expect(ensureIdx).toBeLessThan(backupIdx);
  });
});

describe("BUG-009 caso c) installTarget/backupPath DEBEN quedar bajo <gameRoot>\\modsvs", () => {
  test("el destino de instalación cuelga de <gameRoot>\\modsvs, nunca de la raíz", async () => {
    const harness = buildHarness({ sourceExists: false, scannedIds: ["a"] });
    const entries: AddonManifestEntry[] = [{ addonId: "a", priorityOrder: 0 }];

    const result = await harness.orchestrator.applyActiveSet(entries);
    expect(result.status).toBe("success");

    // Comportamiento ESPERADO: parentDir(installTarget) === <gameRoot>\modsvs.
    // Con el fix, `modsvsFolder` llega derivado a `<gameRoot>\modsvs` y el
    // install cuelga de ahí. Sobre el código SIN fix (con modsvsFolder desviado
    // a la raíz) fallaba: installDest = <gameRoot>\pak01_dir.vpk (suelto en raíz).
    expect(harness.fs.installDest).not.toBeNull();
    expect(parentDir(harness.fs.installDest as string)).toBe(EXPECTED_MODSVS);
  });

  test("el destino del backup cuelga de <gameRoot>\\modsvs, nunca de la raíz", async () => {
    // sourceExists=true para que BackupManager sí copie y registre el destino.
    const harness = buildHarness({ sourceExists: true, scannedIds: ["a"] });
    const entries: AddonManifestEntry[] = [{ addonId: "a", priorityOrder: 0 }];

    const result = await harness.orchestrator.applyActiveSet(entries);
    expect(result.status).toBe("success");

    // Comportamiento ESPERADO: parentDir(backupPath) === <gameRoot>\modsvs.
    // Con el fix, `modsvsFolder = <gameRoot>\modsvs` y el backup cuelga de ahí.
    // Sobre el código SIN fix (con modsvsFolder desviado a la raíz) fallaba:
    // backupDest = <gameRoot>\pak01_dir.vpk.backup -> parentDir = <gameRoot>.
    expect(harness.backupFs.backupDest).not.toBeNull();
    expect(parentDir(harness.backupFs.backupDest as string)).toBe(EXPECTED_MODSVS);
  });
});
