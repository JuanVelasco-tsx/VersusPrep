import { describe, expect, test } from "vitest";

import { mergePendingIntoActive, resolveActiveSetEntries } from "./pendingSelection.js";
import type { AddonManifestEntry } from "../../main/domain/index.js";

function entry(addonId: string, priorityOrder: number): AddonManifestEntry {
  return { addonId, priorityOrder };
}

describe("resolveActiveSetEntries (BUG-007)", () => {
  test("sin candidato pendiente (null), devuelve el Active_Set instalado tal cual", () => {
    const activeSet = [entry("a", 0), entry("b", 1)];
    expect(resolveActiveSetEntries(activeSet, null)).toBe(activeSet);
  });

  test("con candidato pendiente, tiene precedencia total sobre el instalado", () => {
    const activeSet = [entry("a", 0)];
    const pending = [entry("b", 0), entry("c", 1)];
    expect(resolveActiveSetEntries(activeSet, pending)).toBe(pending);
  });

  test("un candidato pendiente vacio ([]) gana igual (sesion activa, seleccion vacia)", () => {
    const activeSet = [entry("a", 0)];
    expect(resolveActiveSetEntries(activeSet, [])).toEqual([]);
  });
});

describe("mergePendingIntoActive (BUG-013)", () => {
  test("sin candidato pendiente (null), devuelve el Active_Set instalado tal cual", () => {
    const activeSet = [entry("a", 0)];
    expect(mergePendingIntoActive(activeSet, null)).toBe(activeSet);
  });

  test("une por addonId: agrega los addons pendientes que no estaban instalados", () => {
    const activeSet = [entry("a", 0)];
    const pending = [entry("a", 0), entry("b", 1)];
    const result = mergePendingIntoActive(activeSet, pending);
    expect(result.map((e) => e.addonId).sort()).toEqual(["a", "b"]);
  });

  test("en overlap, el priorityOrder del candidato pendiente gana sobre el instalado", () => {
    const activeSet = [entry("a", 5)];
    const pending = [entry("a", 99)];
    const result = mergePendingIntoActive(activeSet, pending);
    expect(result).toEqual([entry("a", 99)]);
  });

  test("candidato pendiente vacio ([]) no agrega nada, pero sigue devolviendo lo instalado", () => {
    const activeSet = [entry("a", 0)];
    expect(mergePendingIntoActive(activeSet, [])).toEqual([entry("a", 0)]);
  });
});
