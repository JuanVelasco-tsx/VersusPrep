import { expect, test } from "vitest";
import fc from "fast-check";

import { classifyVScriptPaths, isVScriptPath } from "../src/main/domain/index.js";
import { MIN_NUM_RUNS, propertyName } from "./helpers/property.js";

/**
 * Property test de la Tarea 7.2: clasificación VScript a partir del listado REAL
 * del VPK.
 *
 * Feature: l4d2-versus-addon-manager, Property 5: Clasificación VScript a partir del listado real
 * **Validates: Requirements 3.2, 3.3, 3.4**
 *
 * La propiedad valida la FUNCIÓN PURA `classifyVScriptPaths(paths)` (el núcleo
 * del VScriptDetector) contra un ORÁCULO independiente computado desde el MODELO
 * generado. NO se usa el VScriptDetector ni el VpkTool aquí: el manejo del fallo
 * de `vpk l` (AC 3.5) ya lo cubren los unit tests de la tarea 7.1. Esta propiedad
 * se centra en el match del prefijo + extensión (AC 3.2, 3.3) y en que la
 * clasificación NO dependa de metadata (AC 3.4, implícito: solo mira paths).
 *
 * ---------------------------------------------------------------------------
 * PATRÓN DE REGISTRO
 *
 * Se usa un `test()` propio (en vez del helper `propertyTest`) porque la
 * propiedad necesita una ASERCIÓN DE NO-VACUIDAD al final: verificar que el
 * conjunto de casos generados ejercitó de verdad los escenarios positivo,
 * negativo y "prefijo engañoso", cosa que el helper no permite. Se importa
 * `propertyName(5, ...)` para el nombre canónico y `MIN_NUM_RUNS` (>= 100) para
 * las iteraciones, igual que en las Properties 2/3/4. Los `expect(...)
 * .toBeGreaterThan(0)` van DESPUÉS del `await fc.assert(...)`.
 * ---------------------------------------------------------------------------
 * ESTRATEGIA DE GENERACIÓN
 *
 * Se genera una lista arbitraria de paths internos de VPK combinando CINCO
 * CATEGORÍAS, cada una con una ETIQUETA en el modelo (`isMatch`, `tricky`) que
 * permite computar el oráculo SIN reimplementar la lógica de match:
 *
 *   A) MATCH real (isMatch = true): path bajo `scripts/vscripts/` con
 *      subdirectorios profundos arbitrarios, terminado en `.nut`, con CASING
 *      ARBITRARIO en prefijo y extensión (p. ej. `Scripts/VScripts/...Foo.NUT`).
 *      Es la ÚNICA categoría cuyo esperado es `true`.
 *   B) `.nut` FUERA del prefijo (isMatch = false): `scripts/foo.nut`,
 *      `vscripts/foo.nut`, `<algo>/foo.nut` con `<algo>` distinto de
 *      `scripts/vscripts` (AC 3.3).
 *   C) NO-`.nut` bajo el prefijo (isMatch = false): `scripts/vscripts/readme.txt`,
 *      `scripts/vscripts/model.mdl` (deben cumplirse AMBAS: prefijo Y extensión).
 *   D) PREFIJOS ENGAÑOSOS / "casi correctos" (isMatch = false, tricky = true):
 *      prefijos que EMPIEZAN parecido a `scripts/vscripts/` pero NO lo son:
 *        - `materials/vscripts/foo.nut` (vscripts pero bajo materials) — visto en la realidad.
 *        - `scripts/vscript/foo.nut` (sin la `s` final en `vscript`).
 *        - `scripts/vscriptsX/foo.nut` / `scripts/vscripts_extra/foo.nut`
 *          (el segmento NO cierra en `/` en `scripts/vscripts`, así que NO
 *          empieza con `scripts/vscripts/`).
 *        - `scriptsX/vscripts/foo.nut` (prefijo `scriptsX/`, no `scripts/`).
 *        - `scripts/vscriptsfoo.nut` (`scripts/vscripts` sin barra, pegado a un
 *          nombre + `.nut`).
 *      Todas NEGATIVAS por construcción: son el foco del refuerzo pedido.
 *   E) RUIDO variado (isMatch = false): paths que no son `.nut` ni bajo el
 *      prefijo (`materials/...`, `models/...`, `sound/...`, etc.).
 *
 * EL ORÁCULO se computa desde las ETIQUETAS del modelo, NO reimplementando
 * `startsWith`/`endsWith`: el esperado de `classifyVScriptPaths(listaCompleta)`
 * es `true` si y solo si el modelo contiene AL MENOS un ítem con `isMatch`
 * (categoría A). Las categorías engañosas (D) se generan de forma que por
 * construcción NUNCA son match, así que el oráculo las cuenta como no-match sin
 * necesidad de aplicar la lógica real.
 *
 * El orden queda BARAJADO porque cada ítem de la lista es un `fc.oneof` sobre
 * las cinco categorías generado independientemente: los matches (A) pueden caer
 * en cualquier posición, así que el resultado no depende de la posición.
 *
 * SESGO leve de no-vacuidad: para garantizar que las tres condiciones de
 * no-vacuidad (positivos, negativos y tricky) se den con frecuencia > 0 en 100
 * iteraciones, `itemArb` usa `fc.oneof` con pesos: se favorece un poco la
 * categoría A (para tener positivos) y la D (para tener tricky), sin quitar
 * generalidad (todas las categorías siguen siendo alcanzables y el array puede
 * quedar vacío o solo-negativo). El array admite longitud 0 (`minLength: 0`)
 * para cubrir también el caso de listado vacío ⇒ esperado `false`.
 * ---------------------------------------------------------------------------
 */

/** Un ítem del modelo: el path y las etiquetas que alimentan el oráculo. */
interface PathModel {
  readonly path: string;
  /** true solo para la categoría A (match real). El oráculo lo lee directo. */
  readonly isMatch: boolean;
  /** true para la categoría D (prefijo engañoso), para el contador tricky. */
  readonly tricky: boolean;
}

/** Segmento arbitrario de nombre de directorio/archivo: letras/dígitos, no vacío. */
const segment: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 8 })
  .map((s) => s.replace(/[^a-zA-Z0-9]/g, "x"))
  .map((s) => (s.length === 0 ? "x" : s));

/** Aplica casing arbitrario carácter a carácter (para probar case-insensitive). */
function randomCasing(input: string): fc.Arbitrary<string> {
  return fc.array(fc.boolean(), { minLength: input.length, maxLength: input.length }).map((flags) =>
    input
      .split("")
      .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
      .join(""),
  );
}

/** Cadena de subdirectorios profundos arbitrarios (posiblemente vacía). */
const deepSubdirs: fc.Arbitrary<string> = fc
  .array(segment, { minLength: 0, maxLength: 4 })
  .map((parts) => (parts.length === 0 ? "" : parts.join("/") + "/"));

// ---------------------------------------------------------------------------
// A) MATCH real: scripts/vscripts/<subdirs>/<name>.nut con casing arbitrario.
// ---------------------------------------------------------------------------
const categoryA: fc.Arbitrary<PathModel> = fc
  .record({ subdirs: deepSubdirs, name: segment })
  .chain(({ subdirs, name }) => {
    const raw = `scripts/vscripts/${subdirs}${name}.nut`;
    return randomCasing(raw).map((path) => ({ path, isMatch: true, tricky: false }));
  });

// ---------------------------------------------------------------------------
// B) `.nut` FUERA del prefijo (AC 3.3): NO cuenta.
// ---------------------------------------------------------------------------
const categoryB: fc.Arbitrary<PathModel> = fc
  .oneof(
    fc.record({ name: segment }).map(({ name }) => `scripts/${name}.nut`),
    fc.record({ name: segment }).map(({ name }) => `vscripts/${name}.nut`),
    // <algo>/foo.nut con <algo> que no sea "scripts" ni "vscripts".
    fc
      .record({ dir: segment.filter((d) => d !== "scripts" && d !== "vscripts"), name: segment })
      .map(({ dir, name }) => `${dir}/${name}.nut`),
  )
  .map((path) => ({ path, isMatch: false, tricky: false }));

// ---------------------------------------------------------------------------
// C) NO-`.nut` bajo el prefijo: falta la extensión ⇒ NO cuenta.
// ---------------------------------------------------------------------------
const nonNutExt: fc.Arbitrary<string> = fc.constantFrom("txt", "mdl", "vmt", "vtf", "cfg", "wav");
const categoryC: fc.Arbitrary<PathModel> = fc
  .record({ subdirs: deepSubdirs, name: segment, ext: nonNutExt })
  .map(({ subdirs, name, ext }) => ({
    path: `scripts/vscripts/${subdirs}${name}.${ext}`,
    isMatch: false,
    tricky: false,
  }));

// ---------------------------------------------------------------------------
// D) PREFIJOS ENGAÑOSOS / "casi correctos": NEGATIVOS por construcción.
// ---------------------------------------------------------------------------
const categoryD: fc.Arbitrary<PathModel> = fc
  .oneof(
    // vscripts pero bajo materials (visto en la realidad).
    fc.record({ name: segment }).map(({ name }) => `materials/vscripts/${name}.nut`),
    // sin la `s` final en `vscript`.
    fc.record({ name: segment }).map(({ name }) => `scripts/vscript/${name}.nut`),
    // el segmento no cierra en `/` justo en `scripts/vscripts`: scripts/vscriptsX/...
    fc
      .record({ suffix: segment, name: segment })
      .map(({ suffix, name }) => `scripts/vscripts${suffix}/${name}.nut`),
    fc.record({ name: segment }).map(({ name }) => `scripts/vscripts_extra/${name}.nut`),
    // prefijo scriptsX/, no scripts/.
    fc
      .record({ suffix: segment, name: segment })
      .map(({ suffix, name }) => `scripts${suffix}/vscripts/${name}.nut`),
    // scripts/vscripts sin barra, pegado a un nombre + .nut.
    fc.record({ name: segment }).map(({ name }) => `scripts/vscripts${name}.nut`),
  )
  .map((path) => ({ path, isMatch: false, tricky: true }));

// ---------------------------------------------------------------------------
// E) RUIDO variado: no `.nut` ni bajo el prefijo.
// ---------------------------------------------------------------------------
const noiseRoot: fc.Arbitrary<string> = fc.constantFrom(
  "materials",
  "models",
  "sound",
  "particles",
  "resource",
);
const categoryE: fc.Arbitrary<PathModel> = fc
  .record({ root: noiseRoot, subdirs: deepSubdirs, name: segment, ext: nonNutExt })
  .map(({ root, subdirs, name, ext }) => ({
    path: `${root}/${subdirs}${name}.${ext}`,
    isMatch: false,
    tricky: false,
  }));

/**
 * Un ítem arbitrario del listado. Pesos leves: se favorece A (positivos) y D
 * (tricky) para asegurar no-vacuidad de esas condiciones en 100 iteraciones,
 * sin excluir ninguna categoría.
 */
const itemArb: fc.Arbitrary<PathModel> = fc.oneof(
  { weight: 3, arbitrary: categoryA },
  { weight: 2, arbitrary: categoryB },
  { weight: 2, arbitrary: categoryC },
  { weight: 3, arbitrary: categoryD },
  { weight: 2, arbitrary: categoryE },
);

/** Un listado arbitrario (posiblemente vacío) de ítems etiquetados. */
const listingArb: fc.Arbitrary<readonly PathModel[]> = fc.array(itemArb, {
  minLength: 0,
  maxLength: 20,
});

// Contadores de NO-VACUIDAD (afirmados > 0 tras el assert).
let positiveCount = 0;
let negativeCount = 0;
let trickyCount = 0;

test(propertyName(5, "Clasificación VScript a partir del listado real"), async () => {
  await fc.assert(
    fc.property(listingArb, (model) => {
      const paths = model.map((m) => m.path);

      // ORÁCULO desde el MODELO: true sii hay al menos un ítem categoría A.
      const expected = model.some((m) => m.isMatch);
      const includesTricky = model.some((m) => m.tricky);

      if (expected) positiveCount++;
      else negativeCount++;
      if (includesTricky) trickyCount++;

      // Propiedad principal (AC 3.2, 3.3).
      expect(classifyVScriptPaths(paths)).toBe(expected);

      // Refuerzo: cada path de categoría D (engañoso) NUNCA es match.
      for (const item of model) {
        if (item.tricky) {
          expect(isVScriptPath(item.path)).toBe(false);
        }
      }
    }),
    { numRuns: MIN_NUM_RUNS },
  );

  // NO-VACUIDAD: el conjunto generado ejercitó de verdad los tres escenarios.
  // Valores medidos DIRECTAMENTE del test commiteado (vía writeFileSync a un
  // archivo, ver la nota de proceso del 2026-09-06 en
  // Context/04-historial-decisiones.md) en 100 iteraciones: positiveCount=65,
  // negativeCount=35, trickyCount=61. Los tres holgadamente > 0. Los pesos leves
  // de `itemArb` (A y D favorecidas) bastan para mantener los tres > 0.
  expect(positiveCount).toBeGreaterThan(0);
  expect(negativeCount).toBeGreaterThan(0);
  expect(trickyCount).toBeGreaterThan(0);
});
