/**
 * Barrel del módulo de dominio. Re-exporta los tipos compartidos para permitir
 * importaciones estables desde el resto del proceso main:
 *
 *   import type { GamePaths, ScannedAddon } from "../domain/index.js";
 */
export type {
  GamePaths,
  LibraryEntry,
  AddonInfo,
  ScannedAddon,
  VScriptClassification,
  ExtractedRoot,
  FileCollision,
  MergeReport,
  AddonManifestEntry,
  PendingOperation,
  ElevationOutcome,
  OperationResult,
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
export { SUCCESS_EXIT_CODE, VpkTool, VpkToolError } from "./vpk-tool.js";
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
