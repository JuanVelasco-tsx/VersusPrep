import { describe, expect, test } from "vitest";

import { applySelectionClick } from "./librarySelection.js";

const visibleIds = ["a", "b", "c", "d", "e"];

describe("applySelectionClick (P-22, Paso 2)", () => {
  test("click simple agrega el id clickeado y lo fija como anchor", () => {
    const result = applySelectionClick(new Set(), null, visibleIds, "b", true, false);
    expect([...result.selected]).toEqual(["b"]);
    expect(result.anchor).toBe("b");
  });

  test("click simple para deseleccionar quita el id sin tocar el resto", () => {
    const current = new Set(["a", "b", "c"]);
    const result = applySelectionClick(current, "a", visibleIds, "b", false, false);
    expect([...result.selected].sort()).toEqual(["a", "c"]);
    expect(result.anchor).toBe("b");
  });

  test("shift+click sin anchor previo degrada a click simple", () => {
    const result = applySelectionClick(new Set(), null, visibleIds, "c", true, true);
    expect([...result.selected]).toEqual(["c"]);
    expect(result.anchor).toBe("c");
  });

  test("shift+click marca el rango completo entre anchor y el clickeado (hacia adelante)", () => {
    const result = applySelectionClick(new Set(), "b", visibleIds, "d", true, true);
    expect([...result.selected].sort()).toEqual(["b", "c", "d"]);
    expect(result.anchor).toBe("b"); // el anchor NO se mueve
  });

  test("shift+click marca el rango completo entre anchor y el clickeado (hacia atrás)", () => {
    const result = applySelectionClick(new Set(), "d", visibleIds, "b", true, true);
    expect([...result.selected].sort()).toEqual(["b", "c", "d"]);
    expect(result.anchor).toBe("d");
  });

  test("shift+click se SUMA a la selección previa fuera del rango, no la reemplaza", () => {
    const current = new Set(["e"]);
    const result = applySelectionClick(current, "a", visibleIds, "b", true, true);
    expect([...result.selected].sort()).toEqual(["a", "b", "e"]);
  });

  test("shift+click con checked=false DESmarca todo el rango", () => {
    const current = new Set(["a", "b", "c", "d", "e"]);
    const result = applySelectionClick(current, "b", visibleIds, "d", false, true);
    expect([...result.selected].sort()).toEqual(["a", "e"]);
  });

  test("shift+click con anchor ya no presente en visibleIds (ordenamiento/filtro cambió) degrada a click simple", () => {
    const result = applySelectionClick(new Set(), "zzz", visibleIds, "c", true, true);
    expect([...result.selected]).toEqual(["c"]);
    expect(result.anchor).toBe("c");
  });
});
