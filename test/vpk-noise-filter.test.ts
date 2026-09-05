import { describe, expect, test } from "vitest";

import {
  VPK_NOISE_PREFIXES,
  filterNoiseLines,
  filterVpkNoise,
  isVpkNoiseLine,
} from "../src/main/domain/index.js";

/**
 * Test unitario mínimo de la Tarea 2.1 (filtrado de ruido de `vpk.exe`, AC 6.2).
 *
 * NOTA: esto NO es el property test de la tarea 2.2 (Property 8). Es solo un
 * conjunto de ejemplos que fija las decisiones documentadas en
 * `vpk-noise-filter.ts` para evitar ambigüedad.
 */

describe("filterVpkNoise: descarta ruido y conserva el resto (AC 6.2)", () => {
  test("descarta líneas que comienzan con los prefijos de ruido", () => {
    const stdout = [
      "CDynamicFunction: algo",
      "materials/foo.vmt",
      "FS: bar",
      "scripts/vscripts/x.nut",
      "Using something",
      "sound/baz.wav",
    ].join("\n");

    expect(filterVpkNoise(stdout)).toEqual([
      "materials/foo.vmt",
      "scripts/vscripts/x.nut",
      "sound/baz.wav",
    ]);
  });

  test("soporta fin de línea Windows (\\r\\n) y no deja \\r colgante", () => {
    const stdout = "FS: ruido\r\nmaterials/a.vmt\r\nUsing z\r\nmodels/b.mdl\r\n";
    expect(filterVpkNoise(stdout)).toEqual(["materials/a.vmt", "models/b.mdl"]);
  });

  test("conserva líneas con espacios iniciales antes de un prefijo (sin trim)", () => {
    // "  FS: ..." NO comienza literalmente con "FS:", por lo tanto se conserva.
    const stdout = "  FS: no es ruido\nFS: sí es ruido\ncontenido/real.txt";
    expect(filterVpkNoise(stdout)).toEqual(["  FS: no es ruido", "contenido/real.txt"]);
  });

  test("la comparación de prefijos es sensible a mayúsculas", () => {
    const stdout = "fs: minuscula\nusing minuscula\ncdynamicfunction: minuscula";
    // Ninguna coincide con los prefijos exactos, así que se conservan todas.
    expect(filterVpkNoise(stdout)).toEqual([
      "fs: minuscula",
      "using minuscula",
      "cdynamicfunction: minuscula",
    ]);
  });

  test("conserva líneas vacías intermedias pero descarta la línea final vacía", () => {
    const stdout = "a/1.txt\n\nb/2.txt\n";
    expect(filterVpkNoise(stdout)).toEqual(["a/1.txt", "", "b/2.txt"]);
  });

  test("stdout vacío produce arreglo vacío", () => {
    expect(filterVpkNoise("")).toEqual([]);
  });
});

describe("helpers de bajo nivel", () => {
  test("isVpkNoiseLine detecta cada prefijo", () => {
    for (const prefix of VPK_NOISE_PREFIXES) {
      expect(isVpkNoiseLine(`${prefix} resto`)).toBe(true);
    }
    expect(isVpkNoiseLine("materials/ok.vmt")).toBe(false);
  });

  test("filterNoiseLines opera sobre string[] y normaliza \\r final", () => {
    expect(filterNoiseLines(["materials/a.vmt\r", "FS: x\r", "b.txt"])).toEqual([
      "materials/a.vmt",
      "b.txt",
    ]);
  });
});
