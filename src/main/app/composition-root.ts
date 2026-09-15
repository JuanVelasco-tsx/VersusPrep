/**
 * Composition root del bloque 5a (Tarea 20.4): funciones de ensamblado y
 * arranque, separadas de main.ts (bloque 5b) para ser testeables sin runtime
 * de Electron ni SQLite real en archivo. Este modulo NO importa "electron"
 * como valor - solo tipos (Dialog) cuando hace falta - ni llama a
 * app.getPath/BrowserWindow: esas resoluciones de ruta y el ciclo de vida de
 * la ventana son responsabilidad de main.ts.
 *
 * DECISION M (ubicacion de datos, documentada aqui aunque se resuelve en 5b):
 * la Database real vive en app.getPath('userData')/store.sqlite (persistente);
 * workRoot/tempDir van bajo os.tmpdir() (efimeros, workRoot ya se limpia solo
 * via MergeOrchestratorFileSystem.removeDir en el finally de #materialize).
 * Este modulo recibe ambos como strings ya resueltos, no los calcula.
 *
 * DECISION N (buffer de resume, D2a-i): un UNICO onProgress compuesto -
 * ver createStartupProgressListener - que empuja al buffer (si esta activo)
 * Y ademas siempre reenvia al broadcaster. Durante el resume-antes-de-ventana
 * el broadcaster es un no-op seguro (getWebContents() devuelve undefined),
 * asi que no hace falta ningun flag de "modo" aparte del propio buffer.
 *
 * DECISION Q (arranque sin rutas): si PathDetector.detect() no resuelve
 * "ready" (el usuario cancelo la seleccion manual, o Steam/L4D2 no estan
 * instalados), runStartupSequence devuelve StartupOutcome "fatal" - no hay
 * dominio dependiente de paths que construir. main.ts (5b) traduce eso a
 * dialog.showErrorBox + app.quit(), sin levantar ventana.
 */
import type { Database } from "better-sqlite3";
import type { Dialog } from "electron";

import {
  AddonScanner,
  BackupManager,
  CollisionResolver,
  ElevationServiceImpl,
  GameInfoEditor,
  MergeEngine,
  MergeOrchestrator,
  PathDetector,
  ProcessGuard,
  SqliteLocalStore,
  VpkTool,
  VScriptDetector,
} from "../domain/index.js";
import type { ResumeState } from "./ipc-contract.js";
import type {
  AddonFileSystem,
  CommandRunner,
  ElevationService,
  GamePaths,
  LocalStore,
  MergeFileSystem,
  MergeOrchestratorFileSystem,
  MergeProgressEvent,
  MergeProgressListener,
  PendingOperation,
  ScanProgressListener,
} from "../domain/index.js";

import { RealAddonFileSystem } from "../data/addon-file-system.js";
import { RealBackupFileSystem } from "../data/backup-file-system.js";
import { RealCollisionFileSystem } from "../data/collision-file-system.js";
import { RealElevationOsProvider } from "../data/elevation-os-provider.js";
import { RealFileSystemProbe } from "../data/file-system-probe.js";
import { RealGameInfoFileSystem } from "../data/game-info-file-system.js";
import { RealManualPathProvider } from "../data/manual-path-provider.js";
import { RealMergeFileSystem } from "../data/merge-file-system.js";
import { RealMergeOrchestratorFileSystem } from "../data/merge-orchestrator-file-system.js";
import { RealProcessListProvider } from "../data/process-list-provider.js";
import { RealRegistryReader } from "../data/registry-reader.js";

// ---------------------------------------------------------------------------
// Fase 1: dominio independiente de GamePaths.
// ---------------------------------------------------------------------------

export interface PathIndependentDomain {
  pathDetector: PathDetector;
  processGuard: ProcessGuard;
  localStore: LocalStore;
  elevationService: ElevationService;
  collisionResolver: CollisionResolver;
  backupManager: BackupManager;
  gameInfoEditor: GameInfoEditor;
  addonFileSystem: AddonFileSystem;
  mergeFileSystem: MergeFileSystem;
  mergeOrchestratorFileSystem: MergeOrchestratorFileSystem;
}

export interface PathIndependentIo {
  commandRunner: CommandRunner;
  dialog: Pick<Dialog, "showOpenDialog">;
  spawnSyncFn: Pick<typeof import("node:child_process"), "spawnSync">;
  db: Database;
  /**
   * Listener de progreso OPCIONAL (BUG-004). Se pasa al `ElevationServiceImpl`
   * para que emita `{ step: "restarting" }` antes del relanzo `runas`. Es el
   * broadcaster hacia la ventana (`createProgressBroadcaster`), NO el onProgress
   * compuesto con el buffer de resume: el evento `restarting` ocurre en la
   * instancia SIN privilegios (la que va a elevar), cuya ventana está viva; el
   * buffer de resume solo aplica a la instancia elevada que rehidrata.
   */
  onProgress?: MergeProgressListener;
}

/**
 * Construye todo lo que NO necesita GamePaths resuelto: los adaptadores de
 * SO/filesystem, PathDetector, ProcessGuard, LocalStore, ElevationService, y
 * los tres componentes de dominio (CollisionResolver/BackupManager/
 * GameInfoEditor) que no dependen de VpkTool. Comparte el mismo CommandRunner
 * en RegistryReader/ProcessListProvider/ElevationOsProvider (mismo criterio
 * de los bloques 1 y 4).
 */
export function buildPathIndependentDomain(io: PathIndependentIo): PathIndependentDomain {
  const registryReader = new RealRegistryReader(io.commandRunner);
  const processListProvider = new RealProcessListProvider(io.commandRunner);
  const fileSystemProbe = new RealFileSystemProbe();
  const manualPathProvider = new RealManualPathProvider(io.dialog);
  const elevationOsProvider = new RealElevationOsProvider(io.commandRunner, io.spawnSyncFn);
  const localStore = new SqliteLocalStore(io.db);

  return {
    pathDetector: new PathDetector({
      registry: registryReader,
      fs: fileSystemProbe,
      manual: manualPathProvider,
    }),
    processGuard: new ProcessGuard(processListProvider),
    localStore,
    elevationService: new ElevationServiceImpl(elevationOsProvider, localStore, io.onProgress),
    collisionResolver: new CollisionResolver(new RealCollisionFileSystem()),
    backupManager: new BackupManager(new RealBackupFileSystem()),
    gameInfoEditor: new GameInfoEditor(new RealGameInfoFileSystem()),
    addonFileSystem: new RealAddonFileSystem(),
    mergeFileSystem: new RealMergeFileSystem(),
    mergeOrchestratorFileSystem: new RealMergeOrchestratorFileSystem(),
  };
}

// ---------------------------------------------------------------------------
// Fase 2: dominio dependiente de GamePaths (bloqueado hasta detectar rutas).
// ---------------------------------------------------------------------------

export interface PathDependentDomain {
  addonScanner: AddonScanner;
  vscriptDetector: VScriptDetector;
  mergeOrchestrator: MergeOrchestrator;
}

export interface PathDependentIo {
  commandRunner: CommandRunner;
  tempDir: string;
  workRoot: string;
  onProgress: MergeProgressListener;
  /** (Rediseño Paso 8/8) Progreso de `AddonScanner.scan` — ver `ScanProgressListener`. */
  onScanProgress: ScanProgressListener;
}

/** Construye VpkTool y todo lo que depende de el, mas MergeOrchestrator. */
export function buildPathDependentDomain(
  paths: GamePaths,
  base: PathIndependentDomain,
  io: PathDependentIo,
): PathDependentDomain {
  const vpkTool = new VpkTool(io.commandRunner, paths.vpkToolPath);
  const addonScanner = new AddonScanner(base.addonFileSystem, vpkTool, io.tempDir, io.onScanProgress);
  const vscriptDetector = new VScriptDetector(vpkTool);
  const mergeEngine = new MergeEngine(vpkTool, base.mergeFileSystem, base.collisionResolver);
  const mergeOrchestrator = new MergeOrchestrator({
    processGuard: base.processGuard,
    elevationService: base.elevationService,
    backupManager: base.backupManager,
    mergeEngine,
    gameInfoEditor: base.gameInfoEditor,
    localStore: base.localStore,
    addonScanner,
    fs: base.mergeOrchestratorFileSystem,
    paths,
    workRoot: io.workRoot,
    onProgress: io.onProgress,
  });

  return { addonScanner, vscriptDetector, mergeOrchestrator };
}

// ---------------------------------------------------------------------------
// Progreso durante el arranque (Decision N) y parseo de argv de resume.
// ---------------------------------------------------------------------------

/**
 * onProgress COMPUESTO: si resumeBufferRef.current es un array (fase de
 * resume-antes-de-ventana activa), empuja el evento ahi; SIEMPRE ademas
 * reenvia al broadcaster (no-op seguro si no hay ventana todavia). No hace
 * falta ningun flag de modo aparte de resumeBufferRef.current.
 */
export function createStartupProgressListener(
  resumeBufferRef: { current: MergeProgressEvent[] | null },
  broadcaster: MergeProgressListener,
): MergeProgressListener {
  return (event) => {
    resumeBufferRef.current?.push(event);
    broadcaster(event);
  };
}

/**
 * Parsea los flags --l4d2-resume-type/--l4d2-resume-handle de argv (Decision
 * L del bloque 4). Devuelve null si faltan, estan incompletos, o el type no
 * es uno de los validos de PendingOperation["type"].
 *
 * P-30, Paso 3.5 (cierra DECISION 8 de merge-orchestrator.ts): si
 * type === "switchActivePreset", TAMBIEN exige el flag
 * --l4d2-resume-preset-id (ver `buildRelaunchArgs` en
 * elevation-os-provider.ts, el lado que lo emite) - sin el, no hay forma de
 * saber hacia que preset resumir el switch, asi que se trata igual que un
 * flag faltante: devuelve null (no hay resume valido, la app arranca fresca
 * en vez de intentar resumir con datos incompletos).
 *
 * P-31+P-22, Paso 1 (DECISION 9 de merge-orchestrator.ts): se suman
 * "addAddons"/"removeAddons" al allow-list (variantes en lote de
 * addAddon/removeAddon) - sin esto, un relanzo elevado a mitad de una
 * operacion en lote no pasaria esta validacion y la app arrancaria SIN
 * resumir, perdiendo la sesion pendiente en vez de completarla.
 */
export function parseResumeArgs(argv: readonly string[]): PendingOperation | null {
  const typeIndex = argv.indexOf("--l4d2-resume-type");
  const handleIndex = argv.indexOf("--l4d2-resume-handle");
  if (typeIndex === -1 || handleIndex === -1) return null;
  const type = argv[typeIndex + 1];
  const resumeHandle = argv[handleIndex + 1];
  if (type === undefined || resumeHandle === undefined) return null;
  if (
    type !== "applyActiveSet" &&
    type !== "addAddon" &&
    type !== "removeAddon" &&
    type !== "addAddons" &&
    type !== "removeAddons" &&
    type !== "switchActivePreset"
  ) {
    return null;
  }
  if (type === "switchActivePreset") {
    const presetIdIndex = argv.indexOf("--l4d2-resume-preset-id");
    const presetId = presetIdIndex === -1 ? undefined : argv[presetIdIndex + 1];
    if (presetId === undefined) return null;
    return { type, resumeHandle, presetId };
  }
  return { type, resumeHandle };
}

// ---------------------------------------------------------------------------
// Secuencia de arranque completa.
// ---------------------------------------------------------------------------

export type StartupOutcome =
  | {
      kind: "ready";
      pathDependent: PathDependentDomain;
      /**
       * `true` si esta sesion va a necesitar elevacion UAC en la primera
       * escritura protegida (Seccion 21.4/9.2, aviso previo al dialogo nativo).
       * Calculado UNA SOLA VEZ acá con la MISMA heurística que ya usa el camino
       * PROACTIVO de `ElevationService` (`isElevated()` + `needsElevation`), no
       * es un mecanismo nuevo — solo se adelanta al arranque porque `gameRoot`
       * no cambia durante la sesión. Sigue siendo una OPTIMIZACIÓN: el camino
       * REACTIVO (`#writeStep`/`handleWriteFailure` en `MergeOrchestrator`)
       * sigue siendo la red de seguridad real si esta heurística se equivoca.
       */
      willNeedElevation: boolean;
      /**
       * (BUG-004, A1) HECHO ESTÁTICO: `true` si este proceso arrancó para RESUMIR
       * una sesión pendiente (derivado de `parseResumeArgs(argv)` + sesión
       * pendiente en el LocalStore). Es fijo para toda la vida del proceso — NO
       * un "¿está resumiendo ahora?" mutable —, así que el renderer puede
       * consultarlo una vez al montar sin ventana de carrera. Si es `true`, el
       * renderer escucha el progreso en vivo por `onProgress` (el resume se
       * dispara DESPUÉS de crear la ventana, ver `runResume`) y NO necesita el
       * replay de `bufferedEvents`; el RESULTADO TERMINAL le sigue llegando por
       * `readResumeState().result`.
       */
      isResuming: boolean;
      /**
       * (BUG-004, A1) Dispara el resume de la sesión pendiente. main.ts la invoca
       * DESPUÉS de crear la ventana (no antes), de modo que el renderer ya esté
       * montado y suscripto a `onProgress` para recibir el progreso en vivo. Si
       * `isResuming` es `false`, es un no-op que resuelve de inmediato. Puebla el
       * estado que `readResumeState` expone.
       */
      runResume: () => Promise<void>;
      /**
       * (BUG-004, A1) Lee el `ResumeState` actual (buffer + resultado terminal), o
       * `null` si este proceso no arrancó para resumir. Antes de que `runResume`
       * complete, `result` es `null` (resume en curso); el renderer relee tras el
       * evento terminal de `onProgress`. La capa IPC (`getResumeState`) delega acá.
       */
      readResumeState: () => ResumeState | null;
    }
  | { kind: "fatal"; message: string };

export interface StartupIo {
  argv: readonly string[];
  commandRunner: CommandRunner;
  tempDir: string;
  workRoot: string;
  broadcaster: MergeProgressListener;
  /** (Rediseño Paso 8/8) Broadcaster de `addons:onScanProgress` — ver `createScanProgressBroadcaster`. */
  scanProgressBroadcaster: ScanProgressListener;
}

/**
 * Orquesta el arranque: detecta rutas (Decision Q), persiste si listo (mismo
 * patron D1 del handler detectPaths), construye el dominio dependiente de
 * paths, y si corresponde resume una sesion pendiente ANTES de devolver el
 * control (D2a-i).
 */
export async function runStartupSequence(
  base: PathIndependentDomain,
  io: StartupIo,
): Promise<StartupOutcome> {
  const detection = await base.pathDetector.detect();
  if (detection.kind !== "ready") {
    return {
      kind: "fatal",
      message:
        "No se pudo detectar la instalacion de Left 4 Dead 2 (" +
        detection.reason +
        "). La aplicacion no puede continuar.",
    };
  }
  base.localStore.savePaths(detection.paths);

  // Chequeo barato UNA SOLA VEZ por sesion (Seccion 21.4/9.2): gameRoot no
  // cambia mientras la app corre, asi que la MISMA heuristica que ya usa el
  // camino proactivo de ElevationService (isElevated cacheado + needsElevation,
  // path heuristica + probe write) alcanza para saber de antemano si el primer
  // write protegido va a pedir UAC. Fallo seguro (`false`): si el propio
  // chequeo revienta (I/O inesperado sobre un gameRoot que en teoria ya se
  // verifico en disco), no se aborta el arranque por una OPTIMIZACION - el
  // camino reactivo sigue siendo la red de seguridad real si esto falla.
  let willNeedElevation = false;
  try {
    willNeedElevation =
      !base.elevationService.isElevated() &&
      (await base.elevationService.needsElevation(detection.paths.gameRoot));
  } catch (error) {
    // No se aborta el arranque por esto (es puramente informativo: el chequeo
    // REAL de autorizacion sigue intacto en MergeOrchestrator.ensureCanWrite,
    // que no depende de este valor), pero se deja un rastro - silenciarlo del
    // todo esconderia un fallo real de la heuristica si pasa en produccion por
    // un motivo distinto al ENOENT esperado en los tests con paths ficticios.
    console.warn("No se pudo calcular willNeedElevation; se asume false.", error);
    willNeedElevation = false;
  }

  const resumeBufferRef: { current: MergeProgressEvent[] | null } = { current: null };
  const onProgress = createStartupProgressListener(resumeBufferRef, io.broadcaster);
  const pathDependent = buildPathDependentDomain(detection.paths, base, {
    commandRunner: io.commandRunner,
    tempDir: io.tempDir,
    workRoot: io.workRoot,
    onProgress,
    onScanProgress: io.scanProgressBroadcaster,
  });

  // (BUG-004, A1) `isResuming` es un HECHO ESTÁTICO del arranque: este proceso
  // arrancó con args de resume Y hay una sesión pendiente en el LocalStore. No
  // cambia durante la vida del proceso (el renderer lo consulta una vez sin
  // carrera). NO se resume acá: A1 separa el resume del startup para que main.ts
  // pueda crear la ventana ANTES (así el renderer recibe el progreso en vivo por
  // `onProgress`), y recién entonces dispare `runResume()`.
  const pending = parseResumeArgs(io.argv);
  const isResuming = pending !== null && base.localStore.getPendingSession() !== null;

  // (BUG-007) Captura del Active_Set CANDIDATO ANTES del clear. Se lee una sola
  // vez acá, en la capa de composición, porque `runResume()` disparará
  // `resumePendingOperation()` → `clearPendingSession()` y a partir de entonces
  // `getPendingSession()` devolvería `null`. Como `isResuming` ya implica
  // `getPendingSession() !== null`, `pendingEntries` refleja el candidato real
  // (que puede ser `[]` legítimamente en una sesión activa vacía). El `?? []`
  // cubre además el caso sin resume, donde el valor no se usa. NO se vuelve a
  // llamar `getPendingSession()` después: el resume lo limpia.
  const pendingEntries = base.localStore.getPendingSession() ?? [];

  // Estado del resume, poblado por `runResume`. Si hay resume pendiente arranca
  // "en curso" (`result: null`): el contrato de `ResumeState` ya define que un
  // `result` null con el objeto presente significa "resume en curso, el progreso
  // llega en vivo por merge:onProgress" (Decisión D2a-i).
  let resumeState: ResumeState | null = isResuming
    ? { bufferedEvents: [], result: null, pendingEntries }
    : null;

  const runResume = async (): Promise<void> => {
    if (!isResuming) return; // no-op: este proceso no arrancó para resumir
    // (P-30, Paso 3.5) `isResuming` ya implica `pending !== null` (ver su propia
    // definición arriba), pero TypeScript no liga ambas variables entre sí; el
    // chequeo es redundante en la práctica, no un camino nuevo de "sin resume".
    if (pending === null) return;
    resumeBufferRef.current = [];
    try {
      // `pending` (con `.type`/`.presetId` si aplica) viaja al orquestador para
      // que un resume de "switchActivePreset" complete el switch REAL (hacia la
      // carpeta del preset) en vez de caer al camino legado de applyActiveSet
      // hacia modsvs — cierra la DECISIÓN 8 de merge-orchestrator.ts.
      const result = await pathDependent.mergeOrchestrator.resumePendingOperation(pending);
      // El buffer queda disponible por compatibilidad del contrato; el renderer
      // con isResuming escucha en vivo y lo ignora (no hay duplicación porque
      // elige una sola vía). El RESULTADO TERMINAL vive acá, en `result`.
      resumeState = { bufferedEvents: resumeBufferRef.current ?? [], result, pendingEntries };
    } catch (error) {
      // (BUG-004) Excepción INESPERADA del resume (un throw real, no un
      // OperationResult con status:"failure"). Con A1 el resume corre
      // no-bloqueante desde main.ts, así que este throw ya NO se propaga por el
      // await del startup: si no lo capturáramos acá, `resumeState.result`
      // quedaría en `null` para siempre y el renderer se colgaría en
      // "Restaurando tu selección..." indefinidamente. Poblamos un resultado
      // TERMINAL de fallo para que la UI pueda salir del estado de resume con un
      // mensaje de error en vez de quedar esperando eternamente.
      resumeState = {
        bufferedEvents: resumeBufferRef.current ?? [],
        result: {
          status: "failure",
          error:
            "Error inesperado al restaurar la sesión: " +
            (error instanceof Error ? error.message : String(error)),
        },
        pendingEntries,
      };
    } finally {
      resumeBufferRef.current = null;
    }
  };

  const readResumeState = (): ResumeState | null => resumeState;

  return {
    kind: "ready",
    pathDependent,
    willNeedElevation,
    isResuming,
    runResume,
    readResumeState,
  };
}
