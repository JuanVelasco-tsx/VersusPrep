import fc from "fast-check";

import {
  DEFAULT_EXECUTABLE_NAME,
  batchInternalPaths,
  commandLengthForBatch,
  commandOverheadPrefix,
} from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

// NOTA: `DEFAULT_MAX_BATCH_SIZE` no se importa a propósito. El escenario genera
// un `maxBatchSize` arbitrario (>= 1) y lo pasa explícitamente a
// `batchInternalPaths` y a las aserciones, de modo que la propiedad se verifica
// sobre TODO el rango de límites de cantidad, no solo sobre el default.

/**
 * Property test del batching de la extracción `vpk x` por longitud de línea de
 * comando (Tarea 2.4).
 *
 * Property 9: Batching por longitud de línea de comando sin pérdida de archivos
 * **Validates: Requirements 6.4, 6.5**
 *
 * La propiedad sigue siendo la Property 9 (mismo título), ahora extendida con
 * la SEGUNDA dimensión del batching: el límite por CANTIDAD de paths por lote
 * (`maxBatchSize`), agregado tras confirmarse que `vpk.exe` crashea por exceso
 * de ARGUMENTOS aunque la línea de comando sea corta. Ambos límites (longitud y
 * cantidad) se aplican SIMULTÁNEAMENTE.
 *
 * Para CUALQUIER lista de `internalPaths` (incluida la vacía), CUALQUIER
 * `vpkPath` razonable, CUALQUIER `maxCommandLength` válido y CUALQUIER
 * `maxBatchSize >= 1`, la partición producida por `batchInternalPaths` debe
 * cumplir:
 *
 *   (a) Límite por LONGITUD: un lote con MÁS de un path nunca excede
 *       `maxCommandLength`. Un lote de UN solo path solo puede exceder el
 *       límite si ese path POR SÍ SOLO ya lo excede
 *       (`commandLengthForBatch([path]) > maxCommandLength`); si no, también
 *       debe respetar el límite.
 *   (a') Límite por CANTIDAD: TODO lote cumple `batch.length <= maxBatchSize`.
 *       Con `maxBatchSize >= 1` esto vale incluso para el lote aislado del caso
 *       (c) (length 1): el criterio de cantidad nunca fuerza un lote vacío ni
 *       impide que un solo path entre, así que la aserción es incondicional
 *       para todo lote.
 *   (b) Sin pérdida: `batches.flat()` es EXACTAMENTE igual a `internalPaths`
 *       (mismo contenido, mismo orden, misma cantidad). Una sola comparación de
 *       igualdad de arrays cubre "sin omisiones", "sin duplicados" y "sin
 *       reordenamiento".
 *   (c) Path sobredimensionado aislado (por LONGITUD): todo path cuyo costo
 *       individual `commandLengthForBatch([path]) > maxCommandLength` aparece
 *       como ÚNICO elemento de su lote.
 *   Extra: ningún lote es vacío.
 *
 * NO se reimplementa el batching en el test. Se usa `commandLengthForBatch`
 * (misma FUENTE DE VERDAD del modelo de costo que usa el particionado) para
 * razonar sobre el costo de cada lote sin duplicar la fórmula.
 *
 * ---------------------------------------------------------------------------
 * ESTRATEGIA DE GENERACIÓN
 *
 * Se generan cuatro cosas y luego se acota `maxCommandLength` en función del
 * overhead base para que el límite tenga sentido:
 *
 *   1) `internalPaths`: `fc.array` de longitud variable (incluye la vacía, con
 *      `minLength: 0`) de paths generados por `pathArb`. `pathArb` es un
 *      `fc.oneof` de tres familias que garantiza cubrir los tres casos de la
 *      propiedad en el espacio de generación:
 *        - paths CORTOS (0..12 chars): varios entran por lote -> fuerza lotes
 *          MÚLTIPLES. Combinados con un `maxBatchSize` chico, fuerzan además el
 *          corte por CANTIDAD (muchos paths cortos que caben de sobra por
 *          longitud pero superan el tope de cantidad): así se ejercita (a') de
 *          forma efectiva, no solo por longitud.
 *        - paths MEDIANOS (0..80 chars): cerca del límite chico -> fuerza
 *          cierres de lote y lotes de un solo path "normal".
 *        - paths GIGANTES (120..400 chars): con los límites chicos elegidos,
 *          por sí solos exceden `maxCommandLength` -> fuerza el caso (c) de
 *          forma frecuente.
 *      El array llega hasta 60 elementos, que con `maxBatchSize ∈ [1, 60]`
 *      basta para provocar varios lotes por corte de cantidad.
 *      Se usa `fc.string` sin restricción de caracteres: para el batching los
 *      saltos de línea no importan (no se tokeniza por línea; el costo solo
 *      depende de `path.length`), así que se permiten strings arbitrarios sin
 *      sesgar el modelo.
 *
 *   2) `vpkPath`: string arbitrario razonable (0..60 chars). No afecta la
 *      lógica de partición salvo por su longitud, que entra en el overhead
 *      base; se mantiene acotado para no dominar el presupuesto de tamaño.
 *
 *   3) `maxBatchSize`: entero arbitrario en `[1, 60]` (`fc.integer`). El mínimo
 *      1 respeta la precondición del contrato; el rango cubre desde lotes de un
 *      solo path (corte de cantidad agresivo) hasta topes que no llegan a
 *      activarse con arrays chicos.
 *
 *   4) `maxCommandLength`: se elige >= overhead base para que el límite sea
 *      coherente (un lote nunca podría entrar por debajo del overhead fijo). Se
 *      construye como `overhead + extra`, con `extra` en dos regímenes vía
 *      `fc.oneof`:
 *        - régimen CHICO: `extra ∈ [0, 40]` -> caben pocos paths por lote,
 *          fuerza múltiples lotes y hace que los paths gigantes (y muchos
 *          medianos) excedan por sí solos -> ejercita (a), (b) y (c).
 *        - régimen HOLGADO: `extra ∈ [4000, 12000]` -> normalmente todo entra
 *          en uno o pocos lotes POR LONGITUD; combinado con un `maxBatchSize`
 *          chico, el corte pasa a estar dominado por la CANTIDAD -> ejercita
 *          (a') de forma aislada del límite de longitud.
 *      `executableName` se fija en `DEFAULT_EXECUTABLE_NAME` para simplificar el
 *      razonamiento sobre el overhead; el valor concreto es irrelevante porque
 *      el test recalcula el overhead con el mismo `exe` que le pasa al batching.
 *
 * Como `overhead = commandOverheadPrefix(vpkPath, exe).length` depende del
 * `vpkPath` generado, `maxCommandLength` se genera DENTRO de un `chain` a partir
 * de `vpkPath`, garantizando así que SIEMPRE `maxCommandLength >= overhead`.
 * ---------------------------------------------------------------------------
 */

/** Ejecutable fijo para el cálculo del overhead (irrelevante salvo su longitud). */
const exe = DEFAULT_EXECUTABLE_NAME;

/** Paths cortos: varios caben por lote. */
const shortPath: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 12 });
/** Paths medianos: cerca del límite chico, fuerzan cierres de lote. */
const mediumPath: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 80 });
/** Paths gigantes: con límites chicos exceden por sí solos (caso (c)). */
const hugePath: fc.Arbitrary<string> = fc.string({ minLength: 120, maxLength: 400 });

/** Un path arbitrario que cubre las tres familias de longitud. */
const pathArb: fc.Arbitrary<string> = fc.oneof(shortPath, mediumPath, hugePath);

/** vpkPath arbitrario razonable (solo su longitud afecta el overhead base). */
const vpkPathArb: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 60 });

/** maxBatchSize arbitrario (>= 1, respeta la precondición del contrato). */
const maxBatchSizeArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 60 });

/**
 * Caso completo: `{ internalPaths, vpkPath, maxCommandLength, maxBatchSize }`
 * con la invariante `maxCommandLength >= overhead(vpkPath, exe)` garantizada por
 * construcción y `maxBatchSize >= 1`.
 */
const scenario = fc
  .record({
    internalPaths: fc.array(pathArb, { minLength: 0, maxLength: 60 }),
    vpkPath: vpkPathArb,
    maxBatchSize: maxBatchSizeArb,
  })
  .chain(({ internalPaths, vpkPath, maxBatchSize }) => {
    const overhead = commandOverheadPrefix(vpkPath, exe).length;
    // Dos regímenes de holgura sobre el overhead base (ver cabecera).
    const extra = fc.oneof(
      fc.integer({ min: 0, max: 40 }), // chico: fuerza múltiples lotes y caso (c)
      fc.integer({ min: 4000, max: 12000 }), // holgado: corte dominado por cantidad
    );
    return extra.map((e) => ({
      internalPaths,
      vpkPath,
      maxCommandLength: overhead + e,
      maxBatchSize,
    }));
  });

propertyTest(
  9,
  "Batching por longitud de línea de comando sin pérdida de archivos",
  fc.property(scenario, ({ internalPaths, vpkPath, maxCommandLength, maxBatchSize }) => {
    const batches = batchInternalPaths(internalPaths, vpkPath, {
      maxCommandLength,
      maxBatchSize,
      executableName: exe,
    });

    // Extra: ningún lote es vacío.
    for (const batch of batches) {
      if (batch.length === 0) return false;
    }

    // (a) Límite por LONGITUD, con la excepción precisa del path sobredimensionado.
    for (const batch of batches) {
      const cost = commandLengthForBatch(batch, vpkPath, exe);
      if (cost <= maxCommandLength) continue; // respeta el límite: OK siempre.
      // Excede el límite: solo se permite si es un lote de un ÚNICO path que
      // por sí solo ya excede (mismo costo, pues el lote ES ese path).
      if (batch.length !== 1) return false;
      // batch.length === 1 y cost > max: por definición ese path individual
      // excede el límite, así que la excepción de (a) se cumple. (cost aquí es
      // exactamente commandLengthForBatch([path]).)
    }

    // (a') Límite por CANTIDAD: TODO lote respeta maxBatchSize. Es incondicional
    //      (con maxBatchSize >= 1): incluso el lote aislado del caso (c) tiene
    //      length 1 <= maxBatchSize, así que no hay excepción como en (a).
    for (const batch of batches) {
      if (batch.length > maxBatchSize) return false;
    }

    // (b) Sin pérdida: flat() === internalPaths (contenido, orden y cantidad).
    const flat = batches.flat();
    if (flat.length !== internalPaths.length) return false;
    for (let i = 0; i < flat.length; i++) {
      if (flat[i] !== internalPaths[i]) return false;
    }

    // (c) Todo path sobredimensionado (costo individual > límite) queda como
    //     ÚNICO elemento de su lote.
    for (const path of internalPaths) {
      const individualCost = commandLengthForBatch([path], vpkPath, exe);
      if (individualCost <= maxCommandLength) continue;
      // Debe existir un lote que sea exactamente [path].
      const isolated = batches.some(
        (batch) => batch.length === 1 && batch[0] === path,
      );
      if (!isolated) return false;
    }

    return true;
  }),
);
