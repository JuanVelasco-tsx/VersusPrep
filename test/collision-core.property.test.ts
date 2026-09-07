import { expect, test } from "vitest";
import fc from "fast-check";

import {
  resolveMerge,
  toCollisionKey,
  type AddonContribution,
} from "../src/main/domain/index.js";
import { MIN_NUM_RUNS, propertyName } from "./helpers/property.js";

/**
 * Property test de la Tarea 10.3: fusión determinista y "el último del
 * Priority_Order gana".
 *
 * Feature: l4d2-versus-addon-manager, Property 11: Fusión determinista y "el último del Priority_Order gana"
 * **Validates: Requirements 6.7, 7.1, 7.2**
 *
 * La propiedad valida el NÚCLEO PURO `resolveMerge(contributions)` (extraído en
 * la Tarea 10.2), NO el I/O de `CollisionResolver.mergeInto`. `resolveMerge` es
 * puro y determinista respecto de su entrada (la lista de `AddonContribution` en
 * Priority_Order ASCENDENTE), ideal para PBT sin tocar disco.
 *
 * Se verifican TRES cosas dentro de un mismo `fc.property` (comparten generador,
 * como hace la Property 5/9):
 *
 *   1) GANADOR CORRECTO (AC 7.2): para cada path (clave normalizada), el
 *      `winner` que devuelve `resolveMerge` es el ÚLTIMO addon del Priority_Order
 *      ASCENDENTE que aporta ese path.
 *   2) COLISIONES (AC 7.1): `report.collisions` contiene EXACTAMENTE los paths
 *      aportados por >= 2 addons, con `contributors` en orden ascendente y
 *      `winner` = el último.
 *   3) DETERMINISMO (AC 6.7): llamar `resolveMerge` dos veces con la MISMA
 *      entrada produce EXACTAMENTE el mismo resultado (winners y collisions
 *      idénticos, mismo orden).
 *
 * ---------------------------------------------------------------------------
 * ORÁCULO — cómo se computa el esperado sin reimplementar el núcleo.
 *
 * El generador produce un MODELO explícito por addon: qué CLAVES LÓGICAS
 * canónicas aporta cada addon, y en qué ORDEN ascendente están los addons. A
 * partir de ese modelo el oráculo computa, de forma independiente de la
 * implementación interna del núcleo:
 *
 *   - el mapa `clave -> lista de addons que la aportan, en orden ascendente`;
 *   - el ganador esperado de cada clave = el ÚLTIMO addon de esa lista;
 *   - las colisiones esperadas = las claves con >= 2 addons.
 *
 * ELECCIÓN SOBRE LA NORMALIZACIÓN DE CLAVE (documentada): el generador define
 * una CLAVE LÓGICA ya en forma canónica (separador `/`, minúsculas, sin líder) y
 * produce los `relativePaths` REALES aplicándole variaciones de SUPERFICIE
 * (casing arbitrario + separador `\` vs `/` + separadores líderes) que, POR
 * CONSTRUCCIÓN, colapsan a esa misma clave. Así el modelo conoce la clave
 * esperada sin depender del comportamiento interno del núcleo.
 *
 * La única función del núcleo que se reutiliza en el oráculo es `toCollisionKey`
 * aplicada a la clave lógica YA canónica: como esa entrada ya está normalizada,
 * `toCollisionKey` es idempotente sobre ella (no cambia nada), así que su uso
 * aquí solo confirma la forma canónica y NO reimplementa ni depende de la lógica
 * de normalización de variantes. Se prefirió esto a modelar la normalización a
 * mano en el oráculo: modelarla duplicaría la fórmula y podría divergir; usar
 * `toCollisionKey` sobre una entrada ya canónica es robusto e idempotente. Que
 * las VARIANTES de superficie realmente colapsan a la clave lógica lo verifica
 * además, dentro del predicado, una aserción explícita (`toCollisionKey(variant)
 * === logicalKey`) que actúa de red de seguridad del generador.
 * ---------------------------------------------------------------------------
 * ESTRATEGIA DE GENERACIÓN
 *
 * 1) Se genera un POOL de claves lógicas canónicas únicas (paths tipo
 *    `dir/sub/name.ext`, en minúsculas y con `/`). Es el universo de paths
 *    lógicos que los addons pueden aportar.
 * 2) Se genera un número arbitrario de addons con `addonId` ÚNICOS.
 * 3) Para cada addon se elige un SUBCONJUNTO del pool (posiblemente vacío); esos
 *    son los paths lógicos que aporta. Para CADA path se genera una VARIANTE de
 *    superficie (casing/separador/líder arbitrarios) que colapsa a la clave
 *    lógica: así dos addons distintos que aportan la misma clave lógica pueden
 *    hacerlo con casing/separadores DISTINTOS y aun así colisionar (ejercita la
 *    normalización, AC 7.1 + 6.6).
 * 4) El ORDEN del arreglo de addons ES el Priority_Order ascendente. Se genera
 *    directamente como una lista ordenada arbitraria (fast-check ya explora
 *    permutaciones al variar la composición y el orden del array), cubriendo
 *    Priority_Orders arbitrarios.
 *
 * SESGOS de no-vacuidad: el pool se mantiene chico (1..6 claves) y hay 2..5
 * addons que suelen elegir >= 1 path, de modo que las COLISIONES (misma clave
 * lógica en >= 2 addons) aparecen con frecuencia alta; a la vez, con paths
 * únicos por addon y addons sin colisión se cubre el caso sin colisión. Las
 * variantes de superficie garantizan casos de casing/separador distinto que
 * colapsan a la misma clave.
 * ---------------------------------------------------------------------------
 */

/** Un segmento de path canónico: letras/dígitos en minúscula, no vacío. */
const canonicalSegment: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 6 })
  .map((s) => s.replace(/[^a-zA-Z0-9]/g, "x").toLowerCase())
  .map((s) => (s.length === 0 ? "x" : s));

/** Una clave lógica canónica: `seg/seg/.../name.ext`, minúsculas y con `/`. */
const logicalKeyArb: fc.Arbitrary<string> = fc
  .record({
    dirs: fc.array(canonicalSegment, { minLength: 0, maxLength: 3 }),
    name: canonicalSegment,
    ext: fc.constantFrom("vmt", "vtf", "mdl", "wav", "txt", "nut"),
  })
  .map(({ dirs, name, ext }) => {
    const prefix = dirs.length === 0 ? "" : dirs.join("/") + "/";
    return `${prefix}${name}.${ext}`;
  });

/**
 * Aplica una VARIANTE de superficie a una clave lógica canónica: casing
 * arbitrario por carácter, `/` -> `\` opcional, y separador(es) líder(es)
 * opcionales. Todas colapsan a la misma clave vía `toCollisionKey`.
 */
function surfaceVariant(logicalKey: string): fc.Arbitrary<string> {
  return fc
    .record({
      casingFlags: fc.array(fc.boolean(), {
        minLength: logicalKey.length,
        maxLength: logicalKey.length,
      }),
      useBackslash: fc.boolean(),
      leader: fc.constantFrom("", "/", "\\", "//"),
    })
    .map(({ casingFlags, useBackslash, leader }) => {
      const cased = logicalKey
        .split("")
        .map((ch, i) => (casingFlags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join("");
      const withSep = useBackslash ? cased.replace(/\//g, "\\") : cased;
      return leader + withSep;
    });
}

/** Modelo de un addon: su id y las claves lógicas (canónicas) que aporta. */
interface AddonModel {
  readonly addonId: string;
  /** Claves lógicas canónicas que aporta (sin duplicados intra-addon). */
  readonly logicalKeys: readonly string[];
  /** La contribución REAL (con variantes de superficie) que se pasa al núcleo. */
  readonly contribution: AddonContribution;
}

/**
 * Escenario completo: una lista de addons en Priority_Order ASCENDENTE, cada uno
 * con sus claves lógicas y su `AddonContribution` real (variantes de superficie).
 */
const scenarioArb: fc.Arbitrary<readonly AddonModel[]> = fc
  // Pool chico de claves lógicas ÚNICAS -> colisiones frecuentes.
  .uniqueArray(logicalKeyArb, { minLength: 1, maxLength: 6 })
  .chain((pool) =>
    fc
      // addonIds ÚNICOS (2..5 addons).
      .uniqueArray(
        fc
          .string({ minLength: 1, maxLength: 5 })
          .map((s) => s.replace(/[^a-zA-Z0-9]/g, "a"))
          .map((s) => (s.length === 0 ? "a" : s)),
        { minLength: 2, maxLength: 5 },
      )
      .chain((addonIds) =>
        fc
          .tuple(
            ...addonIds.map((addonId) =>
              // Subconjunto arbitrario del pool para este addon (índices únicos).
              fc
                .uniqueArray(fc.nat({ max: pool.length - 1 }), {
                  minLength: 0,
                  maxLength: pool.length,
                })
                .chain((indices) => {
                  const keys = indices.map((i) => pool[i] as string);
                  // Para cada clave lógica, una variante de superficie real.
                  return fc
                    .tuple(...keys.map((k) => surfaceVariant(k)))
                    .map((variants) => {
                      const model: AddonModel = {
                        addonId,
                        logicalKeys: keys,
                        contribution: { addonId, relativePaths: variants },
                      };
                      return model;
                    });
                }),
            ),
          )
          .map((models) => models as readonly AddonModel[]),
      ),
  );

// Contadores de NO-VACUIDAD (afirmados > 0 tras el assert).
let withCollisionCount = 0;
let withoutCollisionCount = 0;
let mixedSurfaceCollisionCount = 0;

test(
  propertyName(11, 'Fusión determinista y "el último del Priority_Order gana"'),
  async () => {
    await fc.assert(
      fc.property(scenarioArb, (models) => {
        const contributions: readonly AddonContribution[] = models.map(
          (m) => m.contribution,
        );

        // --- ORÁCULO desde el MODELO (independiente del núcleo) --------------
        // clave normalizada -> lista de addonIds que la aportan, en orden
        // ascendente (el orden de `models` ES el Priority_Order ascendente).
        const oracle = new Map<string, string[]>();
        for (const m of models) {
          for (const logicalKey of m.logicalKeys) {
            // La clave lógica ya es canónica: toCollisionKey es idempotente aquí.
            const key = toCollisionKey(logicalKey);
            const list = oracle.get(key);
            if (list === undefined) oracle.set(key, [m.addonId]);
            else list.push(m.addonId);
          }
        }

        // Red de seguridad del generador: cada variante real colapsa a su clave.
        for (const m of models) {
          for (let i = 0; i < m.logicalKeys.length; i++) {
            const variant = m.contribution.relativePaths[i] as string;
            const logicalKey = m.logicalKeys[i] as string;
            expect(toCollisionKey(variant)).toBe(toCollisionKey(logicalKey));
          }
        }

        const result = resolveMerge(contributions);

        // --- (1) GANADOR CORRECTO (AC 7.2) -----------------------------------
        // Mismo conjunto de claves que el oráculo.
        expect(new Set(result.winners.keys())).toEqual(new Set(oracle.keys()));
        for (const [key, addons] of oracle) {
          const expectedWinner = addons[addons.length - 1] as string;
          const resolved = result.winners.get(key);
          expect(resolved).toBeDefined();
          expect(resolved?.relativePath).toBe(key);
          expect(resolved?.winner).toBe(expectedWinner);
        }

        // --- (2) COLISIONES (AC 7.1) -----------------------------------------
        // Colisiones esperadas: claves con >= 2 contribuidores.
        const expectedCollisions = [...oracle.entries()].filter(
          ([, addons]) => addons.length >= 2,
        );
        // Mismo conjunto de paths en colisión (sin depender del orden todavía).
        expect(new Set(result.report.collisions.map((c) => c.relativePath))).toEqual(
          new Set(expectedCollisions.map(([key]) => key)),
        );
        // Por cada colisión: contributors en orden ascendente y winner = último.
        for (const collision of result.report.collisions) {
          const expectedContributors = oracle.get(collision.relativePath);
          expect(expectedContributors).toBeDefined();
          expect(collision.contributors).toEqual(expectedContributors);
          expect(collision.winner).toBe(
            expectedContributors?.[expectedContributors.length - 1],
          );
        }

        // --- (3) DETERMINISMO (AC 6.7) ---------------------------------------
        const again = resolveMerge(contributions);
        // Mismos winners, mismo orden de inserción.
        expect([...again.winners.entries()]).toEqual([...result.winners.entries()]);
        // Mismas colisiones, mismo orden.
        expect(again.report.collisions).toEqual(result.report.collisions);

        // --- Contadores de NO-VACUIDAD ---------------------------------------
        if (expectedCollisions.length > 0) withCollisionCount++;
        else withoutCollisionCount++;
        // Colisión donde AL MENOS dos contribuidores usaron variantes de
        // superficie que difieren en texto crudo pero colapsan a la misma clave.
        const hasMixedSurface = expectedCollisions.some(([key]) => {
          const rawVariants: string[] = [];
          for (const m of models) {
            for (let i = 0; i < m.logicalKeys.length; i++) {
              if (toCollisionKey(m.logicalKeys[i] as string) === key) {
                rawVariants.push(m.contribution.relativePaths[i] as string);
              }
            }
          }
          return new Set(rawVariants).size >= 2;
        });
        if (hasMixedSurface) mixedSurfaceCollisionCount++;

        return true;
      }),
      { numRuns: MIN_NUM_RUNS },
    );

    // NO-VACUIDAD: el conjunto generado ejercitó de verdad los tres escenarios.
    // Valores medidos ejecutando el test en 100 iteraciones (vía writeFileSync a
    // un archivo temporal, mismo método de medición que la Property 5):
    // withCollisionCount=69, withoutCollisionCount=31, mixedSurfaceCollisionCount=69.
    // Los tres holgadamente > 0:
    //  - withCollision: escenarios con >= 1 colisión real (misma clave en >= 2 addons).
    //  - withoutCollision: escenarios sin ninguna colisión (todos paths únicos).
    //  - mixedSurface: colisiones donde >= 2 contribuidores usaron variantes de
    //    superficie DISTINTAS (casing/separador) que colapsan a la misma clave.
    expect(withCollisionCount).toBeGreaterThan(0);
    expect(withoutCollisionCount).toBeGreaterThan(0);
    expect(mixedSurfaceCollisionCount).toBeGreaterThan(0);
  },
);
