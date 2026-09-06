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
