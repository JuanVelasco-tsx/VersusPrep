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
