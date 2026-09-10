/**
 * VpkTool — única puerta al ejecutable `vpk.exe` (AC 6.1, 6.3, 6.12).
 *
 * Encapsula las tres operaciones sobre VPKs que necesita el núcleo de fusión:
 *
 *   - `list(vpkPath, addonId)`  → `vpk l <vpk>`   → paths internos (con `/`), ruido filtrado.
 *   - `extract(vpkPath, internalPaths, destDir, addonId)` → `vpk x <vpk> <path...>` POR LOTES.
 *   - `pack(sourceDir, addonId)` → `vpk <carpeta>` → genera `<carpeta>.vpk`.
 *
 * El diseño (sección "VpkTool") fija la interfaz objetivo y las reglas de
 * ejecución; este módulo las implementa sobre un EJECUTOR DE COMANDOS inyectable
 * ({@link CommandRunner}), de modo que la lógica de wiring (filtrado de ruido +
 * batching + propagación de exit codes) se pueda testear SIN `vpk.exe` real
 * (tarea 2.8). La integración contra el binario real es la tarea 3 (opcional).
 *
 * Este módulo reutiliza las funciones puras ya implementadas en la sección 2:
 *   - `filterVpkNoise` (2.1) para limpiar el stdout de `list`.
 *   - `batchInternalPaths` (2.3) para particionar los paths de `extract`.
 *
 * NOTA sobre separadores (2.5 / AC 6.6): `internalPathToDiskPath` (`/` → `\`)
 * NO se usa aquí. Los argumentos que recibe `vpk x` son los paths INTERNOS del
 * VPK, que usan `/` (formato interno del VPK); se pasan TAL CUAL. La traducción
 * a `\` es exclusivamente para ESCRIBIR en disco (crear subdirectorios y ubicar
 * el archivo extraído), y eso lo hará MergeEngine (tarea 11), no VpkTool. Por
 * eso este archivo NO importa `internalPathToDiskPath`.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN: qué se considera "éxito" de una invocación.
 *
 * El diseño habla de "cualquier exit distinto de éxito" sin fijar el valor
 * numérico del éxito. Este módulo adopta la CONVENCIÓN universal de procesos:
 * `exitCode === 0` es éxito; cualquier otro valor (incluido el `-1` observado
 * empíricamente al pasar demasiados argumentos) es fallo y se propaga como
 * {@link VpkToolError}. Se centraliza en {@link SUCCESS_EXIT_CODE} para que el
 * criterio sea único y explícito.
 * ---------------------------------------------------------------------------
 */

import { batchInternalPaths } from "./vpk-batch.js";
import { filterVpkNoise } from "./vpk-noise-filter.js";

/**
 * Código de salida que se considera "éxito" de una invocación de `vpk.exe`.
 * Convención universal de procesos (0 = OK). Ver la DECISIÓN en el encabezado.
 */
export const SUCCESS_EXIT_CODE = 0;

/**
 * Límite compartido de concurrencia para invocaciones de `vpk.exe` lanzadas
 * en lote sobre múltiples addons (p. ej. `VScriptDetector.classify` vía
 * `classifyWithBoundedConcurrency` en `ipc-handlers.ts`, y
 * `MergeEngine.preview` vía su propio pool de workers). Un ÚNICO valor
 * compartido (adición de scope de la Sección 21.2, hallazgo de
 * `/code-review ultra`) para que ambos límites no puedan desincronizarse:
 * el recurso que protegen es el mismo (cuántos procesos `vpk.exe`
 * concurrentes tolera razonablemente la máquina del usuario), aunque cada
 * llamador lo aplique sobre una operación distinta (`list` en ambos casos,
 * hoy).
 */
export const DEFAULT_VPK_CONCURRENCY = 4;

/**
 * Operación de `VpkTool` que originó un error. Se usa como discriminante de
 * {@link VpkToolError.operation} para que el llamador (MergeEngine, tarea 11)
 * sepa en qué fase falló el addon.
 */
export type VpkOperation = "list" | "extract" | "pack";

/**
 * Resultado crudo de ejecutar un proceso: exit code + stdout + stderr.
 *
 * Se modela con los tres campos SIEMPRE presentes (aunque `stdout`/`stderr`
 * puedan ser cadenas vacías) para que `list()` pueda aplicar `filterVpkNoise`
 * al `stdout` y para que {@link VpkToolError} pueda adjuntar `stderr` como
 * contexto de diagnóstico. No se usan campos opcionales aquí a propósito: bajo
 * `exactOptionalPropertyTypes` es más simple y predecible que el ejecutor
 * normalice ausencia de salida a `""` que propagar `undefined`.
 */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Opciones de una invocación de comando. `cwd` es el working directory del
 * proceso, necesario para `extract` (el diseño indica que `vpk x` se invoca con
 * `destDir` como working directory, porque `vpk x` NO crea carpetas: el
 * llamador las crea y el proceso escribe relativo a su cwd).
 *
 * `cwd` es OPCIONAL. Bajo `exactOptionalPropertyTypes`, "opcional" significa que
 * la propiedad puede OMITIRSE por completo (no que pueda valer `undefined`);
 * `list` y `pack` simplemente no la pasan.
 */
export interface CommandRunOptions {
  cwd?: string;
}

/**
 * Abstracción inyectable de la EJECUCIÓN de un proceso externo (`vpk.exe`).
 *
 * Por qué se inyecta (diseño "dominio desacoplado de Electron"): permite testear
 * `VpkTool` con un runner mockeado en memoria (tarea 2.8), sin depender del
 * binario `vpk.exe` ni del filesystem. La implementación real con
 * `child_process` (`execFile`/`spawn`) se ejercita en la tarea 3.
 *
 * Por qué `args` es un `readonly string[]` (argumentos como ARRAY y no un string
 * de shell): evita el quoting/escaping del shell y sus problemas con espacios y
 * caracteres especiales en las rutas. Los argumentos se pasan literalmente al
 * proceso, sin interpretación de shell. Toda invocación de `VpkTool` construye
 * este array explícitamente y NUNCA interpola valores en un string de comando.
 *
 * El contrato: `run` resuelve con un {@link CommandResult} (exit + stdout +
 * stderr) para CUALQUIER terminación del proceso —incluido exit ≠ 0—; VpkTool
 * decide qué es éxito (exit 0) y qué es fallo. El runner solo rechaza la promesa
 * si el proceso no pudo siquiera lanzarse (p. ej. ejecutable inexistente); ese
 * rechazo se deja propagar tal cual (no es un exit code que VpkTool pueda
 * interpretar como fallo tipado de `vpk`).
 */
export interface CommandRunner {
  run(
    executable: string,
    args: readonly string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult>;
}

/**
 * Argumentos de construcción de {@link VpkToolError}. Se agrupan en un objeto
 * para legibilidad y para poder marcar `stderr` como opcional de forma segura
 * bajo `exactOptionalPropertyTypes`.
 */
export interface VpkToolErrorInit {
  addonId: string;
  operation: VpkOperation;
  exitCode: number;
  /** stderr del proceso, como contexto de diagnóstico. Puede omitirse. */
  stderr?: string;
}

/**
 * Error TIPADO que se lanza cuando `vpk.exe` termina con un exit distinto de
 * éxito (AC 6.12). Identifica el ADDON afectado para que MergeEngine (tarea 11)
 * pueda abortar la operación informando CUÁL addon falló.
 *
 * Forma (decisión documentada): clase que extiende `Error`, con `name` propio
 * (`"VpkToolError"`) para poder discriminarla por tipo, y propiedades tipadas
 * de solo lectura:
 *   - `addonId`: identificador del addon en cuya operación ocurrió el fallo.
 *   - `operation`: `"list" | "extract" | "pack"`, la fase que falló.
 *   - `exitCode`: el código de salida ≠ 0 devuelto por `vpk.exe`.
 *   - `stderr` (opcional): salida de error del proceso, como contexto.
 *
 * `stderr` es opcional (bajo `exactOptionalPropertyTypes`): solo se asigna la
 * propiedad si se proveyó un valor; nunca se asigna `undefined` explícito.
 */
export class VpkToolError extends Error {
  readonly addonId: string;
  readonly operation: VpkOperation;
  readonly exitCode: number;
  readonly stderr?: string;

  constructor(init: VpkToolErrorInit) {
    const base = `vpk ${init.operation} falló para el addon "${init.addonId}" (exit ${init.exitCode})`;
    super(init.stderr ? `${base}: ${init.stderr}` : base);
    this.name = "VpkToolError";
    this.addonId = init.addonId;
    this.operation = init.operation;
    this.exitCode = init.exitCode;
    // Bajo exactOptionalPropertyTypes solo se asigna si hay valor real; así la
    // propiedad queda "ausente" (no `undefined`) cuando no se provee stderr.
    if (init.stderr !== undefined) {
      this.stderr = init.stderr;
    }
    // Mantiene la cadena de prototipos correcta al extender Error compilando a
    // ES2022 (necesario para que `instanceof VpkToolError` funcione en runtime).
    Object.setPrototypeOf(this, VpkToolError.prototype);
  }
}

/**
 * DECISIÓN: cómo `VpkTool` recibe el `addonId` y el ejecutable `vpk.exe`.
 *
 * - `vpkExe` (ruta al ejecutable, p. ej. `GamePaths.vpkToolPath`) se inyecta en
 *   el CONSTRUCTOR, junto con el {@link CommandRunner}: es una dependencia
 *   estable durante toda la vida de la instancia (no cambia entre operaciones),
 *   así que va una sola vez y no ensucia cada llamada a método.
 *
 * - `addonId` se pasa como PARÁMETRO de CADA método (`list`/`extract`/`pack`).
 *   El diseño describe el addonId como "parámetro que recibirá VpkTool para
 *   saber a qué addon corresponde la operación"; se interpreta literalmente como
 *   un parámetro por método. Motivo: una misma instancia de `VpkTool` (mismo
 *   `vpk.exe`) opera sobre MÚLTIPLES addons durante una fusión, y cada operación
 *   debe poder etiquetar su eventual {@link VpkToolError} con el addon correcto,
 *   sin reconstruir la herramienta por addon.
 *
 * MergeEngine (tarea 11) y los unit tests (2.8) dependen de esta firma.
 *
 * Se elige una CLASE (y no una factory) para mantener la dependencia inyectada
 * como estado privado inmutable y exponer los tres métodos de la interfaz de
 * diseño de forma directa.
 */
export class VpkTool {
  readonly #runner: CommandRunner;
  readonly #vpkExe: string;

  /**
   * @param runner Ejecutor de comandos inyectado (real en tarea 3, mock en 2.8).
   * @param vpkExe Ruta al ejecutable `vpk.exe` (p. ej. `GamePaths.vpkToolPath`).
   */
  constructor(runner: CommandRunner, vpkExe: string) {
    this.#runner = runner;
    this.#vpkExe = vpkExe;
  }

  /**
   * Lista el contenido de un VPK: `vpk l <vpkPath>`.
   *
   * Si el exit ≠ 0, lanza {@link VpkToolError} (operation `"list"`). En éxito,
   * aplica `filterVpkNoise` al stdout (AC 6.2) y devuelve las líneas de
   * contenido (paths internos con `/`, ruido descartado).
   *
   * @param vpkPath Ruta al VPK a listar.
   * @param addonId Addon al que pertenece la operación (para el error tipado).
   */
  async list(vpkPath: string, addonId: string): Promise<string[]> {
    const result = await this.#runner.run(this.#vpkExe, ["l", vpkPath]);
    this.#assertSuccess(result, addonId, "list");
    return filterVpkNoise(result.stdout);
  }

  /**
   * Extrae `internalPaths` de un VPK a `destDir`: `vpk x <vpkPath> <path...>`,
   * POR LOTES (AC 6.4, 6.5).
   *
   * Particiona los paths con `batchInternalPaths` (2.3) para que ninguna línea
   * de comando exceda el límite seguro, y ejecuta un `vpk x` por lote con
   * `destDir` como working directory (AC 6.3: `vpk x` NO crea carpetas; el
   * llamador —MergeEngine— crea los subdirectorios y el proceso escribe relativo
   * a su cwd). Los paths se pasan TAL CUAL (con `/`, formato interno del VPK);
   * no se traducen separadores aquí (ver nota de separadores en el encabezado).
   *
   * Si algún lote devuelve exit ≠ 0, lanza {@link VpkToolError} (operation
   * `"extract"`) identificando el addon y ABORTA: no ejecuta los lotes
   * restantes. En éxito resuelve `void`.
   *
   * @param vpkPath Ruta al VPK de origen.
   * @param internalPaths Paths internos a extraer (con `/`).
   * @param destDir Working directory de la extracción (destino base).
   * @param addonId Addon al que pertenece la operación (para el error tipado).
   */
  async extract(
    vpkPath: string,
    internalPaths: readonly string[],
    destDir: string,
    addonId: string,
  ): Promise<void> {
    const batches = batchInternalPaths(internalPaths, vpkPath);
    for (const batch of batches) {
      const result = await this.#runner.run(this.#vpkExe, ["x", vpkPath, ...batch], {
        cwd: destDir,
      });
      // Aborta en el PRIMER lote fallido, sin ejecutar los siguientes.
      this.#assertSuccess(result, addonId, "extract");
    }
  }

  /**
   * Empaqueta una carpeta en un VPK: `vpk <sourceDir>`.
   *
   * El subcomando de empaquetado de `vpk.exe` es, simplemente, pasarle la
   * carpeta como único argumento; genera un VPK hermano cuyo nombre es el de la
   * carpeta con la extensión `.vpk` añadida (`<sourceDir>.vpk`). La ruta de
   * salida se DERIVA concatenando `".vpk"` a `sourceDir`, replicando lo que hace
   * el propio `vpk.exe` (no se infiere del stdout).
   *
   * Si el exit ≠ 0, lanza {@link VpkToolError} (operation `"pack"`). En éxito
   * devuelve la ruta del `.vpk` generado.
   *
   * @param sourceDir Carpeta a empaquetar.
   * @param addonId Addon al que pertenece la operación (para el error tipado).
   * @returns Ruta del VPK generado (`<sourceDir>.vpk`).
   */
  async pack(sourceDir: string, addonId: string): Promise<string> {
    const result = await this.#runner.run(this.#vpkExe, [sourceDir]);
    this.#assertSuccess(result, addonId, "pack");
    return `${sourceDir}.vpk`;
  }

  /**
   * Lanza {@link VpkToolError} si `result.exitCode` no es
   * {@link SUCCESS_EXIT_CODE}. Centraliza el criterio de éxito para las tres
   * operaciones y adjunta el `stderr` como contexto (solo si es no vacío).
   */
  #assertSuccess(result: CommandResult, addonId: string, operation: VpkOperation): void {
    if (result.exitCode === SUCCESS_EXIT_CODE) {
      return;
    }
    throw new VpkToolError({
      addonId,
      operation,
      exitCode: result.exitCode,
      ...(result.stderr ? { stderr: result.stderr } : {}),
    });
  }
}
