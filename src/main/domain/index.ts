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
  DEFAULT_EXECUTABLE_NAME,
  batchInternalPaths,
  commandLengthForBatch,
  commandOverheadPrefix,
} from "./vpk-batch.js";
export type { BatchInternalPathsOptions } from "./vpk-batch.js";
