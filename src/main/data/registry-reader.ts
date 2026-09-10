/**
 * RegistryReader real (Tarea 20.4, bloque 1): lee valores del registro de
 * Windows invocando `reg query` a través del CommandRunner ya existente
 * (mismo patrón que VpkTool sobre vpk.exe: un único punto de shell-out,
 * testeable con un CommandRunner falso sin tocar el registro real).
 *
 * DECISIÓN: si `run()` rechaza (reg.exe no pudo lanzarse) o el exit code es
 * distinto de 0 (clave/valor ausente, o cualquier otro fallo), `readValue`
 * resuelve `null`. Es seguro: PathDetector ya trata `null` como "recurrir a
 * selección manual" (AC 1.2), así que enmascarar un fallo de spawn detrás de
 * `null` no oculta ningún chequeo de seguridad — a diferencia de
 * ProcessListProvider (ver process-list-provider.ts, decisión opuesta a propósito).
 */
import type { CommandRunner, RegistryReader } from "../domain/index.js";

/** Extrae el dato de una línea de salida de `reg query /v <value>`. Exportado para test aislado. */
export function parseRegQueryOutput(stdout: string, valueName: string): string | null {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(valueName)) continue;
    // Formato: "<valueName>    REG_SZ    <data...>" (separado por espacios múltiples).
    const match = /^\S+\s+REG_\w+\s+(.*)$/.exec(trimmed);
    if (match !== null) {
      return match[1] ?? null;
    }
  }
  return null;
}

export class RealRegistryReader implements RegistryReader {
  readonly #runner: CommandRunner;

  constructor(runner: CommandRunner) {
    this.#runner = runner;
  }

  async readValue(hive: string, key: string, value: string): Promise<string | null> {
    try {
      const result = await this.#runner.run("reg", ["query", hive + "\\" + key, "/v", value]);
      if (result.exitCode !== 0) return null;
      return parseRegQueryOutput(result.stdout, value);
    } catch {
      return null;
    }
  }
}