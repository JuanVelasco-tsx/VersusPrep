import { describe, expect, test } from "vitest";

import { isPresetActivationEvent } from "./presetActivation.js";
import type { OperationEvent } from "../components/OperationOverlay.js";

describe("isPresetActivationEvent (bug post P-30 Paso 5: refresco tras cambiar/crear preset)", () => {
  test("true para un switch exitoso (dropdown de PresetSwitcher)", () => {
    const event: OperationEvent = { type: "result", kind: "switch", result: { status: "success" } };
    expect(isPresetActivationEvent(event)).toBe(true);
  });

  test("true para el switch encadenado de 'Nuevo preset' (mismo kind: switch)", () => {
    const event: OperationEvent = { type: "result", kind: "switch", result: { status: "success" } };
    expect(isPresetActivationEvent(event)).toBe(true);
  });

  test("false para un switch fallido: no hay nada nuevo que reflejar", () => {
    const event: OperationEvent = {
      type: "result",
      kind: "switch",
      result: { status: "failure", error: "boom" },
    };
    expect(isPresetActivationEvent(event)).toBe(false);
  });

  test("false para un switch que dispara elevación UAC: la app está por reiniciar", () => {
    const event: OperationEvent = { type: "result", kind: "switch", result: { status: "elevating" } };
    expect(isPresetActivationEvent(event)).toBe(false);
  });

  test("false para un 'start' de switch (todavía no terminó)", () => {
    const event: OperationEvent = { type: "start", kind: "switch" };
    expect(isPresetActivationEvent(event)).toBe(false);
  });

  test("false para apply/add/remove exitosos: NO deben disparar este refetch (desacople deliberado de Biblioteca/Activos)", () => {
    for (const kind of ["apply", "add", "remove"] as const) {
      const event: OperationEvent = { type: "result", kind, result: { status: "success" } };
      expect(isPresetActivationEvent(event)).toBe(false);
    }
  });
});
