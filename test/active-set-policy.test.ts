import { describe, expect, test } from "vitest";

import {
  isAllowedInActiveSet,
  isVScriptAddonAllowedInput,
} from "../src/main/domain/index.js";
import type { VScriptClassification } from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 8.1: política PURA de inclusión de addons en el
 * Active_Set (AC 3.6, 3.7, 3.8).
 *
 * Se ejercita `isAllowedInActiveSet` con los CUATRO combos de los dos booleanos
 * (`isVScriptAddon` × `forceConfirmed`), que cubren la tabla de verdad completa:
 *   - no-VScript ⇒ SIEMPRE permitido (sin importar el forzado).
 *   - VScript sin confirmación ⇒ BLOQUEADO (AC 3.7, bloqueo por defecto).
 *   - VScript con confirmación explícita ⇒ permitido (AC 3.8, forzado).
 *
 * NOTA: esto NO es el property test (Property 6); esa es la tarea 8.2 (commit
 * aparte). Aquí se fija el contrato con los ejemplos explícitos de la tabla.
 */

describe("isAllowedInActiveSet — tabla de verdad (AC 3.6, 3.7, 3.8)", () => {
  test("no-VScript + sin forzado ⇒ permitido (siempre)", () => {
    expect(isAllowedInActiveSet({ isVScriptAddon: false, forceConfirmed: false })).toBe(true);
  });

  test("no-VScript + con forzado ⇒ permitido (el forzado es irrelevante)", () => {
    expect(isAllowedInActiveSet({ isVScriptAddon: false, forceConfirmed: true })).toBe(true);
  });

  test("VScript + sin confirmación ⇒ BLOQUEADO por defecto (AC 3.7)", () => {
    expect(isAllowedInActiveSet({ isVScriptAddon: true, forceConfirmed: false })).toBe(false);
  });

  test("VScript + confirmación explícita ⇒ permitido por forzado (AC 3.8)", () => {
    expect(isAllowedInActiveSet({ isVScriptAddon: true, forceConfirmed: true })).toBe(true);
  });
});

describe("isVScriptAddonAllowedInput — mapeo desde VScriptClassification", () => {
  test("solo depende de isVScriptAddon, no del reason (nut-in-vscripts bloqueado por defecto)", () => {
    const classification: VScriptClassification = {
      addonId: "123",
      isVScriptAddon: true,
      reason: "nut-in-vscripts",
    };
    const input = isVScriptAddonAllowedInput(classification, false);
    expect(input).toEqual({ isVScriptAddon: true, forceConfirmed: false });
    expect(isAllowedInActiveSet(input)).toBe(false);
  });

  test("listing-failed también es VScript_Addon (bloqueado salvo forzado)", () => {
    const classification: VScriptClassification = {
      addonId: "456",
      isVScriptAddon: true,
      reason: "listing-failed",
    };
    expect(isAllowedInActiveSet(isVScriptAddonAllowedInput(classification, false))).toBe(false);
    expect(isAllowedInActiveSet(isVScriptAddonAllowedInput(classification, true))).toBe(true);
  });

  test("clean ⇒ permitido sin necesidad de forzar", () => {
    const classification: VScriptClassification = {
      addonId: "789",
      isVScriptAddon: false,
      reason: "clean",
    };
    expect(isAllowedInActiveSet(isVScriptAddonAllowedInput(classification, false))).toBe(true);
  });
});
