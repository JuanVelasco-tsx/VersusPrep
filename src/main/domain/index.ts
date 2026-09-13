/**
 * Barrel del módulo de dominio. Re-exporta los tipos compartidos para permitir
 * importaciones estables desde el resto del proceso main:
 *
 *   import type { GamePaths, ScannedAddon } from "../domain/index.js";
 */
export type {
  GamePaths,
  LibraryEntry,
  RequiredPathKey,
  PathVerification,
  PathDetectionSource,
  PathDetectionFailureReason,
  PathDetectionResult,
  AddonInfo,
  ScannedAddon,
  VScriptClassification,
  ExtractedRoot,
  FileCollision,
  MergeReport,
  BackupResult,
  GameInfoEditCase,
  GameInfoEditResult,
  AddonManifestEntry,
  PendingOperation,
  ElevationOutcome,
  OperationResult,
  UnavailablePreviewAddon,
  MergePreview,
  ActiveSetPreview,
  MergeProgressEvent,
  MergeProgressListener,
} from "./types.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 6.2 — VpkTool): filtrado de ruido del stdout de vpk.exe.
// A diferencia del resto del barrel (solo tipos), aquí se re-exporta código de
// runtime porque `VpkTool.list()` (tarea 2.7) lo consumirá desde el dominio.
// ---------------------------------------------------------------------------
export {
  VPK_NOISE_PREFIXES,
  filterVpkNoise,
  filterNoiseLines,
  isVpkNoiseLine,
} from "./vpk-noise-filter.js";
export type { VpkNoisePrefix } from "./vpk-noise-filter.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 6.4, 6.5 — VpkTool): batching de la extracción `vpk x`
// por longitud de línea de comando. Al igual que el filtrado de ruido, es
// código de runtime (no solo tipos) porque `VpkTool.extract()` (tarea 2.7) lo
// consumirá desde el dominio para particionar los paths antes de invocar vpk.
// ---------------------------------------------------------------------------
export {
  DEFAULT_MAX_COMMAND_LENGTH,
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_EXECUTABLE_NAME,
  batchInternalPaths,
  commandLengthForBatch,
  commandOverheadPrefix,
} from "./vpk-batch.js";
export type { BatchInternalPathsOptions } from "./vpk-batch.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 6.6 — VpkTool): traducción del separador de path interno
// del VPK (`/`) al separador de disco de Windows (`\`). Igual que el filtrado y
// el batching, es código de runtime (no solo tipos) porque MergeEngine (tarea
// 11) lo consumirá desde el dominio para construir los paths de destino al
// escribir los archivos extraídos.
// ---------------------------------------------------------------------------
export {
  VPK_INTERNAL_SEPARATOR,
  DISK_SEPARATOR,
  internalPathToDiskPath,
} from "./vpk-path.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 6.1, 6.3, 6.12 — VpkTool): única puerta a `vpk.exe`.
// Reúne el filtrado de ruido (2.1) y el batching (2.3) sobre un ejecutor de
// comandos inyectable, y propaga los exit ≠ 0 como `VpkToolError` tipado que
// identifica el addon. MergeEngine (tarea 11) y los tests (2.8) lo consumen.
// ---------------------------------------------------------------------------
export { SUCCESS_EXIT_CODE, DEFAULT_VPK_CONCURRENCY, VpkTool, VpkToolError } from "./vpk-tool.js";
export type {
  CommandResult,
  CommandRunner,
  CommandRunOptions,
  VpkOperation,
  VpkToolErrorInit,
} from "./vpk-tool.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 1 — PathDetector): parseo del `libraryfolders.vdf`
// (formato KeyValues de Valve) y selección de la primera biblioteca que contiene
// L4D2 (`apps.550`) en orden de aparición (AC 1.3, 1.5, 1.6 — Tarea 5.1). La
// lectura desde disco/registro y la derivación de rutas quedan para la tarea 5.3.
// ---------------------------------------------------------------------------
export {
  LIBRARY_FOLDERS_ROOT_KEY,
  LIBRARY_PATH_KEY,
  LIBRARY_APPS_KEY,
  parseVdf,
  parseLibraryFolders,
} from "./vdf-parser.js";
export type { VdfNode, VdfEntry } from "./vdf-parser.js";

export { L4D2_APP_ID, findGameLibrary } from "./path-detector.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 1 — PathDetector, Tarea 5.3): lectura del registro,
// derivación de rutas y verificación en disco, orquestadas por `detect()` sobre
// dependencias inyectables (registro + FS + selección manual). El constructor
// `pathsReady` centraliza el invariante "no hay rutas listas para persistir sin
// verificación en disco previa" (lo prueba la Tarea 5.4 / Property 2).
// ---------------------------------------------------------------------------
export {
  STEAM_REGISTRY_HIVE,
  STEAM_REGISTRY_KEY,
  STEAM_REGISTRY_VALUE,
  PathDetector,
  pathsReady,
} from "./path-detector.js";
export type {
  RegistryReader,
  FileReadResult,
  FileSystemProbe,
  ManualPathRequest,
  ManualPathResponse,
  ManualPathProvider,
  PathDetectorDeps,
} from "./path-detector.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 2 — AddonScanner): escaneo de la Workshop_Folder.
// Exporta la clase `AddonScanner`, su interfaz de FS PROPIA (`AddonFileSystem`,
// `DirEntry`) inyectable para tests, y el extractor ad-hoc de `addoninfo.txt`
// (`extractAddonInfo`), expuesto para poder testearlo aislado (tarea 6.1).
// ---------------------------------------------------------------------------
export { AddonScanner } from "./addon-scanner.js";
export { TitleCache } from "./title-cache.js";
export type { AddonFileSystem, DirEntry } from "./addon-scanner.js";
export { extractAddonInfo } from "./addoninfo-extract.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 3 — VScriptDetector): clasificación anti-VScript a partir
// del listado REAL del VPK (`VpkTool.list`), nunca del flag `addonContent_Script`.
// Se re-exporta código de runtime (la clase orquestadora y el núcleo puro de
// match) además de sus constantes, para que la capa IPC (tarea 20) y los tests
// (tareas 7.1/7.2) lo consuman desde el dominio. El núcleo puro se expone
// aparte para poder testear el match de paths de forma aislada (property 7.2).
// ---------------------------------------------------------------------------
export {
  VSCRIPTS_PREFIX,
  VSCRIPT_EXTENSION,
  classifyVScriptPaths,
  isVScriptPath,
  VScriptDetector,
} from "./vscript-detector.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 3 — AC 3.6, 3.7, 3.8): política PURA de inclusión de
// addons en el Active_Set. Decide si un Addon se incluye según su clasificación
// VScript y la confirmación explícita de forzado del usuario (bloqueo por
// defecto de los VScript_Addon salvo forzado). La ADVERTENCIA visual del AC 3.6
// es responsabilidad de la UI; aquí solo vive la decisión de inclusión. La capa
// IPC/orquestador (tareas 18/20) y los tests (tareas 8.1/8.2) la consumen.
// ---------------------------------------------------------------------------
export { isAllowedInActiveSet, isVScriptAddonAllowedInput } from "./active-set-policy.js";
export type { ActiveSetInclusionInput } from "./active-set-policy.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 7 — CollisionResolver, Tarea 10.1): fusión del contenido
// extraído con la política "el último del Priority_Order gana", copiando en
// orden ascendente y sobrescribiendo en colisión. Registra las File_Collision
// en el MergeReport (contributors + winner). Expone la clase orquestadora y su
// contrato de FS PROPIO inyectable (`CollisionFileSystem`, `WalkedFile`) para
// testear sin disco real. MergeEngine (tarea 11) y los tests (10.1/10.3) lo
// consumen desde el dominio.
// ---------------------------------------------------------------------------
export { CollisionResolver } from "./collision-resolver.js";
export type { CollisionFileSystem, WalkedFile } from "./collision-resolver.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 6.7, 7.1, 7.2 — CollisionResolver, Tarea 10.2): NÚCLEO
// PURO de la resolución de colisiones. Dada, por addon, la lista de paths que
// aporta en Priority_Order ASCENDENTE, `resolveMerge` decide de forma
// determinista y SIN I/O el ganador de cada path (el último del Priority_Order)
// y arma las File_Collision del MergeReport. `CollisionResolver.mergeInto`
// (10.1) delega aquí la decisión; se re-exporta la normalización de clave
// (`toCollisionKey`) que ambos comparten. El property test (Tarea 10.3,
// Property 11) consume este núcleo para verificar determinismo y "el último gana".
// ---------------------------------------------------------------------------
export { resolveMerge, toCollisionKey } from "./collision-core.js";
export type {
  AddonContribution,
  ResolvedWinner,
  ResolvedMerge,
} from "./collision-core.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 6 — MergeEngine, Tarea 11.1): núcleo de la fusión.
// Orquesta el flujo list → crear subdirectorios → extraer por lotes (vía
// VpkTool) → fusionar "el último gana" (delegando en CollisionResolver) →
// empaquetar `pak01_dir.vpk` (AC 6.3, 6.7, 6.8, 6.12). Deja propagar el
// `VpkToolError` (ya identifica el addon) para abortar ante un exit ≠ éxito.
// Expone la clase orquestadora y su contrato de FS PROPIO inyectable
// (`MergeFileSystem`, solo `ensureDir`) para testear sin disco real. El
// orquestador (tarea 18) y los unit tests (11.2) lo consumen desde el dominio.
// ---------------------------------------------------------------------------
export { MergeEngine } from "./merge-engine.js";
export type { MergeFileSystem } from "./merge-engine.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 5 — BackupManager, Tarea 12.1): backup de un unico
// nivel del pak01_dir.vpk en modsvs/ antes de sobrescribir. Propaga el fallo
// de copia para que el orquestador aborte (AC 5.2); devuelve BackupResult
// (union por `created`, sin `ok`) para distinguir backup creado vs. primera
// instalacion sin archivo previo (AC 5.1, 5.3). Expone la clase y su contrato
// de FS PROPIO inyectable (BackupFileSystem) para testear sin disco real.
// ---------------------------------------------------------------------------
export { BackupManager } from "./backup-manager.js";
export type { BackupFileSystem } from "./backup-manager.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 6 — GameInfoEditor, Tarea 13.1): garantiza que
// `Game modsvs` sea la primera y única entrada del bloque SearchPaths del
// gameinfo.txt (AC 6.10). Transformación POR LÍNEAS que preserva formato,
// comentarios y EOL; lanza GameInfoEditError si no hay bloque SearchPaths.
// Expone la clase, su contrato de FS PROPIO inyectable (GameInfoFileSystem),
// el error tipado y el núcleo puro (ensureModsvsFirstInContent) para testearlo
// sin disco (Property 12, tarea 13.2). El orquestador (tarea 18) lo consume.
// ---------------------------------------------------------------------------
export { GameInfoEditor, GameInfoEditError, ensureModsvsFirstInContent } from "./game-info-editor.js";
export type {
  GameInfoFileSystem,
  GameInfoEditOutcome,
  GameInfoEditErrorReason,
} from "./game-info-editor.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 4 — ProcessGuard, Tarea 14.1): deteccion del proceso
// `left4dead2.exe` (NO `hl2.exe`) para que el orquestador (tarea 18) aborte e
// informe si el juego esta corriendo antes de fusionar/instalar (AC 4.1, 4.2).
// El matching es EXACTO y case-insensitive sobre el basename del nombre de
// proceso (soporta `\` y `/`). Expone la clase, la constante del nombre buscado
// y el contrato inyectable `ProcessListProvider` (SOLO interfaz: la enumeracion
// real de procesos queda pendiente para el orquestador/IPC). El orquestador
// (tarea 18) y los unit tests (14.2) lo consumen desde el dominio.
// ---------------------------------------------------------------------------
export { GAME_PROCESS_NAME, ProcessGuard } from "./process-guard.js";
export type { ProcessListProvider } from "./process-guard.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 8 — LocalStore, Sección 15): persistencia del Active_Set
// y las rutas verificadas sobre SQLite (`better-sqlite3`), con la `Database`
// inyectada por constructor (patrón `CommandRunner`/`*FileSystem`). Persiste las
// GamePaths (AC 1.13, merge parcial), el Addon_Manifest instalado (AC 8.1, 8.6,
// solo `{ addonId, priorityOrder }`) y el ESTADO DE SESIÓN PENDIENTE del relanzo
// elevado (savePendingSession/getPendingSession/clearPendingSession, AC 9.2);
// esta sección solo implementa el ciclo de vida de ese estado, no su consumo
// (eso es la tarea 17 / ElevationService). Expone la interfaz `LocalStore`
// desacoplada del motor y la implementación `SqliteLocalStore`. El orquestador
// (tarea 18), ElevationService (tarea 17) y la capa IPC (tarea 20) la consumen.
// ---------------------------------------------------------------------------
export { SqliteLocalStore } from "./local-store.js";
export type { LocalStore } from "./local-store.js";

// ---------------------------------------------------------------------------
// Runtime (Requirement 9.2 — ElevationService, Sección 17): estrategia de
// elevación UAC bajo demanda. Decide por dos caminos —proactivo (`ensureCanWrite`)
// y reactivo (`handleWriteFailure`)— si hace falta elevar y, de ser así, persiste
// el Active_Set candidato vía `LocalStore.savePendingSession` y re-lanza la app
// con `runas` (la instancia elevada rehidrata del LocalStore, no de la línea de
// comando). Ambos caminos chequean `isElevated()` primero (elevación una vez por
// sesión). La lógica de decisión es PURA; los efectos de SO (probe write, relanzo
// `runas`) viven en el proveedor inyectable `ElevationOsProvider` (SOLO contrato:
// la implementación real de Windows queda pendiente para la composición, igual que
// `ProcessListProvider`). Las firmas divergen de design.md sumando `entries`
// (DECISIÓN 1 del módulo, precedente MergeEngine DECISIÓN 6). Expone la clase
// `ElevationServiceImpl`, sus helpers/constantes y los tipos del contrato y del
// proveedor inyectable. El orquestador (tarea 18) lo consume.
// ---------------------------------------------------------------------------
export {
  ElevationServiceImpl,
  isPermissionError,
  PROTECTED_PATH_PREFIXES,
  PERMISSION_ERROR_CODES,
  PENDING_SESSION_HANDLE,
} from "./elevation-service.js";
export type {
  ElevationService,
  ElevationOsProvider,
  RelaunchOutcome,
} from "./elevation-service.js";
// ---------------------------------------------------------------------------
// Runtime (Requisitos 4, 5, 6, 8, 9.2 — MergeOrchestrator, Sección 18): capa de
// APLICACIÓN que coordina el flujo completo (ProcessGuard -> resolver Active_Set
// -> ElevationService proactivo -> backup -> merge -> instalar en modsvs/ ->
// gameinfo -> saveManifest -> notificar), con manejo REACTIVO de EACCES/EPERM vía
// ElevationService.handleWriteFailure y limpieza del workDir en todos los casos
// (resuelve P-14). Implementa applyActiveSet/addAddon/removeAddon (18.1) y el
// resume de la instancia elevada (18.2). Expone la clase `MergeOrchestrator`, su
// contrato de FS PROPIO inyectable (`MergeOrchestratorFileSystem`) y el tipo de
// dependencias inyectadas (`MergeOrchestratorDeps`). La capa IPC (Tarea 20) lo
// consume.
// ---------------------------------------------------------------------------
export { MergeOrchestrator } from "./merge-orchestrator.js";
export type {
  MergeOrchestratorFileSystem,
  MergeOrchestratorDeps,
} from "./merge-orchestrator.js";

// ---------------------------------------------------------------------------
// Convencion compartida del Addon_Cover (extraida en el refactor que cerro el
// hallazgo de COVER_EXTENSION duplicado entre AddonScanner y Cover_Resolver -
// ver Context/04-historial-decisiones.md). Unica fuente de verdad de la
// extension del archivo de portada; ni addon-scanner.ts ni cover-resolver.ts
// dependen el uno del otro para esto.
// ---------------------------------------------------------------------------
export { COVER_EXTENSION } from "./addon-cover.js";

// ---------------------------------------------------------------------------
// Runtime (Tarea 21.1, Bloque 1 - Cover_Resolver): logica PURA de resolucion y
// validacion del path del Addon_Cover para el protocolo custom
// `l4d2cover://<id>`. Valida el id por patron conservador (defensa capa 1),
// arma `<workshopFolder>\<id>.jpg`, confirma contencion dentro de la
// Workshop_Folder (defensa capa 2) y chequea existencia via un `fileExists`
// inyectado (testeable sin Electron). El wiring de `protocol.handle` vive en
// main.ts y consume `resolveCoverPath` desde el dominio.
// ---------------------------------------------------------------------------
export {
  COVER_ID_PATTERN,
  isValidCoverId,
  isWithinBase,
  decodeCoverId,
  resolveCoverPath,
} from "./cover-resolver.js";
export type {
  CoverResolution,
  CoverResolutionFailure,
  CoverFileExists,
} from "./cover-resolver.js";
