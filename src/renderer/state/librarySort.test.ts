import { describe, expect, test } from "vitest";

import { nextSortState, sortAddons } from "./librarySort.js";
import type { ClassificationLookup, SortState } from "./librarySort.js";
import type { ScannedAddon, VScriptClassification } from "../../main/domain/index.js";

function addon(
  id: string,
  overrides: Partial<Pick<ScannedAddon, "mtimeMs" | "sizeBytes">> & { title?: string } = {},
): ScannedAddon {
  return {
    id,
    vpkPath: `C:\\workshop\\${id}.vpk`,
    coverPath: null,
    info: overrides.title !== undefined ? { title: overrides.title } : null,
    mtimeMs: overrides.mtimeMs ?? 0,
    sizeBytes: overrides.sizeBytes ?? 0,
  };
}

function classification(clean: boolean): VScriptClassification {
  return clean
    ? { addonId: "unused", reason: "clean", isVScriptAddon: false }
    : { addonId: "unused", reason: "nut-in-vscripts", isVScriptAddon: true };
}

describe("nextSortState (P-31, Paso 2)", () => {
  test("desde null, clickear una columna la activa ascendente", () => {
    expect(nextSortState(null, "name")).toEqual<SortState>({ column: "name", direction: "asc" });
  });

  test("clickear la MISMA columna activa alterna la dirección", () => {
    const afterFirstClick = nextSortState(null, "size");
    expect(nextSortState(afterFirstClick, "size")).toEqual<SortState>({
      column: "size",
      direction: "desc",
    });
  });

  test("clickear una columna DISTINTA a la activa la reemplaza en ascendente", () => {
    const current: SortState = { column: "size", direction: "desc" };
    expect(nextSortState(current, "mtime")).toEqual<SortState>({
      column: "mtime",
      direction: "asc",
    });
  });
});

describe("sortAddons (P-31, Paso 2)", () => {
  test("sort null devuelve una COPIA en el orden de escaneo original (default)", () => {
    const addons = [addon("c"), addon("a"), addon("b")];
    const result = sortAddons(addons, {}, null);
    expect(result).not.toBe(addons);
    expect(result.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });

  test("no muta el array original", () => {
    const addons = [addon("b"), addon("a")];
    sortAddons(addons, {}, { column: "name", direction: "asc" });
    expect(addons.map((a) => a.id)).toEqual(["b", "a"]);
  });

  test("ordena por nombre (título o id de fallback), ascendente y descendente", () => {
    const addons = [addon("x1", { title: "Zeta" }), addon("x2", { title: "Alpha" }), addon("x3")];
    const asc = sortAddons(addons, {}, { column: "name", direction: "asc" });
    expect(asc.map((a) => a.id)).toEqual(["x2", "x3", "x1"]); // Alpha, x3 (fallback id), Zeta

    const desc = sortAddons(addons, {}, { column: "name", direction: "desc" });
    expect(desc.map((a) => a.id)).toEqual(["x1", "x3", "x2"]);
  });

  test("ordena por fecha de modificación (mtimeMs)", () => {
    const addons = [addon("old", { mtimeMs: 100 }), addon("new", { mtimeMs: 300 }), addon("mid", { mtimeMs: 200 })];
    const asc = sortAddons(addons, {}, { column: "mtime", direction: "asc" });
    expect(asc.map((a) => a.id)).toEqual(["old", "mid", "new"]);
  });

  test("ordena por tamaño (sizeBytes)", () => {
    const addons = [addon("big", { sizeBytes: 3000 }), addon("small", { sizeBytes: 100 })];
    const desc = sortAddons(addons, {}, { column: "size", direction: "desc" });
    expect(desc.map((a) => a.id)).toEqual(["big", "small"]);
  });

  test("ordena por tipo: Normal y VScript antes que pending (sin clasificación resuelta)", () => {
    const addons = [addon("vscript"), addon("pending"), addon("normal")];
    const classifications: ClassificationLookup = {
      vscript: classification(false),
      normal: classification(true),
      // "pending" queda sin entrada -> lookup con "pending" por defecto (ver AddonList.tsx)
    };
    const asc = sortAddons(addons, classifications, { column: "type", direction: "asc" });
    expect(asc.map((a) => a.id)).toEqual(["normal", "vscript", "pending"]);
  });

  test("empates conservan el orden relativo original (sort estable)", () => {
    const addons = [addon("a", { sizeBytes: 10 }), addon("b", { sizeBytes: 10 }), addon("c", { sizeBytes: 5 })];
    const asc = sortAddons(addons, {}, { column: "size", direction: "asc" });
    expect(asc.map((a) => a.id)).toEqual(["c", "a", "b"]);
  });
});
