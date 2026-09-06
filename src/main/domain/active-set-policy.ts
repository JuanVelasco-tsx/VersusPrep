/**
 * Política de inclusión de addons en el Active_Set (Requirement 3; AC 3.6, 3.7,
 * 3.8).
 *
 * Este módulo concentra la DECISIÓN PURA de si un Addon puede formar parte del
 * Active_Set en función de su clasificación anti-VScript y de si el usuario
 * otorgó una confirmación explícita para forzar su inclusión. No hace I/O ni
 * mantiene estado: es una función determinista sobre dos booleanos, apta para
 * property testing (tarea 8.2, Property 6).
 *
 * ---------------------------------------------------------------------------
 * ALCANCE (qué decide y qué NO decide este módulo)
 *
 * - AC 3.6: cuando un Addon está clasificado como VScript_Addon, el Manager debe
 *   ADVERTIR al usuario que es incompatible con Versus_Mode. Esa ADVERTENCIA
 *   VISUAL es responsabilidad de la UI (capa renderer, tarea 21), NO de esta
 *   política. Acá solo se decide la INCLUSIÓN; la política contempla el 3.6 de
 *   forma indirecta (el bloqueo por defecto del 3.7 es lo que la advertencia
 *   acompaña), pero no emite ningún mensaje.
 * - AC 3.7: si el usuario intenta incluir un VScript_Addon en el Active_Set, se
 *   BLOQUEA la inclusión POR DEFECTO (sin confirmación de forzado).
 * - AC 3.8: si el usuario otorga confirmación EXPLÍCITA para forzar la inclusión
 *   de un VScript_Addon, ese Addon SÍ se incorpora al Active_Set.
 *
 * ---------------------------------------------------------------------------
 * TABLA DE VERDAD (la lógica completa se reduce a esto)
 *
 *   isVScriptAddon | forceConfirmed | permitido | AC
 *   ---------------+----------------+-----------+-----
 *   false          | false          | true      | no-VScript ⇒ siempre permitido
 *   false          | true           | true      | no-VScript ⇒ siempre permitido
 *   true           | false          | false     | 3.7 (bloqueo por defecto)
 *   true           | true           | true      | 3.8 (forzado explícito)
 *
 * Equivale a: `permitido = !isVScriptAddon || forceConfirmed`.
 *
 * DECISIÓN DE FORMA (documentada): el input se modela como un objeto de dos
 * booleanos (`{ isVScriptAddon, forceConfirmed }`) en vez de tomar el
 * `VScriptClassification` completo. Motivo: la política SOLO depende del flag
 * `isVScriptAddon` (no del `reason`), así que exigir la clasificación entera
 * acoplaría innecesariamente esta función pura a la forma del detector. El
 * llamador (orquestador/IPC) extrae `classification.isVScriptAddon` y arma el
 * input. Ver {@link isVScriptAddonAllowedInput} para el mapeo desde un
 * `VScriptClassification`.
 * ---------------------------------------------------------------------------
 */

import type { VScriptClassification } from "./types.js";

/**
 * Entrada de la política de inclusión: los dos únicos datos que determinan la
 * decisión.
 */
export interface ActiveSetInclusionInput {
  /** `true` si el Addon fue clasificado como VScript_Addon (ver VScriptDetector). */
  readonly isVScriptAddon: boolean;
  /**
   * `true` si el usuario otorgó una confirmación EXPLÍCITA para forzar la
   * inclusión de un VScript_Addon (AC 3.8). Irrelevante si `isVScriptAddon` es
   * `false` (un Addon apto se incluye igual sin necesidad de forzar).
   */
  readonly forceConfirmed: boolean;
}

/**
 * Decide si un Addon puede formar parte del Active_Set (AC 3.6, 3.7, 3.8).
 *
 * Función PURA (sin I/O ni estado). La lógica es exactamente la tabla de verdad
 * del encabezado del módulo:
 *   - `isVScriptAddon = false` ⇒ SIEMPRE permitido (`true`), sin importar
 *     `forceConfirmed`.
 *   - `isVScriptAddon = true` y `forceConfirmed = true` ⇒ permitido (`true`),
 *     por forzado explícito (AC 3.8).
 *   - `isVScriptAddon = true` y `forceConfirmed = false` ⇒ BLOQUEADO (`false`),
 *     por bloqueo por defecto (AC 3.7).
 *
 * @param input Clasificación VScript + confirmación de forzado.
 * @returns `true` si el Addon se incluye en el Active_Set; `false` si se bloquea.
 */
export function isAllowedInActiveSet(input: ActiveSetInclusionInput): boolean {
  return !input.isVScriptAddon || input.forceConfirmed;
}

/**
 * Helper de conveniencia: arma el {@link ActiveSetInclusionInput} a partir de un
 * `VScriptClassification` (del VScriptDetector) y del flag de confirmación de
 * forzado del usuario.
 *
 * Documenta explícitamente que la política SOLO usa `classification.isVScriptAddon`
 * y NO el `classification.reason` (el motivo `nut-in-vscripts` / `listing-failed`
 * es irrelevante para la inclusión: ambos son VScript_Addon a efectos del bloqueo
 * por defecto del AC 3.7).
 *
 * @param classification Clasificación anti-VScript del Addon.
 * @param forceConfirmed Confirmación explícita del usuario para forzar (AC 3.8).
 */
export function isVScriptAddonAllowedInput(
  classification: VScriptClassification,
  forceConfirmed: boolean,
): ActiveSetInclusionInput {
  return { isVScriptAddon: classification.isVScriptAddon, forceConfirmed };
}
