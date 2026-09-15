import { describe, expect, test } from "vitest";

import { filterAddons, matchesFilter, matchesQuery } from "./libraryFilter.js";
import type { ScannedAddon, VScriptClassification } from "../../main/domain/index.js";

function addon(id: string, title?: string, author?: string): ScannedAddon {
  const info: Record<string, string> = {};
  if (title !== undefined) info.title = title;
  if (author !== undefined) info.author = author;
  return {
    id,
    vpkPath: `C:\\workshop\\${id}.vpk`,
    coverPath: null,
    info: title !== undefined || author !== undefined ? info : null,
    mtimeMs: 0,
    sizeBytes: 0,
  };
}

function vscript(isVScriptAddon: boolean): VScriptClassification {
  return { addonId: "unused", isVScriptAddon, reason: isVScriptAddon ? "nut-in-vscripts" : "clean" };
}

describe("matchesQuery", () => {
  test("query vacia matchea todo", () => {
    expect(matchesQuery(addon("a", "Pilas de munición"), "")).toBe(true);
    expect(matchesQuery(addon("a", "Pilas de munición"), "   ")).toBe(true);
  });

  test("matchea por titulo, case-insensitive", () => {
    expect(matchesQuery(addon("a", "Pilas de Munición HD"), "MUNICIÓN")).toBe(true);
    expect(matchesQuery(addon("a", "Pilas de Munición HD"), "zzz")).toBe(false);
  });

  test("matchea por autor", () => {
    expect(matchesQuery(addon("a", "X", "Nordheim"), "nord")).toBe(true);
  });

  test("sin info.title, usa el id de fallback para buscar", () => {
    expect(matchesQuery(addon("abc123"), "abc")).toBe(true);
  });
});

describe("matchesFilter", () => {
  const activeIds = new Set(["a"]);

  test("'all' matchea siempre", () => {
    expect(matchesFilter("z", "pending", activeIds, "all")).toBe(true);
  });

  test("'active' matchea solo ids en activeIds", () => {
    expect(matchesFilter("a", "pending", activeIds, "active")).toBe(true);
    expect(matchesFilter("b", "pending", activeIds, "active")).toBe(false);
  });

  test("'compatible' requiere clasificacion resuelta y NO vscript", () => {
    expect(matchesFilter("a", vscript(false), activeIds, "compatible")).toBe(true);
    expect(matchesFilter("a", vscript(true), activeIds, "compatible")).toBe(false);
    expect(matchesFilter("a", "pending", activeIds, "compatible")).toBe(false);
  });

  test("'vscript' requiere clasificacion resuelta Y vscript", () => {
    expect(matchesFilter("a", vscript(true), activeIds, "vscript")).toBe(true);
    expect(matchesFilter("a", vscript(false), activeIds, "vscript")).toBe(false);
    expect(matchesFilter("a", "pending", activeIds, "vscript")).toBe(false);
  });
});

describe("filterAddons", () => {
  test("combina filtro de chip y busqueda de texto", () => {
    const addons = [addon("a", "Pilas de munición"), addon("b", "Brazos realistas")];
    const classifications = { a: vscript(false), b: vscript(true) };
    const activeIds = new Set<string>();

    expect(filterAddons(addons, classifications, activeIds, "all", "brazos").map((a) => a.id)).toEqual([
      "b",
    ]);
    expect(filterAddons(addons, classifications, activeIds, "vscript", "").map((a) => a.id)).toEqual([
      "b",
    ]);
    expect(filterAddons(addons, classifications, activeIds, "compatible", "").map((a) => a.id)).toEqual([
      "a",
    ]);
  });
});
