/**
 * `ChildProcessCommandRunner` — implementación REAL de {@link CommandRunner}
 * sobre `node:child_process` (tarea 3).
 *
 * Es la contraparte de producción del `CommandRunner` inyectable que define el
 * dominio (`src/main/domain/vpk-tool.ts`): mientras los unit tests de la tarea
 * 2.8 usan un runner mockeado en memoria, esta clase ejecuta `vpk.exe` de
 * verdad para el test de integración (3.2) y, más adelante, para el MergeEngine.
 *
 * ---------------------------------------------------------------------------
 * CONTRATO CRÍTICO (documentado en el historial de decisiones, tarea 2.7):
 *
 *   `run()` DEBE RESOLVER con un {@link CommandResult} para CUALQUIER
 *   terminación del proceso, INCLUIDO exit ≠ 0. El runner NO decide qué es
 *   éxito; solo transporta `exitCode` + `stdout` + `stderr`. `VpkTool` es quien
 *   aplica la política de éxito (`exitCode === 0`) y envuelve los fallos en
 *   `VpkToolError`. Por eso, si `vpk.exe` corre y sale con `-1` (el caso que
 *   justamente queremos observar al pasar cientos de argumentos), el runner
 *   RESUELVE con `{ exitCode: -1, ... }`, NO rechaza.
 *
 *   El runner SOLO rechaza la promesa si el proceso NO PUDO SIQUIERA LANZARSE
 *   (p. ej. el ejecutable no existe → `ENOENT`, o falta de permisos para
 *   spawnear → `EACCES`/`EPERM`). Ese caso es un error de invocación, no un exit
 *   code que `VpkTool` pueda interpretar como fallo tipado de `vpk`.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN — `execFile` (con callback) envuelto en Promise, y NO `spawn`:
 *
 *   `execFile` invoca el ejecutable DIRECTAMENTE, sin pasar por un shell
 *   (`shell: false` es su comportamiento por defecto). Esto es exactamente lo
 *   que el diseño de `VpkTool` exige: argumentos como ARRAY, sin quoting/escaping
 *   de shell, para que los paths con espacios o caracteres especiales lleguen
 *   LITERALMENTE al proceso. `execFile` además acumula stdout/stderr por
 *   nosotros y entrega el resultado en un único callback, lo que simplifica el
 *   envoltorio en Promise frente a `spawn` (que exigiría cablear los eventos
 *   `data`/`close`/`error` a mano). No se necesita streaming incremental aquí,
 *   así que `execFile` es la opción más simple y correcta.
 *
 * DISTINCIÓN "no se pudo lanzar" vs "salió ≠ 0" (clave del contrato):
 *
 *   El callback de `execFile` recibe `error` no nulo en DOS situaciones
 *   distintas que hay que separar:
 *     1. El proceso NO se pudo lanzar (p. ej. `error.code === "ENOENT"`): NO
 *        hay exit code numérico del proceso (`typeof error.code !== "number"`).
 *        → RECHAZAMOS: es un fallo de invocación, no un exit de `vpk`.
 *     2. El proceso CORRIÓ pero salió ≠ 0 (o murió por señal): Node adjunta el
 *        exit code numérico en `error.code` (y la señal en `error.signal`).
 *        → RESOLVEMOS con ese `exitCode`, capturando stdout/stderr acumulados
 *          hasta ese punto (Node los pasa igual en el callback).
 *
 *   Se distingue por el TIPO de `error.code`: `number` ⇒ exit del proceso
 *   (resolver); string como `"ENOENT"` (o ausente) ⇒ fallo de lanzamiento
 *   (rechazar). Si el proceso muere por señal sin exit numérico, se normaliza a
 *   un exit no-cero convencional para que `VpkTool` lo trate como fallo.
 *
 * DECISIÓN — `encoding: "utf8"` y `maxBuffer` grande:
 *
 *   - `encoding: "utf8"` hace que `stdout`/`stderr` lleguen como STRING (no
 *     Buffer), que es lo que espera `CommandResult`. `vpk.exe` emite texto.
 *   - `maxBuffer` se sube MUY por encima del default de Node (1 MiB). `vpk l`
 *     sobre un VPK de >200 archivos produce cientos de líneas de paths; aunque
 *     hoy quepa en 1 MiB, un addon real grande podría acercarse, y superar
 *     `maxBuffer` haría que `execFile` MATE el proceso y devuelva un error
 *     `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` (que NO es un exit de `vpk`). Para no
 *     confundir ese caso con un fallo real de `vpk`, se fija un buffer holgado
 *     (64 MiB). Es memoria transitoria solo mientras corre el comando.
 */

import { execFile } from "node:child_process";

import type {
  CommandResult,
  CommandRunner,
  CommandRunOptions,
} from "../domain/index.js";

/**
 * Tamaño máximo (en bytes) de stdout/stderr que `execFile` bufferiza antes de
 * abortar el proceso. Se fija en 64 MiB, holgadamente por encima del default de
 * Node (1 MiB), porque `vpk l` de un VPK grande puede producir mucha salida (ver
 * DECISIÓN sobre `maxBuffer` en el encabezado del archivo).
 */
export const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Exit code convencional con el que se normaliza la muerte por SEÑAL de un
 * proceso que no reportó exit numérico. Cualquier valor ≠ 0 basta para que
 * `VpkTool` lo trate como fallo; se usa 1 por convención.
 */
const SIGNAL_TERMINATION_EXIT_CODE = 1;

/**
 * Forma mínima del error que `execFile` entrega en su callback. Node adjunta
 * `code` (número = exit del proceso; string como `"ENOENT"` = fallo de
 * lanzamiento) y opcionalmente `signal`. Se tipa localmente para inspeccionarlo
 * sin depender de tipos internos de Node.
 */
interface ExecFileError extends Error {
  code?: number | string;
  signal?: NodeJS.Signals | null;
}

/**
 * `CommandRunner` real basado en `execFile`. Sin estado: una única instancia
 * puede reutilizarse para todas las invocaciones de `vpk.exe`.
 *
 * @see CommandRunner (contrato) en `src/main/domain/vpk-tool.ts`.
 */
export class ChildProcessCommandRunner implements CommandRunner {
  readonly #maxBuffer: number;

  /**
   * @param maxBuffer Límite de buffer de stdout/stderr en bytes. Por defecto
   *   {@link DEFAULT_MAX_BUFFER} (64 MiB). Sobreescribible para tests.
   */
  constructor(maxBuffer: number = DEFAULT_MAX_BUFFER) {
    this.#maxBuffer = maxBuffer;
  }

  /**
   * Ejecuta `executable` con `args` (como array, sin shell). Resuelve con el
   * {@link CommandResult} para CUALQUIER exit (incluido ≠ 0); solo rechaza si el
   * proceso no pudo lanzarse. Ver el contrato en el encabezado del archivo.
   */
  run(
    executable: string,
    args: readonly string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      // `execFile` acepta un array de args y NO usa shell (shell: false por
      // defecto): los args llegan literalmente al proceso, sin quoting de shell.
      execFile(
        executable,
        // Copia defensiva a array mutable: `execFile` tipa `args` como
        // `readonly string[] | null | undefined`, pero preferimos pasar un
        // array propio y no la referencia readonly del llamador.
        [...args],
        {
          encoding: "utf8",
          maxBuffer: this.#maxBuffer,
          // `cwd` solo se incluye si el llamador lo proveyó (bajo
          // exactOptionalPropertyTypes no se asigna `undefined` explícito).
          ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
        },
        (error: ExecFileError | null, stdout: string, stderr: string) => {
          if (error === null) {
            // Terminación normal con exit 0.
            resolve({ exitCode: 0, stdout, stderr });
            return;
          }

          // Hay error: distinguir "salió ≠ 0 / murió por señal" (RESOLVER) de
          // "no se pudo lanzar" (RECHAZAR), según el TIPO de `error.code`.
          if (typeof error.code === "number") {
            // El proceso corrió y salió con este código ≠ 0. Lo transportamos
            // como CommandResult; VpkTool lo interpretará como fallo tipado.
            resolve({ exitCode: error.code, stdout, stderr });
            return;
          }

          if (error.signal != null) {
            // El proceso corrió pero fue terminado por una señal (sin exit
            // numérico). Se normaliza a un exit ≠ 0 convencional para que
            // VpkTool lo trate como fallo (y no como "no se pudo lanzar").
            resolve({ exitCode: SIGNAL_TERMINATION_EXIT_CODE, stdout, stderr });
            return;
          }

          // `error.code` es un string (p. ej. "ENOENT" ejecutable inexistente,
          // "EACCES"/"EPERM" sin permiso para lanzar) o ausente: el proceso NO
          // pudo lanzarse. Es un fallo de invocación, no un exit de `vpk`.
          // Se propaga tal cual (el llamador decide qué hacer con él).
          reject(error);
        },
      );
    });
  }
}
