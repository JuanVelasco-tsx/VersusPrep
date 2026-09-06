import fc from "fast-check";

import {
  DEFAULT_EXECUTABLE_NAME,
  batchInternalPaths,
  commandLengthForBatch,
  commandOverheadPrefix,
} from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * Property test del batching de la extracción `vpk x` por longitud de línea de
 * comando (Tarea 2.4).
 *
 * Property 9: Batching por longitud de línea de comando sin pérdida de archivos
 * **Validates: Requirements 6.4, 6.5**
 *
 * Para CUALQUIER lista de `internalPaths` (incluida la vacía), CUALQUIER
 * `vpkPath` razonable y CUALQUIER `maxCommandLength` válido, la partición
 * producida por `batchInternalPaths` debe cumplir:
 *
 *   (a) Límite por lote: un lote con MÁS de un path nunca excede
 *       `maxCommandLength`. Un lote de UN solo path solo puede exceder el
 *       límite si ese path POR SÍ SOLO ya lo excede
 *       (`commandLengthForBatch([path]) > maxCommandLength`); si no, también
 *       debe respetar el límite.
 *   (b) Sin pérdida: `batches.flat()` es EXACTAMENTE igual a `internalPaths`
 *       (mismo contenido, mismo orden, misma cantidad). Una sola comparación de
 *       igualdad de arrays cubre "sin omisiones", "sin duplicados" y "sin
 *       reordenamiento".
 *   (c) Path sobredimensionado aislado: todo path cuyo costo individual
 *       `commandLengthForBatch([path]) > maxCommandLength` aparece como ÚNICO
 *       elemento de su lote.
 *   Extra: ningún lote es vacío.
 *
 * NO se reimplementa el batching en el test. Se usa `commandLengthForBatch`
 * (misma FUENTE DE VERDAD del modelo de costo que usa el particionado) para
 * razonar sobre el costo de cada lote sin duplicar la fórmula.
 *
 * ---------------------------------------------------------------------------
 * ESTRATEGIA DE GENERACIÓN
 *
 * Se generan tres cosas y luego se acota `maxCommandLength` en función del
 * overhead base para que el límite tenga sentido:
 *
 *   1) `internalPaths`: `fc.array` de longitud variable (incluye la vacía, con
 *      `minLength: 0`) de paths generados por `pathArb`. `pathArb` es un
 *      `fc.oneof` de tres familias que garantiza cubrir los tres casos de la
 *      propiedad en el espacio de generación:
 *        - paths CORTOS (0..12 chars): varios entran por lote -> fuerza lotes
 *          MÚLTIPLES.
 *        - paths MEDIANOS (0..80 chars): cerca del límite chico -> fuerza
 *          cierres de lote y lotes de un solo path "normal".
 *        - paths GIGANTES (120..400 chars): con los límites chicos elegidos,
 *          por sí solos exceden `maxCommandLength` -> fuerza el caso (c) de
 *          forma frecuente.
 *      Se usa `fc.string` sin restricción de caracteres: para el batching los
 *      saltos de línea no importan (no se tokeniza por línea; el costo solo
 *      depende de `path.length`), así que se permiten strings arbitrarios sin
 *      sesgar el modelo.
 *
 *   2) `vpkPath`: string arbitrario razonable (0..60 chars). No afecta la
 *      lógica de partición salvo por su longitud, que entra en el overhead
 *      base; se mantiene acotado para no dominar el presupuesto de tamaño.
 *
 *   3) `maxCommandLength`: se elige >= overhead base para que el límite sea
 *      coherente (un lote nunca podría entrar por debajo del overhead fijo). Se
 *      construye como `overhead + extra`, con `extra` en dos regímenes vía
 *      `fc.oneof`:
 *        - régimen CHICO: `extra ∈ [0, 40]` -> caben pocos paths por lote,
 *          fuerza múltiples lotes y hace que los paths gigantes (y muchos
 *          medianos) excedan por sí solos -> ejercita (a), (b) y (c).
 *        - régimen HOLGADO: `extra ∈ [4000, 12000]` -> normalmente todo entra
 *          en uno o pocos lotes -> ejercita el camino "cabe holgado".
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

/**
 * Caso completo: `{ internalPaths, vpkPath, maxCommandLength }` con la
 * invariante `maxCommandLength >= overhead(vpkPath, exe)` garantizada por
 * construcción.
 */
const scenario = fc
  .record({
    internalPaths: fc.array(pathArb, { minLength: 0, maxLength: 60 }),
    vpkPath: vpkPathArb,
  })
  .chain(({ internalPaths, vpkPath }) => {
    const overhead = commandOverheadPrefix(vpkPath, exe).length;
    // Dos regímenes de holgura sobre el overhead base (ver cabecera).
    const extra = fc.oneof(
      fc.integer({ min: 0, max: 40 }), // chico: fuerza múltiples lotes y caso (c)
      fc.integer({ min: 4000, max: 12000 }), // holgado: todo entra en pocos lotes
    );
    return extra.map((e) => ({
      internalPaths,
      vpkPath,
      maxCommandLength: overhead + e,
    }));
  });

propertyTest(
  9,
  "Batching por longitud de línea de comando sin pérdida de archivos",
  fc.property(scenario, ({ internalPaths, vpkPath, maxCommandLength }) => {
    const batches = batchInternalPaths(internalPaths, vpkPath, {
      maxCommandLength,
      executableName: exe,
    });

    // Extra: ningún lote es vacío.
    for (const batch of batches) {
      if (batch.length === 0) return false;
    }

    // (a) Límite por lote, con la excepción precisa del path sobredimensionado.
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
