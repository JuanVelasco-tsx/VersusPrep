/**
 * ElevationOsProvider real (Tarea 20.4, bloque 4): el adaptador mas delicado de
 * la 20.4 porque combina TRES mecanismos de SO distintos, cada uno con su propia
 * forma de inyeccion para mantener testabilidad sin mockear globals:
 *
 * DECISION H: isElevated() es SINCRONO por contrato de dominio (ElevationService
 * lo consume asi). La elevacion de un proceso NO cambia en su tiempo de vida en
 * Windows, asi que se computa UNA SOLA VEZ en el constructor (via `net session`,
 * exit code 0 = elevado) y se cachea; llamadas posteriores devuelven el valor
 * cacheado sin volver a tocar el SO. Se inyecta
 * Pick<typeof import("node:child_process"), "spawnSync"> (NO el CommandRunner
 * inyectado abajo, que es async) para poder testear sin un spawnSync real. Si
 * el propio chequeo falla (excepcion, comando ausente, senal), se asume `false`
 * (no elevado) - fallo seguro, mismo criterio que RegistryReader en el bloque 1:
 * el dominio ya sabe pedir elevacion si hace falta, asumir "no elevado" de mas
 * nunca esconde una escritura insegura.
 *
 * DECISION I: probeWrite(dir) solo mapea EACCES/EPERM a `false` (contrato
 * textual de la interfaz de dominio). Cualquier otro error (ENOENT si el
 * directorio no existe, etc.) SE PROPAGA como excepcion - no se enmascara.
 *
 * DECISION J: relaunchAsAdmin SI reusa el CommandRunner ya existente (patron
 * VpkTool/RegistryReader/ProcessListProvider). Lo que hay que esperar a que
 * termine es el proceso WRAPPER (powershell.exe -Command "Start-Process ...
 * -Verb RunAs"), no la instancia elevada en si: Start-Process -Verb RunAs sin
 * -Wait bloquea al wrapper solo hasta que el usuario responde al prompt UAC, y
 * termina apenas se lanza (o se cancela) la instancia elevada, que queda
 * corriendo SOLA y desatada del wrapper. Eso encaja exacto con el contrato de
 * CommandRunner.run() (comando que termina, da exitCode).
 *
 * DECISION K: el script de PowerShell distingue cancelacion de UAC por HResult
 * (-2147023673, equivalente decimal de 0x800704C7 / ERROR_CANCELLED), NO por
 * texto del mensaje de excepcion (que varia segun el idioma de Windows):
 * exit 0 = lanzado; exit 1223 = cancelado por el usuario; cualquier otra
 * excepcion = mensaje a stderr + exit 1, que RealElevationOsProvider traduce
 * en una excepcion real propagada (nunca "cancelled").
 *
 * DECISION L: el payload de PendingOperation viaja como flags simples en argv
 * (--l4d2-resume-type / --l4d2-resume-handle), agregados a process.argv.slice(1)
 * existente, con process.execPath como -FilePath. LIMITE CONOCIDO: el parseo del
 * lado receptor no existe todavia (main.ts no toca process.argv hoy) - es
 * terreno del bloque 5; la distincion dev vs empaquetado en como se relanza
 * execPath recien se valida ahi.
 */
import type {
  CommandRunner,
  ElevationOsProvider,
  PendingOperation,
  RelaunchOutcome,
} from "../domain/index.js";

const ERROR_CANCELLED_HRESULT = -2147023673;

/**
 * Chequeo sincrono de elevacion via `net session` (exit code 0 = elevado, sin
 * necesidad de parsear stdout). Exportada para test aislado con un spawnSync
 * falso. Cualquier fallo del propio chequeo (excepcion, comando ausente,
 * status null por senal) se interpreta como `false` (fallo seguro, ver
 * DECISION H).
 */
export function checkIsElevatedSync(
  spawnSyncFn: Pick<typeof import("node:child_process"), "spawnSync">,
): boolean {
  try {
    const result = spawnSyncFn.spawnSync("net", ["session"], { windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Predicado puro: es este error de fs un fallo de permisos (EACCES/EPERM)?
 * Exportada para test aislado con errores sinteticos, sin tocar el filesystem
 * real (ver DECISION I).
 */
export function isPermissionDeniedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM")
  );
}

/**
 * Deriva los argv completos para el relanzo elevado: preserva
 * process.argv.slice(1) y agrega los dos flags de resume (ver DECISION L).
 * Exportada para test aislado, sin depender de process.argv real.
 */
export function buildRelaunchArgs(
  currentArgv: readonly string[],
  pending: PendingOperation,
): string[] {
  return [
    ...currentArgv,
    "--l4d2-resume-type",
    pending.type,
    "--l4d2-resume-handle",
    pending.resumeHandle,
  ];
}

/** Escapa un string para uso como literal de comillas simples en PowerShell. */
export function toPowerShellSingleQuoted(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/**
 * Arma el script inline de PowerShell que lanza el relanzo elevado y traduce
 * cancelacion/exito/error a exit codes (ver DECISION K). Exportada para test
 * aislado del texto generado.
 */
export function buildRelaunchScript(execPath: string, args: readonly string[]): string {
  const argList = args.map(toPowerShellSingleQuoted).join(",");
  const filePath = toPowerShellSingleQuoted(execPath);
  return (
    "try { Start-Process -FilePath " +
    filePath +
    " -ArgumentList @(" +
    argList +
    ") -Verb RunAs; exit 0 } " +
    "catch { if ($_.Exception.HResult -eq " +
    String(ERROR_CANCELLED_HRESULT) +
    ") { exit 1223 } [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"
  );
}

export class RealElevationOsProvider implements ElevationOsProvider {
  readonly #elevated: boolean;
  readonly #runner: CommandRunner;

  constructor(
    runner: CommandRunner,
    spawnSyncFn: Pick<typeof import("node:child_process"), "spawnSync">,
  ) {
    this.#runner = runner;
    this.#elevated = checkIsElevatedSync(spawnSyncFn);
  }

  isElevated(): boolean {
    return this.#elevated;
  }

  async probeWrite(dir: string): Promise<boolean> {
    const probePath = dir + "\\.l4d2-write-probe-" + Date.now().toString();
    const fs = await import("node:fs/promises");
    try {
      await fs.writeFile(probePath, "");
      await fs.unlink(probePath);
      return true;
    } catch (error) {
      if (isPermissionDeniedError(error)) return false;
      throw error;
    }
  }

  async relaunchAsAdmin(pending: PendingOperation): Promise<RelaunchOutcome> {
    const args = buildRelaunchArgs(process.argv.slice(1), pending);
    const script = buildRelaunchScript(process.execPath, args);
    const result = await this.#runner.run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ]);
    if (result.exitCode === 0) return "launched";
    if (result.exitCode === 1223) return "cancelled";
    throw new Error(
      "Fallo al relanzar elevado (exit " + String(result.exitCode) + "): " + result.stderr,
    );
  }
}
