import { test } from "vitest";
import fc from "fast-check";

/**
 * Helper de property-based testing para el L4D2 Versus Addon Manager.
 *
 * Objetivos (Tarea 1):
 * 1. Fijar un mínimo de 100 iteraciones (`numRuns`) por propiedad, por defecto.
 * 2. Imponer la convención de nombre de propiedad EXACTA del spec:
 *      `Feature: l4d2-versus-addon-manager, Property N: <título>`
 *
 * Uso típico (una propiedad = un test):
 *
 * ```ts
 * import fc from "fast-check";
 * import { propertyTest } from "../helpers/property.js";
 *
 * propertyTest(
 *   8,
 *   "Filtrado del ruido de la VPK_Tool",
 *   fc.property(fc.array(fc.string()), (lines) => {
 *     // ... aserciones que deben cumplirse para TODA entrada generada
 *   })
 * );
 * ```
 *
 * Notas:
 * - `numRuns` tiene un piso de 100: si se pasa un valor menor se eleva a 100.
 * - `propertyName(n, title)` está expuesto por si se quiere el string exacto
 *   sin registrar un test (p. ej. para aserciones de metadatos).
 */

/** Mínimo obligatorio de iteraciones por propiedad. */
export const MIN_NUM_RUNS = 100;

/** Prefijo de feature usado en el nombre de toda propiedad de este spec. */
export const FEATURE_NAME = "l4d2-versus-addon-manager";

/**
 * Construye el nombre EXACTO de una propiedad según la convención del spec:
 * `Feature: l4d2-versus-addon-manager, Property N: <título>`.
 */
export function propertyName(propertyNumber: number, title: string): string {
  return `Feature: ${FEATURE_NAME}, Property ${propertyNumber}: ${title}`;
}

/**
 * Registra un test de Vitest que ejecuta una propiedad de fast-check con el
 * nombre canónico y un mínimo de 100 iteraciones.
 *
 * @param propertyNumber Número de propiedad del diseño (1..16; la 16 es una
 *   adición posterior fuera del scope original, ver `Context/04-historial-decisiones.md`).
 * @param title Título legible de la propiedad.
 * @param property La `IProperty`/`IAsyncProperty` construida con `fc.property`/`fc.asyncProperty`.
 * @param params Parámetros opcionales de `fc.assert`; `numRuns` se eleva a >= 100.
 */
export function propertyTest(
  propertyNumber: number,
  title: string,
  property: fc.IPropertyWithHooks<unknown> | fc.IAsyncPropertyWithHooks<unknown>,
  params: fc.Parameters<unknown> = {},
): void {
  const numRuns = Math.max(params.numRuns ?? MIN_NUM_RUNS, MIN_NUM_RUNS);
  test(propertyName(propertyNumber, title), () => {
    fc.assert(property as fc.IPropertyWithHooks<unknown>, { ...params, numRuns });
  });
}
