/**
 * Test de INTEGRACIÓN de `VpkTool` contra `vpk.exe` REAL (tarea 3.2).
 *
 * A diferencia de los unit tests de la tarea 2.8 (que usan un `CommandRunner`
 * mockeado en memoria), este test ejercita el ciclo completo `list → extract →
 * pack` con el binario `vpk.exe` de verdad, usando el `ChildProcessCommandRunner`
 * real. Toca disco y lanza procesos, así que es más lento que un unit test; está
 * bien: no es un property test ni corre en el bucle rápido de TDD.
 *
 * ---------------------------------------------------------------------------
 * SKIPPEABLE (requisito de la tarea): este test SOLO corre si `vpk.exe` existe
 * en la ruta conocida ({@link VPK_EXE_PATH}). En otra máquina o en CI sin el
 * binario, se SALTA con `describe.skip` en vez de fallar. Se usa `existsSync`
 * al cargar el módulo para decidir skip/run.
 * ---------------------------------------------------------------------------
 *
 * QUÉ VERIFICA (comportamiento CORRECTO de producción):
 *
 *   1. FIXTURE > 200 ARCHIVOS: `list` devuelve > 200 entradas y `extract` de
 *      TODOS esos paths en UNA SOLA llamada completa SIN error, escribiendo
 *      todos los archivos en disco. El particionado interno de `VpkTool.extract`
 *      (vía `batchInternalPaths`) parte la extracción en lotes seguros por sí
 *      solo: el test NO parte los paths a mano, justamente comprueba que
 *      `extract` lo haga internamente.
 *
 *      NOTA sobre el límite por cantidad de paths por lote: `batchInternalPaths`
 *      aplica DOS límites simultáneos, por longitud de la línea de comando y por
 *      CANTIDAD de paths por lote (`DEFAULT_MAX_BATCH_SIZE = 50`). El límite por
 *      cantidad surgió precisamente de este test de integración contra el
 *      `vpk.exe` real: se observó que el binario crashea con
 *      `STATUS_STACK_BUFFER_OVERRUN` (exit `0xC0000409`) cuando recibe demasiados
 *      argumentos de path en una sola invocación (a mano: 64 args OK, ~72-79 ya
 *      crashean), INDEPENDIENTEMENTE de la longitud total de la línea de comando.
 *      Por eso el límite por longitud no alcanzaba y se agregó el límite por
 *      cantidad. Detalle del hallazgo y de la decisión en el historial de
 *      decisiones (Context/04-historial-decisiones.md).
 *
 *   2. FIXTURE CON ESPACIOS: `extract` + `pack` sin error; el archivo cuyo
 *      nombre interno tiene espacios termina en la ubicación esperada en disco.
 *      Este es el VEREDICTO del caveat de quoting documentado en la tarea 2.3.
 *      RESULTADO OBSERVADO: PASA — el quoting/espacios NO rompe la extracción
 *      (execFile pasa los args sin shell y `vpk x` los recibe literalmente).
 *
 * NOTA sobre `vpk x` y creación de directorios (observado empíricamente): `vpk
 * x` NO crea los subdirectorios de destino; si no existen, reporta `extracting
 * ...` con exit 0 pero NO escribe el archivo (`FS: Tried to Write NULL file
 * handle!`). Esto es coherente con el diseño ("vpk x NO crea carpetas; el
 * llamador las crea"). Por eso este test —imitando lo que hará MergeEngine
 * (tarea 11)— CREA los subdirectorios de destino (derivados con
 * `internalPathToDiskPath`) ANTES de invocar `extract`.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { VpkTool, internalPathToDiskPath } from "../src/main/domain/index.js";
import { ChildProcessCommandRunner } from "../src/main/data/child-process-command-runner.js";
import {
  BIG_FIXTURE_FILE_COUNT,
  SPACED_INTERNAL_PATH,
  VPK_EXE_PATH,
  ensureFixtures,
  type GeneratedFixture,
} from "./helpers/vpk-fixtures.js";

// `vpk.exe` disponible ⇒ corre; ausente ⇒ se salta toda la suite.
const VPK_AVAILABLE = existsSync(VPK_EXE_PATH);
const suite = VPK_AVAILABLE ? describe : describe.skip;

const ADDON_ID = "integration-fixture";

/**
 * Cuenta recursivamente los archivos (no directorios) bajo `dir`. Se usa para
 * confirmar que la extracción escribió exactamente los archivos esperados.
 */
function countFilesRecursive(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFilesRecursive(full);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

/**
 * Crea, dentro de `destDir`, los subdirectorios necesarios para alojar cada uno
 * de los `internalPaths` traducidos a rutas de disco. `vpk x` NO crea carpetas,
 * así que esto imita lo que hará MergeEngine antes de extraer.
 */
function createDestDirsFor(destDir: string, internalPaths: readonly string[]): void {
  for (const internal of internalPaths) {
    const diskRelative = internalPathToDiskPath(internal);
    const absPath = join(destDir, diskRelative);
    mkdirSync(dirname(absPath), { recursive: true });
  }
}

suite("VpkTool integración con vpk.exe real (AC 6.1, 6.3, 6.4, 6.5, 6.8, 6.12)", () => {
  let big: GeneratedFixture;
  let spaced: GeneratedFixture;
  let tool: VpkTool;
  // Directorios temporales de extracción que hay que limpiar al terminar.
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const fixtures = await ensureFixtures(VPK_EXE_PATH);
    big = fixtures.big;
    spaced = fixtures.spaced;
    tool = new VpkTool(new ChildProcessCommandRunner(), VPK_EXE_PATH);
  }, 120_000);

  afterAll(() => {
    // Limpia solo los directorios temporales de extracción del SO; los fixtures
    // generados quedan en test/fixtures/vpk/generated/ (ignorados por git) para
    // reutilizarse en futuras corridas (idempotencia).
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Crea un directorio temporal de extracción único y lo registra para limpieza. */
  function makeExtractDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), `l4d2-vpk-${prefix}-`));
    tempDirs.push(dir);
    return dir;
  }

  test(
    "fixture > 200 archivos: list > 200 y extract único los escribe todos (batching interno parte solo en lotes seguros)",
    async () => {
      // list → debe devolver > 200 entradas (ruido ya filtrado por VpkTool).
      const listed = await tool.list(big.vpkPath, ADDON_ID);
      expect(listed.length).toBeGreaterThan(200);
      // El listado coincide con el conjunto esperado del generador.
      expect([...listed].sort()).toEqual([...big.internalPaths].sort());
      expect(listed.length).toBe(BIG_FIXTURE_FILE_COUNT);

      // -----------------------------------------------------------------------
      // Comportamiento CORRECTO: una ÚNICA llamada a `extract` con TODOS los
      // paths (los 260) debe completar SIN error. El particionado interno de
      // `VpkTool.extract` (vía batchInternalPaths, con el límite por CANTIDAD de
      // paths por lote) parte solo en lotes seguros y evita el crash del
      // binario. NO se parten los paths a mano: el punto es que extract lo haga.
      // -----------------------------------------------------------------------
      const destDir = makeExtractDir("big");
      createDestDirsFor(destDir, listed);
      await expect(
        tool.extract(big.vpkPath, listed, destDir, ADDON_ID),
      ).resolves.toBeUndefined();

      // TODOS los archivos deben quedar en disco en su ruta traducida.
      for (const internal of listed) {
        const absPath = join(destDir, internalPathToDiskPath(internal));
        expect(existsSync(absPath), `esperado en disco: ${absPath}`).toBe(true);
        expect(statSync(absPath).isFile()).toBe(true);
      }
      // Y el conteo recursivo debe coincidir exactamente con lo listado.
      expect(countFilesRecursive(destDir)).toBe(listed.length);
    },
    120_000,
  );

  test(
    "fixture con espacios: extract + pack sin error y el archivo con espacios queda en disco",
    async () => {
      const listed = await tool.list(spaced.vpkPath, ADDON_ID);
      // El path con espacios debe estar en el listado.
      expect(listed).toContain(SPACED_INTERNAL_PATH);
      expect([...listed].sort()).toEqual([...spaced.internalPaths].sort());

      const destDir = makeExtractDir("spaced");
      createDestDirsFor(destDir, listed);

      // VEREDICTO del caveat de quoting (tarea 2.3): extraer paths con espacios.
      await expect(tool.extract(spaced.vpkPath, listed, destDir, ADDON_ID)).resolves.toBeUndefined();

      // El archivo con ESPACIOS debe existir en su ubicación traducida a disco.
      const spacedAbs = join(destDir, internalPathToDiskPath(SPACED_INTERNAL_PATH));
      expect(existsSync(spacedAbs), `archivo con espacios esperado: ${spacedAbs}`).toBe(true);
      expect(statSync(spacedAbs).isFile()).toBe(true);

      // Todos los demás también.
      for (const internal of listed) {
        const absPath = join(destDir, internalPathToDiskPath(internal));
        expect(existsSync(absPath), `esperado en disco: ${absPath}`).toBe(true);
      }

      // pack: re-empaquetar la carpeta extraída debe completar sin error y
      // producir <destDir>.vpk.
      const packed = await tool.pack(destDir, ADDON_ID);
      expect(packed).toBe(`${destDir}.vpk`);
      expect(existsSync(packed)).toBe(true);
      // Registrar el .vpk generado por pack para limpieza.
      tempDirs.push(packed);
    },
    120_000,
  );

});
