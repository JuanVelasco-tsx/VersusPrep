import { describe, expect, test } from "vitest";

import {
  buildCollisionSummaries,
  entriesEqualByOrder,
  sortedByPriority,
  swap,
  withSequentialPriority,
} from "./activeSetEntries.js";
import type { ActiveSetPreview, AddonManifestEntry } from "../../main/domain/index.js";

function entry(addonId: string, priorityOrder: number): AddonManifestEntry {
  return { addonId, priorityOrder };
}

describe("withSequentialPriority", () => {
  test("renumera a la posicion en el array, preservando el orden", () => {
    const entries = [entry("c", 99), entry("a", 5), entry("b", 42)];
    expect(withSequentialPriority(entries)).toEqual([entry("c", 0), entry("a", 1), entry("b", 2)]);
  });
});

describe("sortedByPriority", () => {
  test("ordena ascendente por priorityOrder, sin mutar el original", () => {
    const entries = [entry("b", 2), entry("a", 1), entry("c", 3)];
    const result = sortedByPriority(entries);
    expect(result.map((e) => e.addonId)).toEqual(["a", "b", "c"]);
    expect(entries.map((e) => e.addonId)).toEqual(["b", "a", "c"]);
  });
});

describe("swap", () => {
  test("intercambia dos posiciones", () => {
    const entries = [entry("a", 0), entry("b", 1), entry("c", 2)];
    expect(swap(entries, 0, 2).map((e) => e.addonId)).toEqual(["c", "b", "a"]);
  });

  test("indices fuera de rango devuelven el array tal cual", () => {
    const entries = [entry("a", 0), entry("b", 1)];
    expect(swap(entries, 0, 5)).toBe(entries);
  });
});

describe("entriesEqualByOrder", () => {
  test("true para el mismo array (misma referencia)", () => {
    const entries = [entry("a", 0), entry("b", 1)];
    expect(entriesEqualByOrder(entries, entries)).toBe(true);
  });

  test("true si los ids coinciden en el mismo orden (priorityOrder ignorado)", () => {
    expect(entriesEqualByOrder([entry("a", 0), entry("b", 1)], [entry("a", 99), entry("b", 100)])).toBe(
      true,
    );
  });

  test("false si difiere el orden", () => {
    expect(entriesEqualByOrder([entry("a", 0), entry("b", 1)], [entry("b", 0), entry("a", 1)])).toBe(false);
  });

  test("false si difiere la longitud", () => {
    expect(entriesEqualByOrder([entry("a", 0)], [entry("a", 0), entry("b", 1)])).toBe(false);
  });

  test("true para dos arrays vacios", () => {
    expect(entriesEqualByOrder([], [])).toBe(true);
  });
});

describe("buildCollisionSummaries", () => {
  test("vacio si preview es null", () => {
    expect(buildCollisionSummaries(null, [entry("a", 0)])).toEqual({});
  });

  test("vacio si preview.kind no es 'ready'", () => {
    const preview: ActiveSetPreview = { kind: "addon-missing", addonId: "a" };
    expect(buildCollisionSummaries(preview, [entry("a", 0)])).toEqual({});
  });

  test("cuenta wins/losses por addonId a partir de winner/contributors", () => {
    const preview: ActiveSetPreview = {
      kind: "ready",
      fileCount: 2,
      unavailable: [],
      report: {
        collisions: [
          { relativePath: "a.vmt", contributors: ["a", "b"], winner: "b" },
          { relativePath: "c.vmt", contributors: ["a", "c"], winner: "a" },
        ],
      },
    };
    const summaries = buildCollisionSummaries(preview, [entry("a", 0), entry("b", 1), entry("c", 2)]);
    expect(summaries).toEqual({
      a: { wins: 1, losses: 1 },
      b: { wins: 1, losses: 0 },
      c: { wins: 0, losses: 1 },
    });
  });

  test("un addon sin ninguna colision queda en {wins:0, losses:0}", () => {
    const preview: ActiveSetPreview = {
      kind: "ready",
      fileCount: 1,
      unavailable: [],
      report: { collisions: [] },
    };
    expect(buildCollisionSummaries(preview, [entry("a", 0)])).toEqual({ a: { wins: 0, losses: 0 } });
  });
});
