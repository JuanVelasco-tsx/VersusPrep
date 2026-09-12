import fc from "fast-check";

import {
  DEFAULT_MAX_COMMAND_LENGTH,
  DEFAULT_MAX_BATCH_SIZE,
  DEFAULT_EXECUTABLE_NAME,
  batchInternalPaths,
  commandLengthForBatch,
} from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * BUG-011 — Property tests de PRESERVACIÓN (metodología *observación primero*).
 *
 * Capturan las garantías del contrato de `batchInternalPaths` que el fix (bajar
 * `DEFAULT_MAX_COMMAND_LENGTH`) NO debe cambiar. Se ejecutan con OPCIONES POR
 * DEFECTO (dependen del valor real de las constantes) de modo que:
 *
 *   - Sobre el código SIN arreglar (techo 6000) DEBEN PASAR (confirman la base
 *     a preservar).
 *   - Tras el fix (techo 1024) siguen PASANDO (confirman que no hay regresiones).
 *
 * Nota de scope: la metodología pide observar el comportamiento para entradas
 * donde `isBugCondition` retorna `false`. Estas garantías (sin pérdida, límite
 * de cantidad, path sobredimensionado aislado, entrada vacía, determinismo) son
 * INVARIANTES que valen para TODA entrada — no dependen del valor del techo de
 * longitud —, por lo que se verifican sin acotar a un régimen concreto y se
 * preservan idénticas a ambos lados del fix.
 *
 * NO se importa ni duplica ningún literal (1024/6000/50): las constantes se
 * traen del módulo.
 */

const exe = DEFAULT_EXECUTABLE_NAME;

/** Paths cortos: varios entran por lote. */
const shortPath: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 12 });
/** Paths medianos. */
const mediumPath: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 80 });
/**
 * Paths GIGANTES: por sí solos exceden el techo por defecto vigente. Se generan
 * con longitud > `DEFAULT_MAX_COMMAND_LENGTH` para forzar el caso (c) (path
 * aislado) de forma frecuente, tanto con techo 6000 como con techo 1024.
 */
const hugePath: fc.Arbitrary<string> = fc.string({
  minLength: DEFAULT_MAX_COMMAND_LENGTH + 1,
  maxLength: DEFAULT_MAX_COMMAND_LENGTH + 400,
});

/** Path arbitrario que cubre las tres familias de longitud. */
const pathArb: fc.Arbitrary<string> = fc.oneof(shortPath, mediumPath, hugePath);

/** vpkPath arbitrario razonable (solo su longitud afecta el overhead base). */
const vpkPathArb: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 90 });

/**
 * Caso: `{ internalPaths, vpkPath }`. Se usa `batchInternalPaths` con OPCIONES
 * POR DEFECTO en las propiedades (para depender del techo real). Los arrays
 * llegan a 120 elementos para superar cómodamente `DEFAULT_MAX_BATCH_SIZE = 50`
 * y forzar cortes por cantidad.
 */
const scenario = fc.record({
  internalPaths: fc.array(pathArb, { minLength: 0, maxLength: 120 }),
  vpkPath: vpkPathArb,
});

// ---------------------------------------------------------------------------
// Preservación (b): sin pérdida / duplicación / reordenamiento.
// Concatenar los lotes en orden reproduce EXACTAMENTE `internalPaths`.
// ---------------------------------------------------------------------------
propertyTest(
  9,
  "BUG-011 preservación (b): concatenar los lotes reproduce internalPaths exacto",
  fc.property(scenario, ({ internalPaths, vpkPath }) => {
    const batches = batchInternalPaths(internalPaths, vpkPath);
    const flat = batches.flat();
    if (flat.length !== internalPaths.length) return false;
    for (let i = 0; i < flat.length; i++) {
      if (flat[i] !== internalPaths[i]) return false;
    }
    // Extra: nunca hay lotes vacíos.
    return batches.every((b) => b.length > 0);
  }),
);

// ---------------------------------------------------------------------------
// Preservación (a'): ningún lote supera `DEFAULT_MAX_BATCH_SIZE` paths.
// ---------------------------------------------------------------------------
propertyTest(
  9,
  "BUG-011 preservación (a'): ningún lote supera DEFAULT_MAX_BATCH_SIZE",
  fc.property(scenario, ({ internalPaths, vpkPath }) => {
    const batches = batchInternalPaths(internalPaths, vpkPath);
    return batches.every((b) => b.length <= DEFAULT_MAX_BATCH_SIZE);
  }),
);

// ---------------------------------------------------------------------------
// Preservación (c): un path que por sí solo excede el techo queda aislado en su
// propio lote (length 1), sin descartarlo ni truncarlo.
// ---------------------------------------------------------------------------
propertyTest(
  9,
  "BUG-011 preservación (c): path sobredimensionado queda aislado en su propio lote",
  fc.property(scenario, ({ internalPaths, vpkPath }) => {
    const batches = batchInternalPaths(internalPaths, vpkPath);
    for (const path of internalPaths) {
      const individualCost = commandLengthForBatch([path], vpkPath, exe);
      if (individualCost <= DEFAULT_MAX_COMMAND_LENGTH) continue;
      const isolated = batches.some((b) => b.length === 1 && b[0] === path);
      if (!isolated) return false;
    }
    return true;
  }),
);

// ---------------------------------------------------------------------------
// Preservación: entrada vacía → [].
// ---------------------------------------------------------------------------
propertyTest(
  9,
  "BUG-011 preservación: internalPaths vacío devuelve []",
  fc.property(vpkPathArb, (vpkPath) => {
    const batches = batchInternalPaths([], vpkPath);
    return Array.isArray(batches) && batches.length === 0;
  }),
);

// ---------------------------------------------------------------------------
// Preservación: determinismo. Misma entrada → misma partición en dos corridas.
// ---------------------------------------------------------------------------
propertyTest(
  9,
  "BUG-011 preservación: determinismo (misma entrada → misma partición)",
  fc.property(scenario, ({ internalPaths, vpkPath }) => {
    const a = batchInternalPaths(internalPaths, vpkPath);
    const b = batchInternalPaths(internalPaths, vpkPath);
    return JSON.stringify(a) === JSON.stringify(b);
  }),
);

// ---------------------------------------------------------------------------
// TAREA 5 — Techo de longitud con el nuevo valor recalibrado (1024).
//
// Property (Expected Behavior de BUG-011): para listas arbitrarias de paths,
// NINGÚN lote producido por `batchInternalPaths` (con OPCIONES POR DEFECTO, es
// decir dependiendo del valor real de `DEFAULT_MAX_COMMAND_LENGTH`) excede el
// techo de longitud. ÚNICA excepción: un path que POR SÍ SOLO ya excede el
// techo, que se aísla en su propio lote (garantía (c)) y por tanto ese lote
// individual puede superar el techo. Se importa la constante desde el módulo;
// NO se duplica el literal 1024.
// ---------------------------------------------------------------------------
propertyTest(
  9,
  "BUG-011 expected behavior: ningún lote excede DEFAULT_MAX_COMMAND_LENGTH (salvo path sobredimensionado aislado)",
  fc.property(scenario, ({ internalPaths, vpkPath }) => {
    const batches = batchInternalPaths(internalPaths, vpkPath);
    for (const batch of batches) {
      const cost = commandLengthForBatch(batch, vpkPath, exe);
      if (cost <= DEFAULT_MAX_COMMAND_LENGTH) continue;
      // Excede el techo: solo es válido si es un path AISLADO que por sí solo
      // ya excedía el techo (garantía (c)). Cualquier otro caso es un fallo.
      if (batch.length !== 1) return false;
      const individualCost = commandLengthForBatch([batch[0]!], vpkPath, exe);
      if (individualCost <= DEFAULT_MAX_COMMAND_LENGTH) return false;
    }
    return true;
  }),
);
