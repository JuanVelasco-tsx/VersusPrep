/**
 * ProcessListProvider real (Tarea 20.4, bloque 1): lista procesos en ejecución
 * invocando `tasklist` a través del CommandRunner ya existente.
 *
 * DECISIÓN (a propósito distinta de RegistryReader): acá NO se enmascara un
 * fallo detrás de un resultado vacío. Este proveedor alimenta a ProcessGuard,
 * que decide si el juego está corriendo (AC 4.1/4.2) ANTES de escribir sobre
 * el Game_Root. Si `tasklist` falla y devolviéramos [] en silencio,
 * ProcessGuard concluiría "el juego no está corriendo" cuando en realidad NO
 * SE SABE — un falso negativo de seguridad. Por eso acá se deja PROPAGAR el
 * error en vez de devolver una lista vacía.
 */
import type { CommandRunner, ProcessListProvider } from "../domain/index.js";

/** Extrae el "Image Name" de cada línea CSV de `tasklist /fo csv /nh`. Exportado para test aislado. */
export function parseTasklistCsv(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const match = /^"([^"]*)"/.exec(line);
    if (match !== null) names.push(match[1] ?? "");
  }
  return names;
}

export class RealProcessListProvider implements ProcessListProvider {
  readonly #runner: CommandRunner;

  constructor(runner: CommandRunner) {
    this.#runner = runner;
  }

  async listRunningProcessNames(): Promise<string[]> {
    const result = await this.#runner.run("tasklist", ["/fo", "csv", "/nh"]);
    if (result.exitCode !== 0) {
      throw new Error("tasklist terminó con código " + result.exitCode + ": " + result.stderr);
    }
    return parseTasklistCsv(result.stdout);
  }
}