/**
 * BUG-011 — Test EXPLORATORIO (diagnóstico, NO fix).
 *
 * Objetivo: reproducir y DIAGNOSTICAR por qué "aplicar un único mod" hace
 * crashear vpk.exe con exit 3221226505 (0xC0000409 = STATUS_STACK_BUFFER_OVERRUN),
 * mientras que con 2+ mods funciona.
 *
 * Hipótesis a comprobar (pista del usuario): la causa está en QUÉ argv/línea de
 * comando se construye distinto en el camino de "un solo elemento" vs "2+". Este
 * test COMPARA el argv efectivamente generado (vía un CommandRunner ESPÍA que
 * envuelve al real) entre un batch de 1 path y uno de N paths, y observa el exit
 * code real de vpk.exe en cada caso.
 *
 * NO toca código de producción. NO propone fix. Solo captura evidencia.
 *
 * SKIPPEABLE: la parte que ejecuta vpk.exe real solo corre si existe
 * VPK_EXE_PATH. La parte pura (batchInternalPaths + comparación de argv
 * generado) corre SIEMPRE, aunque vpk.exe no esté.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  VpkTool,
  VpkToolError,
  batchInternalPaths,
  internalPathToDiskPath,
  type CommandResult,
  type CommandRunner,
  type CommandRunOptions,
} from "../src/main/domain/index.js";
import { ChildProcessCommandRunner } from "../src/main/data/child-process-command-runner.js";
import { VPK_EXE_PATH } from "./helpers/vpk-fixtures.js";

const VPK_AVAILABLE = existsSync(VPK_EXE_PATH);
const ADDON_ID = "627562239"; // mismo addonId reportado por QA en el bug.

/** Registro de una invocación capturada por el runner espía. */
interface CapturedCall {
  executable: string;
  args: string[];
  cwd: string | undefined;
  result?: CommandResult;
  error?: unknown;
}

/**
 * CommandRunner ESPÍA: registra cada llamada run(exe, args, opts) —guardando el
 * argv COMPLETO— y DELEGA en el runner real. Así capturamos el argv EXACTO que
 * se pasa a vpk.exe, tanto para el batch de 1 como para el de N, y el resultado
 * (exit code o error) de cada invocación.
 */
class SpyCommandRunner implements CommandRunner {
  readonly calls: CapturedCall[] = [];
  readonly #delegate: CommandRunner;

  constructor(delegate: CommandRunner) {
    this.#delegate = delegate;
  }

  async run(
    executable: string,
    args: readonly string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult> {
    const record: CapturedCall = {
      executable,
      args: [...args],
      cwd: options?.cwd,
    };
    this.calls.push(record);
    try {
      const result = await this.#delegate.run(executable, args, options);
      record.result = result;
      return result;
    } catch (err) {
      record.error = err;
      throw err;
    }
  }
}

/** Crea, dentro de destDir, los subdirs necesarios para cada internalPath. */
function createDestDirsFor(destDir: string, internalPaths: readonly string[]): void {
  for (const internal of internalPaths) {
    const abs = join(destDir, internalPathToDiskPath(internal));
    mkdirSync(dirname(abs), { recursive: true });
  }
}

// ===========================================================================
// PARTE PURA (corre SIEMPRE): batchInternalPaths con 1 path vs N paths.
// ===========================================================================
describe("BUG-011 exploratorio — batchInternalPaths puro (1 vs N)", () => {
  const VPK = "workshop/627562239.vpk";

  test("compara la partición de 1 path vs 2 paths vs 3 paths", () => {
    const one = ["materials/single.vmt"];
    const two = ["materials/a.vmt", "materials/b.vmt"];
    const three = ["materials/a.vmt", "materials/b.vmt", "models/c.mdl"];

    const b1 = batchInternalPaths(one, VPK);
    const b2 = batchInternalPaths(two, VPK);
    const b3 = batchInternalPaths(three, VPK);

    console.log("[BUG-011] batchInternalPaths(1 path)  =", JSON.stringify(b1));
    console.log("[BUG-011] batchInternalPaths(2 paths) =", JSON.stringify(b2));
    console.log("[BUG-011] batchInternalPaths(3 paths) =", JSON.stringify(b3));

    // Documentar la forma: ¿el batch de 1 produce algo raro?
    expect(b1).toEqual([one]);
    expect(b2).toEqual([two]);
    expect(b3).toEqual([three]);
    // En los tres casos: exactamente UN lote, sin elementos vacíos, sin nada
    // espurio. La partición NO explica ninguna diferencia estructural.
    for (const [label, batches] of [["1", b1], ["2", b2], ["3", b3]] as const) {
      expect(batches.length, `lotes para ${label} path(s)`).toBe(1);
      expect(batches[0]!.some((p) => p === ""), `arg vacío en ${label}`).toBe(false);
    }
  });

  test("simula el argv que VpkTool.extract construiría: ['x', vpk, ...batch]", () => {
    const vpk = "C:\\fixtures\\627562239.vpk";
    const one = ["materials/single.vmt"];
    const three = ["materials/a.vmt", "materials/b.vmt", "models/c.mdl"];

    const argvOne = ["x", vpk, ...batchInternalPaths(one, vpk)[0]!];
    const argvN = ["x", vpk, ...batchInternalPaths(three, vpk)[0]!];

    console.log("[BUG-011] argv simulado (1 path) =", JSON.stringify(argvOne));
    console.log("[BUG-011] argv simulado (N paths)=", JSON.stringify(argvN));

    // Estructuralmente idénticos salvo por la cantidad de paths. Ningún arg
    // vacío ni malformado en el caso de 1.
    expect(argvOne).toEqual(["x", vpk, "materials/single.vmt"]);
    expect(argvOne.includes("")).toBe(false);
  });
});

// ===========================================================================
// PARTE CON vpk.exe REAL (skippeable): reproducción + captura de argv/exit.
// ===========================================================================
const suite = VPK_AVAILABLE ? describe : describe.skip;

suite("BUG-011 exploratorio — vpk.exe REAL: extract de 1 archivo vs N (captura argv+exit)", () => {
  const tempDirs: string[] = [];
  let realRunner: ChildProcessCommandRunner;

  // Fixtures locales de este test (no reusamos los generados para controlar
  // exactamente la cantidad de archivos: 1 y 2).
  let singleVpk: string;
  let singleInternal: string[];
  let pairVpk: string;
  let pairInternal: string[];

  beforeAll(async () => {
    realRunner = new ChildProcessCommandRunner();
    const packTool = new VpkTool(realRunner, VPK_EXE_PATH);

    const base = mkdtempSync(join(tmpdir(), "l4d2-bug011-fix-"));
    tempDirs.push(base);

    // Fixture de UN SOLO archivo interno.
    const singleSrc = join(base, "single");
    singleInternal = ["materials/single.vmt"];
    for (const internal of singleInternal) {
      const abs = join(singleSrc, ...internal.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, "dummy single content\n", "utf8");
    }
    singleVpk = await packTool.pack(singleSrc, "fixture:single");
    tempDirs.push(singleVpk);

    // Fixture de DOS archivos internos.
    const pairSrc = join(base, "pair");
    pairInternal = ["materials/a.vmt", "materials/b.vmt"];
    for (const internal of pairInternal) {
      const abs = join(pairSrc, ...internal.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, `dummy content ${internal}\n`, "utf8");
    }
    pairVpk = await packTool.pack(pairSrc, "fixture:pair");
    tempDirs.push(pairVpk);
  }, 120_000);

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeExtractDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), `l4d2-bug011-x-${prefix}-`));
    tempDirs.push(dir);
    return dir;
  }

  test(
    "extract de 1 archivo: captura argv + exit code (¿reproduce 3221226505?)",
    async () => {
      const spy = new SpyCommandRunner(realRunner);
      const tool = new VpkTool(spy, VPK_EXE_PATH);
      const destDir = makeExtractDir("single");
      createDestDirsFor(destDir, singleInternal);

      let thrown: unknown;
      try {
        await tool.extract(singleVpk, singleInternal, destDir, ADDON_ID);
      } catch (err) {
        thrown = err;
      }

      console.log("\n===== [BUG-011] CASO 1 ARCHIVO =====");
      for (const [i, call] of spy.calls.entries()) {
        console.log(`  invocación #${i}: exe=${call.executable}`);
        console.log(`    argv (len=${call.args.length}) = ${JSON.stringify(call.args)}`);
        console.log(`    cwd  = ${call.cwd}`);
        console.log(`    exit = ${call.result?.exitCode ?? "(rechazó)"}`);
        if (call.result?.stderr) console.log(`    stderr = ${call.result.stderr.slice(0, 400)}`);
      }
      if (thrown instanceof VpkToolError) {
        console.log(`  -> VpkToolError: exit=${thrown.exitCode} op=${thrown.operation}`);
      } else if (thrown) {
        console.log(`  -> Error inesperado:`, thrown);
      } else {
        console.log("  -> extract COMPLETÓ sin error");
      }

      // Guardamos la evidencia en variables del closure para el test de comparación.
      (globalThis as Record<string, unknown>).__bug011_single = {
        calls: spy.calls,
        thrown,
      };

      // No aseveramos el crash: queremos observar, no forzar. Solo dejamos
      // constancia del argv capturado.
      expect(spy.calls.length).toBeGreaterThan(0);
      expect(spy.calls[0]!.args[0]).toBe("x");
    },
    120_000,
  );

  test(
    "UMBRAL: extract directo con lotes de tamaño creciente (50/64/70/80/100) para ubicar el crash 0xC0000409",
    async () => {
      // Generamos un fixture con MUCHOS archivos internos (>100) para poder
      // pedirle a vpk.exe extraer distintas cantidades EN UNA SOLA invocación
      // (sin batching: llamamos al runner real directamente con N paths).
      const manySrc = mkdtempSync(join(tmpdir(), "l4d2-bug011-many-src-"));
      tempDirs.push(manySrc);
      const manyInternal: string[] = [];
      for (let i = 0; i < 120; i++) {
        const internal = `materials/file_${String(i).padStart(4, "0")}.vmt`;
        manyInternal.push(internal);
        const abs = join(manySrc, ...internal.split("/"));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, `dummy ${i}\n`, "utf8");
      }
      const packTool = new VpkTool(realRunner, VPK_EXE_PATH);
      const manyVpk = await packTool.pack(manySrc, "fixture:many");
      tempDirs.push(manyVpk);

      const sizes = [1, 40, 50, 64, 70, 80, 100, 120];
      console.log("\n===== [BUG-011] UMBRAL de argumentos de `vpk x` (una sola invocación) =====");
      const results: { n: number; exit: number | string; stderrHead: string }[] = [];
      for (const n of sizes) {
        const batch = manyInternal.slice(0, n);
        const destDir = makeExtractDir(`many-${n}`);
        createDestDirsFor(destDir, batch);
        const argv = ["x", manyVpk, ...batch];
        let exit: number | string;
        let stderrHead = "";
        try {
          const res = await realRunner.run(VPK_EXE_PATH, argv, { cwd: destDir });
          exit = res.exitCode;
          stderrHead = res.stderr.slice(0, 200);
        } catch (err) {
          exit = `REJECT:${(err as Error).message.slice(0, 120)}`;
        }
        const unsigned = typeof exit === "number" && exit < 0 ? exit >>> 0 : exit;
        console.log(
          `  N=${String(n).padStart(3)}  argv.length=${argv.length}  exit=${exit}` +
            (typeof exit === "number" && exit !== 0 ? ` (unsigned=${unsigned}, hex=0x${(exit >>> 0).toString(16).toUpperCase()})` : "") +
            (stderrHead ? `  stderr="${stderrHead.replace(/\n/g, " ")}"` : ""),
        );
        results.push({ n, exit, stderrHead });
      }

      // Reportamos el primer N que crashea (si alguno). No aseveramos un valor
      // fijo: el umbral es empírico y puede variar por entorno.
      const firstCrash = results.find(
        (r) => typeof r.exit === "number" && r.exit !== 0,
      );
      if (firstCrash) {
        console.log(
          `\n  -> PRIMER crash en N=${firstCrash.n} con exit=${firstCrash.exit} (unsigned=${(firstCrash.exit as number) >>> 0})`,
        );
      } else {
        console.log("\n  -> NINGÚN N crasheó en esta corrida (hasta 120 args OK)");
      }
      expect(results.length).toBe(sizes.length);
    },
    180_000,
  );

  test(
    "VpkTool.extract CON BATCHING de un VPK grande (120 y 260 archivos): ¿cada lote <=50 y exit 0?",
    async () => {
      // Un solo addon con MUCHOS archivos, extraído por VpkTool.extract (que
      // aplica batchInternalPaths internamente). Comprobamos que el batching
      // efectivamente parte en lotes <=50 y que NINGUNA invocación crashea.
      for (const count of [120, 260]) {
        const src = mkdtempSync(join(tmpdir(), `l4d2-bug011-batched-${count}-src-`));
        tempDirs.push(src);
        const internal: string[] = [];
        for (let i = 0; i < count; i++) {
          const p = `materials/tex_${String(i).padStart(4, "0")}.vtf`;
          internal.push(p);
          const abs = join(src, ...p.split("/"));
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, `d${i}\n`, "utf8");
        }
        const packTool = new VpkTool(realRunner, VPK_EXE_PATH);
        const vpk = await packTool.pack(src, `fixture:batched-${count}`);
        tempDirs.push(vpk);

        const spy = new SpyCommandRunner(realRunner);
        const tool = new VpkTool(spy, VPK_EXE_PATH);
        const destDir = makeExtractDir(`batched-${count}`);
        createDestDirsFor(destDir, internal);

        let thrown: unknown;
        try {
          await tool.extract(vpk, internal, destDir, ADDON_ID);
        } catch (err) {
          thrown = err;
        }

        console.log(`\n===== [BUG-011] BATCHED extract de ${count} archivos (default maxBatchSize=50) =====`);
        console.log(`  #invocaciones = ${spy.calls.length}`);
        const sizes = spy.calls.map((c) => c.args.length - 2); // -2 por ["x", vpk]
        console.log(`  tamaños de lote (paths) = ${JSON.stringify(sizes)}`);
        console.log(`  max lote = ${Math.max(...sizes)}`);
        const exits = spy.calls.map((c) => c.result?.exitCode ?? "REJECT");
        console.log(`  exits = ${JSON.stringify(exits)}`);
        console.log(`  resultado global = ${thrown instanceof VpkToolError ? `VpkToolError exit=${thrown.exitCode}` : thrown ? String(thrown) : "OK sin error"}`);

        // Todos los lotes deben ser <= 50 (default) y ninguno debe crashear.
        for (const s of sizes) expect(s).toBeLessThanOrEqual(50);
        for (const e of exits) expect(e).toBe(0);
        expect(thrown).toBeUndefined();
      }
    },
    180_000,
  );

  test(
    "UMBRAL POR LONGITUD: pocos paths pero MUY largos (¿crashea por longitud total y no por cantidad?)",
    async () => {
      // Objetivo: descartar/confirmar si el crash 0xC0000409 depende de la
      // LONGITUD total de la línea de comando (o de la longitud individual del
      // path) y no solo de la CANTIDAD de argumentos. Generamos paths con
      // subcarpetas profundas para que cada path sea largo (~150-250 chars),
      // y probamos invocaciones con POCOS args pero longitud total creciente.
      const deepSrc = mkdtempSync(join(tmpdir(), "l4d2-bug011-deep-src-"));
      tempDirs.push(deepSrc);
      const deepInternal: string[] = [];
      // Cada path: materials/<seg>/<seg>/.../file_i.vtf con segmentos largos.
      const longSeg = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // 30 chars
      for (let i = 0; i < 60; i++) {
        const p = `materials/${longSeg}/${longSeg}/${longSeg}/${longSeg}/deep_file_${String(i).padStart(4, "0")}.vtf`;
        deepInternal.push(p);
        const abs = join(deepSrc, ...p.split("/"));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, `d${i}\n`, "utf8");
      }
      const pathLen = deepInternal[0]!.length;
      const packTool = new VpkTool(realRunner, VPK_EXE_PATH);
      const deepVpk = await packTool.pack(deepSrc, "fixture:deep");
      tempDirs.push(deepVpk);

      console.log(`\n===== [BUG-011] UMBRAL POR LONGITUD (cada path ~${pathLen} chars) =====`);
      // Probamos cantidades por debajo del umbral de cantidad (70) pero con
      // longitud total creciente. Con paths de ~150 chars: 40 args ~= 6000+ chars.
      const results: { n: number; totalLen: number; exit: number | string }[] = [];
      for (const n of [10, 20, 30, 40, 50, 60]) {
        const batch = deepInternal.slice(0, n);
        const destDir = makeExtractDir(`deep-${n}`);
        createDestDirsFor(destDir, batch);
        const argv = ["x", deepVpk, ...batch];
        const totalLen = argv.join(" ").length;
        let exit: number | string;
        try {
          const res = await realRunner.run(VPK_EXE_PATH, argv, { cwd: destDir });
          exit = res.exitCode;
        } catch (err) {
          exit = `REJECT:${(err as Error).message.slice(0, 80)}`;
        }
        console.log(
          `  N=${String(n).padStart(3)}  longitud_total≈${totalLen}  exit=${exit}` +
            (typeof exit === "number" && exit !== 0 ? ` (hex=0x${(exit >>> 0).toString(16).toUpperCase()})` : ""),
        );
        results.push({ n, totalLen, exit });
      }
      const crashByLen = results.find((r) => typeof r.exit === "number" && r.exit !== 0);
      if (crashByLen) {
        console.log(
          `\n  -> crash en N=${crashByLen.n} (longitud≈${crashByLen.totalLen}, cantidad ${crashByLen.n} < umbral de cantidad ~70): sugiere componente por LONGITUD`,
        );
      } else {
        console.log(
          "\n  -> NINGÚN crash por debajo de 60 args aunque la longitud total supere 6000: el vector dominante es la CANTIDAD, no la longitud",
        );
      }
      expect(results.length).toBe(6);
    },
    180_000,
  );

  test(
    "extract de N (2) archivos: captura argv + exit code (¿funciona?)",
    async () => {
      const spy = new SpyCommandRunner(realRunner);
      const tool = new VpkTool(spy, VPK_EXE_PATH);
      const destDir = makeExtractDir("pair");
      createDestDirsFor(destDir, pairInternal);

      let thrown: unknown;
      try {
        await tool.extract(pairVpk, pairInternal, destDir, ADDON_ID);
      } catch (err) {
        thrown = err;
      }

      console.log("\n===== [BUG-011] CASO 2 ARCHIVOS =====");
      for (const [i, call] of spy.calls.entries()) {
        console.log(`  invocación #${i}: exe=${call.executable}`);
        console.log(`    argv (len=${call.args.length}) = ${JSON.stringify(call.args)}`);
        console.log(`    cwd  = ${call.cwd}`);
        console.log(`    exit = ${call.result?.exitCode ?? "(rechazó)"}`);
        if (call.result?.stderr) console.log(`    stderr = ${call.result.stderr.slice(0, 400)}`);
      }
      if (thrown instanceof VpkToolError) {
        console.log(`  -> VpkToolError: exit=${thrown.exitCode} op=${thrown.operation}`);
      } else if (thrown) {
        console.log(`  -> Error inesperado:`, thrown);
      } else {
        console.log("  -> extract COMPLETÓ sin error");
      }

      const single = (globalThis as Record<string, unknown>).__bug011_single as
        | { calls: CapturedCall[]; thrown: unknown }
        | undefined;

      // DIFF ESTRUCTURAL entre argv de 1 y de N.
      if (single) {
        const argv1 = single.calls[0]?.args ?? [];
        const argvN = spy.calls[0]?.args ?? [];
        console.log("\n===== [BUG-011] DIFF ARGV (1 vs N) =====");
        console.log(`  len(1)=${argv1.length}  len(N)=${argvN.length}`);
        console.log(`  argv(1) = ${JSON.stringify(argv1)}`);
        console.log(`  argv(N) = ${JSON.stringify(argvN)}`);
        console.log(`  exit(1) = ${single.calls[0]?.result?.exitCode ?? "?"}  exit(N) = ${spy.calls[0]?.result?.exitCode ?? "?"}`);
        const prefix1 = argv1.slice(0, 2);
        const prefixN = argvN.slice(0, 2);
        console.log(`  prefijo(1)=${JSON.stringify(prefix1)} prefijo(N)=${JSON.stringify(prefixN)}`);
      }

      expect(spy.calls.length).toBeGreaterThan(0);
    },
    120_000,
  );
});
