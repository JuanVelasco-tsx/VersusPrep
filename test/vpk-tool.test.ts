import { describe, expect, test } from "vitest";

import {
  VpkTool,
  VpkToolError,
  batchInternalPaths,
  filterVpkNoise,
} from "../src/main/domain/index.js";
import type { CommandResult, CommandRunner } from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 2.8: wiring de `VpkTool` (AC 6.1, 6.3, 6.12).
 *
 * Estos tests ejercitan la lógica de orquestación de `VpkTool` (construcción de
 * argumentos, filtrado de ruido, batching de la extracción y propagación de
 * exit codes como error tipado) SIN tocar `vpk.exe` real (eso es la tarea 3).
 * Para lograrlo se inyecta un `CommandRunner` MOCKEADO en memoria.
 *
 * NOTA: esto NO es un property test. Es un conjunto de ejemplos que fija el
 * contrato de `VpkTool` documentado en `vpk-tool.ts`.
 */

// ---------------------------------------------------------------------------
// Mock de CommandRunner
// ---------------------------------------------------------------------------

/** Registro de una invocación recibida por el mock, para poder aserar sobre ella. */
interface RecordedCall {
  executable: string;
  /** Copia inmutable de los args recibidos (el llamador construye un array nuevo por invocación). */
  args: readonly string[];
  /** cwd recibido en options, o `undefined` si no se pasó options/cwd. */
  cwd: string | undefined;
}

/**
 * `CommandRunner` mockeado en memoria.
 *
 * - Registra TODAS las invocaciones (`calls`) con executable, args y cwd, para
 *   poder aserar sobre la forma exacta de cada llamada.
 * - Devuelve respuestas (`CommandResult`) configurables por invocación mediante
 *   una COLA de resultados (`enqueue`): la i-ésima llamada consume el i-ésimo
 *   resultado encolado. Esto permite secuencias como "primer lote OK, segundo
 *   lote falla" para el test de aborto de `extract`.
 * - Si la cola se agota, cae a un resultado por defecto (`defaultResult`), lo
 *   que evita que una llamada inesperada rompa con undefined bajo tsconfig
 *   estricto (`noUncheckedIndexedAccess`).
 */
class MockCommandRunner implements CommandRunner {
  readonly calls: RecordedCall[] = [];
  readonly #queue: CommandResult[] = [];
  #defaultResult: CommandResult = { exitCode: 0, stdout: "", stderr: "" };

  /** Encola uno o más resultados que se devolverán en orden en las próximas llamadas. */
  enqueue(...results: CommandResult[]): this {
    this.#queue.push(...results);
    return this;
  }

  /** Fija el resultado que se usa cuando la cola está agotada. */
  setDefault(result: CommandResult): this {
    this.#defaultResult = result;
    return this;
  }

  run(
    executable: string,
    args: readonly string[],
    options?: { cwd?: string },
  ): Promise<CommandResult> {
    this.calls.push({
      executable,
      args: [...args],
      cwd: options?.cwd,
    });
    const next = this.#queue.shift();
    return Promise.resolve(next ?? this.#defaultResult);
  }
}

const ok = (stdout = "", stderr = ""): CommandResult => ({ exitCode: 0, stdout, stderr });
const fail = (exitCode: number, stderr = ""): CommandResult => ({ exitCode, stdout: "", stderr });

const VPK_EXE = "C:\\game\\bin\\vpk.exe";
const ADDON_ID = "123456";

// ---------------------------------------------------------------------------
// Caso 1: invocación correcta de argumentos para los tres métodos.
// ---------------------------------------------------------------------------

describe("VpkTool: construcción de argumentos (AC 6.1, 6.3)", () => {
  test("list(vpkPath, addonId) invoca `vpk l <vpk>` sin cwd", async () => {
    const runner = new MockCommandRunner().enqueue(ok("materials/a.vmt"));
    const tool = new VpkTool(runner, VPK_EXE);

    await tool.list("workshop/1.vpk", ADDON_ID);

    expect(runner.calls).toHaveLength(1);
    const call = runner.calls[0];
    expect(call?.executable).toBe(VPK_EXE);
    expect(call?.args).toEqual(["l", "workshop/1.vpk"]);
    expect(call?.cwd).toBeUndefined();
  });

  test("extract(...) invoca `vpk x <vpk> <paths...>` con cwd === destDir en cada llamada", async () => {
    const vpk = "workshop/2.vpk";
    const paths = ["materials/a.vmt", "models/b.mdl"];
    const destDir = "C:\\dest\\extract";
    // Con el límite por defecto estos pocos paths caben en un único lote.
    const runner = new MockCommandRunner().enqueue(ok());
    const tool = new VpkTool(runner, VPK_EXE);

    await tool.extract(vpk, paths, destDir, ADDON_ID);

    expect(runner.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of runner.calls) {
      expect(call.executable).toBe(VPK_EXE);
      // Cada llamada empieza en ["x", vpk, ...paths del lote].
      expect(call.args[0]).toBe("x");
      expect(call.args[1]).toBe(vpk);
      expect(call.cwd).toBe(destDir);
    }
    // En un único lote, los args de paths reconstruyen exactamente la entrada.
    const firstCall = runner.calls[0];
    expect(firstCall?.args.slice(2)).toEqual(paths);
  });

  test("pack(sourceDir, addonId) invoca `vpk <sourceDir>` sin cwd", async () => {
    const runner = new MockCommandRunner().enqueue(ok());
    const tool = new VpkTool(runner, VPK_EXE);

    const out = await tool.pack("C:\\dest\\merged", ADDON_ID);

    expect(runner.calls).toHaveLength(1);
    const call = runner.calls[0];
    expect(call?.executable).toBe(VPK_EXE);
    expect(call?.args).toEqual(["C:\\dest\\merged"]);
    expect(call?.cwd).toBeUndefined();
    expect(out).toBe("C:\\dest\\merged.vpk");
  });
});

// ---------------------------------------------------------------------------
// Caso 2: extract() invoca `vpk x` una vez por cada lote de batchInternalPaths.
// ---------------------------------------------------------------------------

describe("VpkTool.extract: un `vpk x` por lote, sin pérdida de paths (AC 6.4, 6.5)", () => {
  test("cantidad de invocaciones === cantidad de lotes y los paths se reconstruyen en orden", async () => {
    const vpk = "workshop/multi.vpk";
    const destDir = "C:\\dest\\multi";
    // Muchos paths largos para forzar múltiples lotes con el límite por defecto.
    const paths = Array.from({ length: 400 }, (_, i) => `materials/models/really_long_${i}/texture_variant_${i}.vtf`);

    // batchInternalPaths es la MISMA fuente de verdad que usa VpkTool internamente.
    const expectedBatches = batchInternalPaths(paths, vpk);
    expect(expectedBatches.length).toBeGreaterThan(1); // aseguramos que hay múltiples lotes

    const runner = new MockCommandRunner().setDefault(ok());
    const tool = new VpkTool(runner, VPK_EXE);

    await tool.extract(vpk, paths, destDir, ADDON_ID);

    // Una invocación por lote.
    expect(runner.calls).toHaveLength(expectedBatches.length);

    // Cada llamada arranca en ["x", vpk, ...] con cwd === destDir, y sus paths
    // (quitando "x" y vpk) coinciden con el lote correspondiente.
    runner.calls.forEach((call, i) => {
      expect(call.args[0]).toBe("x");
      expect(call.args[1]).toBe(vpk);
      expect(call.cwd).toBe(destDir);
      expect(call.args.slice(2)).toEqual(expectedBatches[i]);
    });

    // La concatenación de los paths de todas las llamadas reconstruye la entrada.
    const reconstructed = runner.calls.flatMap((c) => c.args.slice(2));
    expect(reconstructed).toEqual(paths);
  });
});

// ---------------------------------------------------------------------------
// Caso 3: propagación de exit ≠ 0 como VpkToolError para los tres métodos.
// ---------------------------------------------------------------------------

describe("VpkTool: propaga exit ≠ 0 como VpkToolError (AC 6.12)", () => {
  test("list: lanza VpkToolError con operation 'list', addonId y exitCode", async () => {
    const runner = new MockCommandRunner().enqueue(fail(-1, "no such vpk"));
    const tool = new VpkTool(runner, VPK_EXE);

    await expect(tool.list("workshop/x.vpk", ADDON_ID)).rejects.toBeInstanceOf(VpkToolError);

    // Segundo intento para inspeccionar las props del error.
    const runner2 = new MockCommandRunner().enqueue(fail(-1, "no such vpk"));
    const tool2 = new VpkTool(runner2, VPK_EXE);
    try {
      await tool2.list("workshop/x.vpk", ADDON_ID);
      expect.unreachable("list debería haber lanzado VpkToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(VpkToolError);
      const e = err as VpkToolError;
      expect(e.operation).toBe("list");
      expect(e.addonId).toBe(ADDON_ID);
      expect(e.exitCode).toBe(-1);
    }
  });

  test("extract: lanza VpkToolError con operation 'extract', addonId y exitCode", async () => {
    const runner = new MockCommandRunner().enqueue(fail(3, "extract boom"));
    const tool = new VpkTool(runner, VPK_EXE);

    try {
      await tool.extract("workshop/x.vpk", ["materials/a.vmt"], "C:\\dest", ADDON_ID);
      expect.unreachable("extract debería haber lanzado VpkToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(VpkToolError);
      const e = err as VpkToolError;
      expect(e.operation).toBe("extract");
      expect(e.addonId).toBe(ADDON_ID);
      expect(e.exitCode).toBe(3);
    }
  });

  test("pack: lanza VpkToolError con operation 'pack', addonId y exitCode", async () => {
    const runner = new MockCommandRunner().enqueue(fail(7, "pack boom"));
    const tool = new VpkTool(runner, VPK_EXE);

    try {
      await tool.pack("C:\\dest\\merged", ADDON_ID);
      expect.unreachable("pack debería haber lanzado VpkToolError");
    } catch (err) {
      expect(err).toBeInstanceOf(VpkToolError);
      const e = err as VpkToolError;
      expect(e.operation).toBe("pack");
      expect(e.addonId).toBe(ADDON_ID);
      expect(e.exitCode).toBe(7);
    }
  });
});

// ---------------------------------------------------------------------------
// Caso 4: wiring de list() → aplica filterVpkNoise al stdout crudo.
// ---------------------------------------------------------------------------

describe("VpkTool.list: aplica filterVpkNoise al stdout crudo (AC 6.2)", () => {
  test("devuelve exactamente filterVpkNoise(stdout), descartando líneas de ruido", async () => {
    const rawStdout = [
      "CDynamicFunction: cargando",
      "materials/foo.vmt",
      "FS: montando",
      "scripts/vscripts/x.nut",
      "Using algo",
      "sound/baz.wav",
    ].join("\n");

    const runner = new MockCommandRunner().enqueue(ok(rawStdout));
    const tool = new VpkTool(runner, VPK_EXE);

    const result = await tool.list("workshop/n.vpk", ADDON_ID);

    // Contra la misma fuente de verdad: el resultado es el filtrado del stdout crudo.
    expect(result).toEqual(filterVpkNoise(rawStdout));
    // Y explícitamente: solo quedan los paths de contenido.
    expect(result).toEqual(["materials/foo.vmt", "scripts/vscripts/x.nut", "sound/baz.wav"]);
  });
});

// ---------------------------------------------------------------------------
// Caso 5: extract() aborta en el primer lote que falla.
// ---------------------------------------------------------------------------

describe("VpkTool.extract: aborta en el primer lote fallido (AC 6.12)", () => {
  test("con el segundo de >2 lotes fallando: lanza y NO ejecuta los lotes restantes", async () => {
    const vpk = "workshop/abort.vpk";
    const destDir = "C:\\dest\\abort";
    // Suficientes paths largos para producir MÁS de 2 lotes (así comprobamos que
    // el aborto en el 2.º lote deja lotes sin ejecutar).
    const paths = Array.from({ length: 600 }, (_, i) => `materials/very/deep/path_number_${i}/texture_${i}.vtf`);

    const expectedBatches = batchInternalPaths(paths, vpk);
    expect(expectedBatches.length).toBeGreaterThan(2); // debe haber al menos 3 lotes

    // Primer lote OK, segundo lote falla; el resto (default OK) NO debería ejecutarse.
    const runner = new MockCommandRunner().enqueue(ok(), fail(-1, "batch 2 boom")).setDefault(ok());
    const tool = new VpkTool(runner, VPK_EXE);

    let thrown: unknown;
    try {
      await tool.extract(vpk, paths, destDir, ADDON_ID);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(VpkToolError);
    const e = thrown as VpkToolError;
    expect(e.operation).toBe("extract");
    expect(e.addonId).toBe(ADDON_ID);
    expect(e.exitCode).toBe(-1);

    // Exactamente 2 invocaciones: índice del lote fallido (1) + 1. Los lotes
    // restantes (>= 3.º) NO se ejecutaron.
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls.length).toBeLessThan(expectedBatches.length);
  });
});
