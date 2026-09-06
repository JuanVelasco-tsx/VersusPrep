import { expect, test } from "vitest";
import fc from "fast-check";

import { isAllowedInActiveSet } from "../src/main/domain/index.js";
import { MIN_NUM_RUNS, propertyName } from "./helpers/property.js";

/**
 * Property test de la Tarea 8.2: política de inclusión del Active_Set.
 *
 * Feature: l4d2-versus-addon-manager, Property 6: Inclusión bloqueada de VScript_Addon salvo confirmación explícita
 * **Validates: Requirements 3.7, 3.8**
 *
 * La propiedad valida la FUNCIÓN PURA `isAllowedInActiveSet({ isVScriptAddon,
 * forceConfirmed })` contra un ORÁCULO independiente computado SIN llamar a la
 * función bajo prueba: `esperado = !isVScriptAddon || forceConfirmed` (la tabla
 * de verdad de los AC 3.7/3.8). Se generan ambos booleanos con `fc.boolean()`,
 * cubriendo los cuatro combos.
 *
 * ---------------------------------------------------------------------------
 * PATRÓN DE REGISTRO
 *
 * Se usa un `test()` propio (en vez del helper `propertyTest`) porque la
 * propiedad necesita ASERCIONES DE NO-VACUIDAD al final: verificar que los casos
 * generados ejercitaron de verdad el bloqueo por defecto (AC 3.7), el forzado
 * (AC 3.8) y el caso no-VScript, cosa que el helper no permite. Se importa
 * `propertyName(6, ...)` para el nombre canónico y `MIN_NUM_RUNS` (>= 100) para
 * las iteraciones. Los `expect(...).toBeGreaterThan(0)` van DESPUÉS del
 * `await fc.assert(...)`.
 * ---------------------------------------------------------------------------
 */

// Contadores de NO-VACUIDAD (afirmados > 0 tras el assert).
let blockedCount = 0;
let forcedCount = 0;
let nonVScriptCount = 0;

test(propertyName(6, "Inclusión bloqueada de VScript_Addon salvo confirmación explícita"), async () => {
  await fc.assert(
    fc.property(fc.boolean(), fc.boolean(), (isVScriptAddon, forceConfirmed) => {
      // ORÁCULO independiente (tabla de verdad, SIN llamar a la función bajo prueba).
      const expected = !isVScriptAddon || forceConfirmed;

      // Contadores de no-vacuidad.
      if (expected === false) blockedCount++; // VScript sin confirmación ⇒ bloqueado (AC 3.7).
      if (isVScriptAddon && forceConfirmed) forcedCount++; // permitido por forzado (AC 3.8).
      if (!isVScriptAddon) nonVScriptCount++; // permitido siempre.

      // Propiedad principal (AC 3.7, 3.8).
      expect(isAllowedInActiveSet({ isVScriptAddon, forceConfirmed })).toBe(expected);
    }),
    { numRuns: MIN_NUM_RUNS },
  );

  // NO-VACUIDAD: con dos booleanos equiprobables y 100 runs cada combo cae ~25
  // veces, así que las tres condiciones salen holgadas sin sesgo. Valores medidos
  // DIRECTAMENTE de este test (vía writeFileSync a un archivo, ver la nota de
  // proceso del 2026-09-06 en Context/04-historial-decisiones.md) en 100
  // iteraciones: blockedCount=20, forcedCount=32, nonVScriptCount=48. Los tres > 0.
  expect(blockedCount).toBeGreaterThan(0);
  expect(forcedCount).toBeGreaterThan(0);
  expect(nonVScriptCount).toBeGreaterThan(0);
});
