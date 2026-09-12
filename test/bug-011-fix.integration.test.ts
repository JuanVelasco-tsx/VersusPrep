/**
 * BUG-011 — Test de INTEGRACIÓN del FIX contra `vpk.exe` REAL (tarea 6).
 *
 * Objetivo: verificar END-TO-END, contra el binario `vpk.exe` de verdad, que la
 * recalibración de `DEFAULT_MAX_COMMAND_LENGTH` (6000 → 1024) resuelve el crash
 * `0xC0000409` (`STATUS_STACK_BUFFER_OVERRUN`) por LONGITUD de la línea de
 * comando.
 *
 * A diferencia del test exploratorio (que DIAGNOSTICA y no aserta el crash),
 * este test AFIRMA el comportamiento CORREGIDO:
 *
 *   1. Se arma un fixture con paths internos LARGOS que, en UN SOLO lote, darían
 *      una línea de comando ~2021-2031 chars (por encima del último valor sano
 *      medido, 1719, y en el orden del primer crash observado, 2031). Con el
 *      techo viejo (6000) `batchInternalPaths` NO lo partía → crash. Con el
 *      techo nuevo (1024) DEBE partirlo en VARIOS lotes ≤ 1024.
 *   2. El VPK se ubica en un `vpkPath` de longitud REPRESENTATIVA DE PRODUCCIÓN
 *      (~85 chars) anidando subcarpetas bajo `tmpdir`, para que el overhead de
 *      la línea de comando refleje el de producción (con ruta corta se
 *      subestima y el test dejaría de ser representativo del crash real).
 *   3. Se extrae con `VpkTool.extract` (que aplica `batchInternalPaths` con el
 *      techo nuevo) usando un CommandRunner ESPÍA que envuelve al real, para
 *      inspeccionar cuántos lotes se generaron y el exit de cada invocación.
 *
 * VERIFICA:
 *   - Se particiona en MÁS DE UN lote (el fix efectivamente parte el conjunto).
 *   - Cada lote tiene `commandLengthForBatch ≤ 1024`.
 *   - NINGUNA invocación `vpk x` crashea: todos con `exit 0`.
 *   - La extracción escribe TODOS los archivos en disco (sin pérdida).
 *
 * NOTA sobre `vpk x` y creación de directorios (igual que en los otros tests de
 * integración): `vpk x` NO crea los subdirectorios de destino; el llamador
 * (aquí, imitando a MergeEngine) los CREA antes con `internalPathToDiskPath`.
 *
 * SKIPPEABLE: solo corre si existe `VPK_EXE_PATH`; en su ausencia se salta con
 * `describe.skip` en vez de fallar.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  DEFAULT_MAX_COMMAND_LENGTH,
  VpkTool,
  VpkToolError,
  commandLengthForBatch,
  internalPathToDiskPath,
  type CommandResult,
  type CommandRunner,
  type CommandRunOptions,
} from "../src/main/domain/index.js";
import { ChildProcessCommandRunner } from "../src/main/data/child-process-command-runner.js";
import { VPK_EXE_PATH } from "./helpers/vpk-fixtures.js";

const VPK_AVAILABLE = existsSync(VPK_EXE_PATH);
const suite = VPK_AVAILABLE ? describe : describe.skip;

const ADDON_ID = "627562239"; // mismo addonId reportado por QA en el bug.

/** Longitud objetivo (chars) del vpkPath, representativa de producción (~85). */
const TARGET_VPK_PATH_LEN = 85;

/** Registro de una invocación capturada por el runner espía. */
interface CapturedCall {
  executable: string;
  args: string[];
  cwd: string | undefined;
  result?: CommandResult;
  error?: unknown;
}

/**
 * CommandRunner ESPÍA: registra cada `run(exe, args, opts)` —guardando el argv
 * completo— y DELEGA en el runner real. Permite inspeccionar los lotes (cantidad
 * de invocaciones + tamaño de cada argv) y el exit de cada `vpk x`.
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

/** Crea, dentro de `destDir`, los subdirs necesarios para cada `internalPath`. */
function createDestDirsFor(destDir: string, internalPaths: readonly string[]): void {
  for (const internal of internalPaths) {
    const abs = join(destDir, internalPathToDiskPath(internal));
    mkdirSync(dirname(abs), { recursive: true });
  }
}

/**
 * Construye una carpeta bajo `tmpdir` cuyo `.vpk` empaquetado quede en un path
 * de longitud ~{@link TARGET_VPK_PATH_LEN} chars, anidando subcarpetas hasta
 * alcanzarla. Devuelve la ruta de la carpeta fuente (el `.vpk` será
 * `<sourceDir>.vpk`).
 */
function makeProductionLengthSourceDir(base: string): string {
  // Partimos de un mkdtemp (ruta base impredecible) y anidamos subcarpetas
  // hasta que `<dir>.vpk` alcance la longitud objetivo.
  let dir = base;
  let guard = 0;
  // El `.vpk` final añade 4 chars (".vpk") + 1 separador del último segmento.
  while (`${dir}.vpk`.length < TARGET_VPK_PATH_LEN && guard < 40) {
    dir = join(dir, "addoncontent");
    guard += 1;
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Genera `count` paths internos LARGOS de ~`pathLen` chars cada uno,
 * representando subcarpetas profundas de un addon (como el 627562239). Con 40
 * paths de 47 chars la línea de comando total (overhead de producción incluido)
 * queda ~2021 chars: por encima de 1719 (sano) y en el orden de 2031 (crash).
 */
function buildLongInternalPaths(count: number, pathLen: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const bref = `materials/models/props/addon627562239/subcarpeta_profunda_${i}/`;
    const remaining = pathLen - bref.length;
    const filler = remaining > 0 ? "t".repeat(remaining - 4) + ".vtf" : "";
    return (bref + filler).slice(0, pathLen);
  });
}

suite("BUG-011 fix integración con vpk.exe real: extracción por lotes ≤ 1024 sin crash", () => {
  const tempDirs: string[] = [];
  let realRunner: ChildProcessCommandRunner;
  let vpkPath: string;
  let internalPaths: string[];

  beforeAll(async () => {
    realRunner = new ChildProcessCommandRunner();
    const packTool = new VpkTool(realRunner, VPK_EXE_PATH);

    const base = mkdtempSync(join(tmpdir(), "l4d2-bug011-fix-"));
    tempDirs.push(base);

    // Carpeta fuente en un path de longitud representativa de producción (~85).
    const sourceDir = makeProductionLengthSourceDir(join(base, "root"));

    // 40 paths largos → ~2021 chars de línea de comando total en un solo lote.
    internalPaths = buildLongInternalPaths(40, 47);
    for (const internal of internalPaths) {
      const abs = join(sourceDir, ...internal.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, `dummy ${internal}\n`, "utf8");
    }

    // `vpk <carpeta>` → `<carpeta>.vpk`, en el path largo de producción.
    vpkPath = await packTool.pack(sourceDir, "fixture:bug011-fix");
    tempDirs.push(vpkPath);
  }, 180_000);

  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test(
    "el conjunto que crasheaba con el techo viejo ahora se parte en varios lotes ≤ 1024 y todos exit 0",
    async () => {
      // Sanidad del fixture: la ruta del VPK es representativa de producción y,
      // en un solo lote, superaría el umbral real de vpk.exe (1719).
      expect(vpkPath.length).toBeGreaterThanOrEqual(60);
      const totalSiUnSoloLote = commandLengthForBatch(internalPaths, vpkPath);
      expect(totalSiUnSoloLote).toBeGreaterThan(1719);

      const spy = new SpyCommandRunner(realRunner);
      const tool = new VpkTool(spy, VPK_EXE_PATH);
      const destDir = mkdtempSync(join(tmpdir(), "l4d2-bug011-fix-dest-"));
      tempDirs.push(destDir);
      createDestDirsFor(destDir, internalPaths);

      // El fix: extract aplica batchInternalPaths con el techo nuevo (1024).
      let thrown: unknown;
      try {
        await tool.extract(vpkPath, internalPaths, destDir, ADDON_ID);
      } catch (err) {
        thrown = err;
      }

      // Reporte de evidencia (útil al leer la salida del test).
      const loteSizes = spy.calls.map((c) => c.args.length - 2); // -2 por ["x", vpk]
      const loteCosts = spy.calls.map((c) => commandLengthForBatch(c.args.slice(2), vpkPath));
      const exits = spy.calls.map((c) => c.result?.exitCode ?? "REJECT");
      console.log("\n===== [BUG-011] FIX integración — extracción por lotes =====");
      console.log(`  vpkPath.length = ${vpkPath.length}`);
      console.log(`  costo si UN solo lote = ${totalSiUnSoloLote} (> 1719 umbral real)`);
      console.log(`  #invocaciones (lotes) = ${spy.calls.length}`);
      console.log(`  tamaños de lote (paths) = ${JSON.stringify(loteSizes)}`);
      console.log(`  costos de lote (chars)  = ${JSON.stringify(loteCosts)}`);
      console.log(`  exits = ${JSON.stringify(exits)}`);
      console.log(
        `  resultado global = ${
          thrown instanceof VpkToolError
            ? `VpkToolError exit=${thrown.exitCode}`
            : thrown
              ? String(thrown)
              : "OK sin error"
        }`,
      );

      // (1) La extracción completó SIN error.
      expect(thrown).toBeUndefined();

      // (2) Se partió en VARIOS lotes (más de uno): el fix efectivamente divide.
      expect(spy.calls.length).toBeGreaterThan(1);

      // (3) Cada lote respeta el techo nuevo y NINGUNO crashea (exit 0).
      for (const call of spy.calls) {
        const batch = call.args.slice(2); // quita ["x", vpkPath]
        expect(commandLengthForBatch(batch, vpkPath)).toBeLessThanOrEqual(DEFAULT_MAX_COMMAND_LENGTH);
        expect(call.result?.exitCode).toBe(0);
      }

      // (4) Sin pérdida: todos los archivos quedaron escritos en disco.
      for (const internal of internalPaths) {
        const abs = join(destDir, internalPathToDiskPath(internal));
        expect(existsSync(abs), `esperado en disco: ${abs}`).toBe(true);
        expect(statSync(abs).isFile()).toBe(true);
      }
    },
    180_000,
  );
});
