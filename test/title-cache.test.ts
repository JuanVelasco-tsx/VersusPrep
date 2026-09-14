import { describe, expect, test } from "vitest";

import { TitleCache } from "../src/main/domain/index.js";
import type { ScannedAddon } from "../src/main/domain/index.js";

function addon(id: string, title?: string): ScannedAddon {
  return {
    id,
    vpkPath: id + ".vpk",
    coverPath: null,
    info: title === undefined ? null : { title },
    mtimeMs: 0,
    sizeBytes: 0,
  };
}

/**
 * Tests del TitleCache (BUG-001): cache en memoria id->titulo poblado por el
 * escaneo, con fallback (undefined) cuando el id no se conoce.
 */
describe("TitleCache", () => {
  test("get devuelve undefined antes de poblar (fallback a id crudo)", () => {
    const cache = new TitleCache();
    expect(cache.get("111")).toBeUndefined();
  });

  test("setMany cachea solo los addons CON titulo no vacio", () => {
    const cache = new TitleCache();
    cache.setMany([addon("111", "Mapa"), addon("222"), addon("333", "")]);
    expect(cache.get("111")).toBe("Mapa");
    expect(cache.get("222")).toBeUndefined(); // info null -> no cacheado
    expect(cache.get("333")).toBeUndefined(); // titulo vacio -> no cacheado
  });

  test("un setMany posterior refresca/agrega sin borrar lo previo no re-listado", () => {
    const cache = new TitleCache();
    cache.setMany([addon("111", "Viejo")]);
    cache.setMany([addon("111", "Nuevo"), addon("222", "Otro")]);
    expect(cache.get("111")).toBe("Nuevo"); // refrescado
    expect(cache.get("222")).toBe("Otro"); // agregado
  });

  test("snapshot devuelve un objeto plano de los titulos conocidos", () => {
    const cache = new TitleCache();
    cache.setMany([addon("111", "A"), addon("222", "B"), addon("333")]);
    expect(cache.snapshot()).toEqual({ "111": "A", "222": "B" });
  });
});
