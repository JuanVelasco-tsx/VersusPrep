import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SpawnSyncReturns } from "node:child_process";

import {
  RealElevationOsProvider,
  buildRelaunchArgs,
  buildRelaunchScript,
  checkIsElevatedSync,
  isPermissionDeniedError,
  toPowerShellSingleQuoted,
} from "../src/main/data/elevation-os-provider.js";
import type {
  CommandResult,
  CommandRunner,
  CommandRunOptions,
  PendingOperation,
} from "../src/main/domain/index.js";

/**
 * Tests del bloque 4 de la Tarea 20.4 (ElevationOsProvider). Cubren las cuatro
 * funciones puras/aisladas (checkIsElevatedSync, isPermissionDeniedError,
 * buildRelaunchArgs, toPowerShellSingleQuoted, buildRelaunchScript) y la clase
 * RealElevationOsProvider con dobles manuales (sin vi.fn()): un spawnSync falso,
 * un CommandRunner falso y probeWrite contra un tmpdir real.
 */

// ---------------------------------------------------------------------------
// Dobles manuales.
// ---------------------------------------------------------------------------

type SpawnSyncPick = Pick<typeof import("node:child_process"), "spawnSync">;

/** spawnSync falso: status fijo y contador de invocaciones. */
function fakeSpawnSync(status: number | null): { fn: SpawnSyncPick; calls: () => number } {
  let calls = 0;
  const fn: SpawnSyncPick = {
    spawnSync: (() => {
      calls += 1;
      return { status } as SpawnSyncReturns<string>;
    }) as unknown as typeof import("node:child_process").spawnSync,
  };
  return { fn, calls: () => calls };
}

/** spawnSync falso que lanza (simula comando ausente o fallo del propio chequeo). */
const throwingSpawnSync: SpawnSyncPick = {
  spawnSync: (() => {
    throw new Error("spawnSync exploto");
  }) as unknown as typeof import("node:child_process").spawnSync,
};

/** CommandRunner falso: registra la ultima llamada y devuelve un resultado fijo. */
function fakeRunner(result: CommandResult): {
  runner: CommandRunner;
  calls: Array<{ executable: string; args: readonly string[]; options?: CommandRunOptions }>;
} {
  const calls: Array<{ executable: string; args: readonly string[]; options?: CommandRunOptions }> = [];
  const runner: CommandRunner = {
    run: (executable, args, options) => {
      calls.push({ executable, args, ...(options !== undefined ? { options } : {}) });
      return Promise.resolve(result);
    },
  };
  return { runner, calls };
}

const PENDING: PendingOperation = { type: "applyActiveSet", resumeHandle: "pending-session" };

// ---------------------------------------------------------------------------
// checkIsElevatedSync
// ---------------------------------------------------------------------------

describe("checkIsElevatedSync", () => {
  test("status 0 -> true (elevado)", () => {
    expect(checkIsElevatedSync(fakeSpawnSync(0).fn)).toBe(true);
  });

  test("status 1 -> false (no elevado)", () => {
    expect(checkIsElevatedSync(fakeSpawnSync(1).fn)).toBe(false);
  });

  test("spawnSync que lanza -> false (fallo seguro)", () => {
    expect(checkIsElevatedSync(throwingSpawnSync)).toBe(false);
  });

  test("status null (senal) -> false", () => {
    expect(checkIsElevatedSync(fakeSpawnSync(null).fn)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPermissionDeniedError
// ---------------------------------------------------------------------------

describe("isPermissionDeniedError", () => {
  test("code EACCES -> true", () => {
    expect(isPermissionDeniedError({ code: "EACCES" })).toBe(true);
  });

  test("code EPERM -> true", () => {
    expect(isPermissionDeniedError({ code: "EPERM" })).toBe(true);
  });

  test("code ENOENT -> false", () => {
    expect(isPermissionDeniedError({ code: "ENOENT" })).toBe(false);
  });

  test("no-objeto -> false; null -> false", () => {
    expect(isPermissionDeniedError("EACCES")).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRelaunchArgs
// ---------------------------------------------------------------------------

describe("buildRelaunchArgs", () => {
  test("preserva el argv existente y agrega los cuatro elementos de resume en orden", () => {
    const current = ["main.js", "--foo"];
    expect(buildRelaunchArgs(current, PENDING)).toEqual([
      "main.js",
      "--foo",
      "--l4d2-resume-type",
      "applyActiveSet",
      "--l4d2-resume-handle",
      "pending-session",
    ]);
  });
});

// ---------------------------------------------------------------------------
// toPowerShellSingleQuoted
// ---------------------------------------------------------------------------

describe("toPowerShellSingleQuoted", () => {
  test("string simple queda entre comillas simples", () => {
    expect(toPowerShellSingleQuoted("C:\\App\\main.exe")).toBe("'C:\\App\\main.exe'");
  });

  test("comilla simple embebida se duplica", () => {
    expect(toPowerShellSingleQuoted("it's")).toBe("'it''s'");
  });
});

// ---------------------------------------------------------------------------
// buildRelaunchScript
// ---------------------------------------------------------------------------

describe("buildRelaunchScript", () => {
  const script = buildRelaunchScript("C:\\App\\l4d2.exe", ["main.js", "--l4d2-resume-type", "addAddon"]);

  test("incluye el execPath entrecomillado como -FilePath", () => {
    expect(script).toContain("-FilePath 'C:\\App\\l4d2.exe'");
  });

  test("incluye cada arg entrecomillado en el -ArgumentList", () => {
    expect(script).toContain("@('main.js','--l4d2-resume-type','addAddon')");
  });

  test("exit 0 en el camino de exito y -Verb RunAs", () => {
    expect(script).toContain("-Verb RunAs; exit 0");
  });

  test("exit 1223 ligado al HResult de ERROR_CANCELLED", () => {
    expect(script).toContain("$_.Exception.HResult -eq -2147023673");
    expect(script).toContain("exit 1223");
  });

  test("catch generico escribe a stderr y exit 1", () => {
    expect(script).toContain("[Console]::Error.WriteLine($_.Exception.Message); exit 1");
  });
});

// ---------------------------------------------------------------------------
// RealElevationOsProvider
// ---------------------------------------------------------------------------

describe("RealElevationOsProvider.isElevated (cacheado)", () => {
  test("computa una sola vez en el constructor; 3 llamadas -> 1 sola invocacion de spawnSync", () => {
    const spawn = fakeSpawnSync(0);
    const { runner } = fakeRunner({ exitCode: 0, stdout: "", stderr: "" });
    const provider = new RealElevationOsProvider(runner, spawn.fn);

    expect(provider.isElevated()).toBe(true);
    expect(provider.isElevated()).toBe(true);
    expect(provider.isElevated()).toBe(true);
    expect(spawn.calls()).toBe(1);
  });
});

describe("RealElevationOsProvider.probeWrite (tmpdir real)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "l4d2-elev-probe-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  test("directorio escribible -> true (escribe y borra el probe)", async () => {
    const spawn = fakeSpawnSync(1); // no elevado, irrelevante para probeWrite
    const { runner } = fakeRunner({ exitCode: 0, stdout: "", stderr: "" });
    const provider = new RealElevationOsProvider(runner, spawn.fn);

    expect(await provider.probeWrite(tmp)).toBe(true);
    // El probe efimero no debe quedar en el directorio.
    const rest = await fs.readdir(tmp);
    expect(rest).toEqual([]);
  });
});

describe("RealElevationOsProvider.relaunchAsAdmin", () => {
  test("exitCode 0 -> 'launched'; run() llamado con powershell.exe y -Command", async () => {
    const spawn = fakeSpawnSync(1);
    const { runner, calls } = fakeRunner({ exitCode: 0, stdout: "", stderr: "" });
    const provider = new RealElevationOsProvider(runner, spawn.fn);

    const outcome = await provider.relaunchAsAdmin(PENDING);

    expect(outcome).toBe("launched");
    expect(calls.length).toBe(1);
    expect(calls[0]?.executable).toBe("powershell.exe");
    expect(calls[0]?.args).toContain("-Command");
  });

  test("exitCode 1223 -> 'cancelled'", async () => {
    const spawn = fakeSpawnSync(1);
    const { runner } = fakeRunner({ exitCode: 1223, stdout: "", stderr: "" });
    const provider = new RealElevationOsProvider(runner, spawn.fn);

    expect(await provider.relaunchAsAdmin(PENDING)).toBe("cancelled");
  });

  test("exitCode 1 -> RECHAZA con un error que incluye el stderr", async () => {
    const spawn = fakeSpawnSync(1);
    const { runner } = fakeRunner({ exitCode: 1, stdout: "", stderr: "algo exploto en PS" });
    const provider = new RealElevationOsProvider(runner, spawn.fn);

    await expect(provider.relaunchAsAdmin(PENDING)).rejects.toThrow(/algo exploto en PS/);
  });
});
