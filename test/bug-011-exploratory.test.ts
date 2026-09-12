import { describe, expect, test } from "vitest";

import {
  DEFAULT_MAX_COMMAND_LENGTH,
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_EXECUTABLE_NAME,
  batchInternalPaths,
  commandLengthForBatch,
  commandOverheadPrefix,
} from "../src/main/domain/index.js";

/**
 * BUG-011 — Test de exploración de la Bug Condition (metodología *bug condition*).
 *
 * OBJETIVO: surfacear el contraejemplo que demuestra que `batchInternalPaths`,
 * con el techo de longitud VIGENTE (`DEFAULT_MAX_COMMAND_LENGTH = 6000`), deja
 * pasar un lote cuya línea de comando supera el límite REAL de `vpk.exe`
 * (`LIMITE_REAL_SEGURO_VPK = 1719`), disparando el crash `0xC0000409`
 * (`STATUS_STACK_BUFFER_OVERRUN`).
 *
 * METODOLOGÍA — este test se ejecuta SOBRE EL CÓDIGO SIN ARREGLAR:
 *   - Sobre el código actual (techo 6000) el test DEBE FALLAR. Su fallo
 *     confirma que la bug condition se cumple (`isBugCondition` retorna `true`).
 *   - Tras el fix (techo 1024, tarea 3.1) este MISMO test DEBE PASAR: el lote
 *     del contraejemplo se parte en varios lotes, cada uno ≤ 1719.
 *
 * La aserción codifica el COMPORTAMIENTO CORRECTO: ningún lote producido por
 * `batchInternalPaths` (con opciones POR DEFECTO, para que dependa del valor
 * real de la constante) debe exceder `LIMITE_REAL_SEGURO_VPK`.
 */

/**
 * Referencia empírica del máximo de caracteres de línea de comando que
 * `vpk.exe` tolera sin crashear, medido contra el binario real con overhead de
 * producción. Último valor sano observado = 1719; primer crash observado = 2031
 * (`0xC0000409`). Se toma 1719 como referencia segura conservadora.
 */
const LIMITE_REAL_SEGURO_VPK = 1719;

/**
 * `vpkPath` de longitud representativa de PRODUCCIÓN (~85 chars). Con una ruta
 * corta el overhead se subestima y el test dejaría de reflejar el crash real.
 * Ruta construida para medir exactamente 85 caracteres.
 */
const VPK_PATH_PRODUCCION =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\left 4 dead 2\\left4dead2\\addons\\627562239.vpk"; // 95 chars

/**
 * Construye el conjunto del contraejemplo: `count` paths internos LARGOS de
 * `pathLen` caracteres cada uno, representando subcarpetas profundas de un addon
 * (como el 627562239 reportado por QA).
 *
 * La longitud de cada path se rellena a `pathLen` exactos para que el cálculo de
 * la línea de comando total sea determinista y reproducible.
 */
function buildLongInternalPaths(count: number, pathLen: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const base = `materials/models/props/addon627562239/subcarpeta_profunda_${i}/`;
    // Rellenar hasta pathLen exactos con un nombre de archivo largo.
    const remaining = pathLen - base.length;
    const filler = remaining > 0 ? "t".repeat(remaining - 4) + ".vtf" : "";
    return (base + filler).slice(0, pathLen);
  });
}

describe("BUG-011: exploración de la Bug Condition (crash de vpk.exe por LONGITUD)", () => {
  // ---------------------------------------------------------------------------
  // CONTRAEJEMPLO CONCRETO
  //
  //   - vpkPath: ruta de producción (~91 chars) → overhead ~101 chars
  //     (overhead base = len("vpk.exe x <vpkPath>") = 7 + 3 + len(vpkPath))
  //   - 40 paths internos de 47 chars cada uno
  //   - línea de comando total ≈ 101 + 40 * (1 + 47) = 101 + 1920 = 2021 chars
  //
  // ~2021 chars está POR ENCIMA del último valor sano medido (1719) y POR DEBAJO
  // del techo viejo (6000), con 40 ≤ 50 paths. Es decir: el lote respeta AMBOS
  // límites configurados actuales pero excede el límite REAL de vpk.exe.
  //
  // Sobre el código SIN arreglar (techo 6000), batchInternalPaths deja los 40
  // paths en UN SOLO lote de ~2021 chars > 1719 → la aserción FALLA (CORRECTO:
  // prueba que la bug condition se cumple).
  // ---------------------------------------------------------------------------
  const PATH_COUNT = 40;
  const PATH_LEN = 47;

  test("ningún lote debe exceder el límite real de vpk.exe (1719 chars)", () => {
    const internalPaths = buildLongInternalPaths(PATH_COUNT, PATH_LEN);

    // Sanidad del contraejemplo: respeta AMBOS límites configurados actuales.
    const overhead = commandOverheadPrefix(VPK_PATH_PRODUCCION, DEFAULT_EXECUTABLE_NAME).length;
    const totalSiUnSoloLote = commandLengthForBatch(internalPaths, VPK_PATH_PRODUCCION);
    // Overhead de producción representativo (vpkPath largo → overhead ~100 chars).
    expect(overhead).toBeGreaterThanOrEqual(95);
    // El conjunto entero (si quedara en un único lote) supera el límite real…
    expect(totalSiUnSoloLote).toBeGreaterThan(LIMITE_REAL_SEGURO_VPK);
    // …pero respeta el techo viejo (6000) y la cantidad (≤ 50).
    expect(totalSiUnSoloLote).toBeLessThanOrEqual(6000);
    expect(internalPaths.length).toBeLessThanOrEqual(DEFAULT_MAX_BATCH_SIZE);

    // Particionar con OPCIONES POR DEFECTO: depende del valor real de la
    // constante `DEFAULT_MAX_COMMAND_LENGTH` (por eso el test cambia de
    // resultado con el fix).
    const batches = batchInternalPaths(internalPaths, VPK_PATH_PRODUCCION);

    // COMPORTAMIENTO CORRECTO: todo lote ≤ límite real seguro de vpk.exe.
    // (Con techo 6000 esto FALLA — bug condition; con techo 1024 PASA — fix.)
    for (const batch of batches) {
      const cost = commandLengthForBatch(batch, VPK_PATH_PRODUCCION);
      expect(cost).toBeLessThanOrEqual(LIMITE_REAL_SEGURO_VPK);
    }
  });
});

// ===========================================================================
// TAREA 4 — Unit tests del particionado con el NUEVO techo (1024).
//
// Verifican, con ejemplos concretos y edge cases, que la recalibración de
// `DEFAULT_MAX_COMMAND_LENGTH` (6000 → 1024) surte efecto en el particionado y
// que las garantías del contrato (sin pérdida, aislamiento del path
// sobredimensionado, entrada vacía) y el modelo de costo (`commandLengthForBatch`)
// permanecen intactos. Complementan al property test de preservación (tarea 5).
// ===========================================================================

describe("BUG-011 tarea 4: particionado con el nuevo techo (1024)", () => {
  test("las constantes tienen los valores recalibrados (techo 1024, cantidad 50)", () => {
    expect(DEFAULT_MAX_COMMAND_LENGTH).toBe(1024);
    expect(DEFAULT_MAX_BATCH_SIZE).toBe(50);
  });

  test("el contraejemplo (40 paths largos, ~2021 chars totales) se parte en varios lotes ≤ 1024", () => {
    // Mismo conjunto que dispara la bug condition con el techo viejo (6000):
    // 40 paths de 47 chars → línea de comando total ~2021 chars (≤ 6000, ≤ 50).
    const internalPaths = buildLongInternalPaths(40, 47);

    // Sanidad: en un solo lote superaría 1024 (por eso debe partirse).
    const totalSiUnSoloLote = commandLengthForBatch(internalPaths, VPK_PATH_PRODUCCION);
    expect(totalSiUnSoloLote).toBeGreaterThan(DEFAULT_MAX_COMMAND_LENGTH);

    const batches = batchInternalPaths(internalPaths, VPK_PATH_PRODUCCION);

    // Se parte en MÁS de un lote…
    expect(batches.length).toBeGreaterThan(1);
    // …y cada lote respeta el nuevo techo de longitud.
    for (const batch of batches) {
      const cost = commandLengthForBatch(batch, VPK_PATH_PRODUCCION);
      expect(cost).toBeLessThanOrEqual(DEFAULT_MAX_COMMAND_LENGTH);
    }
    // Sin pérdida: concatenar reproduce la entrada exacta (garantía (b)).
    expect(batches.flat()).toEqual(internalPaths);
  });

  test("edge case: internalPaths vacío devuelve [] (cero lotes)", () => {
    expect(batchInternalPaths([], VPK_PATH_PRODUCCION)).toEqual([]);
  });

  test("edge case: un solo path corto → un único lote con ese path", () => {
    const batches = batchInternalPaths(["materials/x.vmt"], VPK_PATH_PRODUCCION);
    expect(batches).toEqual([["materials/x.vmt"]]);
  });

  test("edge case: un path que por sí solo excede 1024 queda aislado en su propio lote, sin truncar (garantía (c))", () => {
    // Un único path cuyo costo individual ya supera el techo nuevo.
    const overhead = commandOverheadPrefix(VPK_PATH_PRODUCCION, DEFAULT_EXECUTABLE_NAME).length;
    const hugeLen = DEFAULT_MAX_COMMAND_LENGTH - overhead + 50; // asegura exceso
    const huge = "materials/" + "z".repeat(hugeLen);
    const shortBefore = "models/a.mdl";
    const shortAfter = "sound/b.wav";

    const batches = batchInternalPaths([shortBefore, huge, shortAfter], VPK_PATH_PRODUCCION);

    // El path gigante está aislado en su PROPIO lote (length 1) y sin alterar.
    const isolated = batches.find((b) => b.length === 1 && b[0] === huge);
    expect(isolated).toBeDefined();
    // No se trunca: el path del lote aislado es idéntico al original.
    expect(isolated![0]).toBe(huge);
    // Sin pérdida: todos los paths están presentes, en orden.
    expect(batches.flat()).toEqual([shortBefore, huge, shortAfter]);
  });
});

describe("BUG-011 tarea 4: commandLengthForBatch (fórmula) sin cambios", () => {
  test("aplica la fórmula len('<exe> x <vpk>') + Σ (1 + len(path))", () => {
    const vpk = "C:/games/left4dead2/addons/123.vpk";
    const paths = ["materials/a.vmt", "models/b.mdl"];
    const overhead = commandOverheadPrefix(vpk, DEFAULT_EXECUTABLE_NAME).length;
    const esperado = overhead + (1 + paths[0]!.length) + (1 + paths[1]!.length);
    expect(commandLengthForBatch(paths, vpk)).toBe(esperado);
  });

  test("lote vacío cuesta exactamente el overhead base", () => {
    const vpk = "C:/games/left4dead2/addons/123.vpk";
    const overhead = commandOverheadPrefix(vpk, DEFAULT_EXECUTABLE_NAME).length;
    expect(commandLengthForBatch([], vpk)).toBe(overhead);
  });

  test("respeta un executableName personalizado en el overhead", () => {
    const vpk = "C:/games/left4dead2/addons/123.vpk";
    const exe = "C:/Program Files (x86)/Steam/.../bin/vpk.exe";
    const paths = ["materials/a.vmt"];
    const overhead = commandOverheadPrefix(vpk, exe).length;
    expect(commandLengthForBatch(paths, vpk, exe)).toBe(overhead + 1 + paths[0]!.length);
  });
});
