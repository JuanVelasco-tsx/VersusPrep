import { describe, expect, test } from "vitest";

import {
  VPK_INTERNAL_SEPARATOR,
  DISK_SEPARATOR,
  internalPathToDiskPath,
} from "../src/main/domain/index.js";

/**
 * Test unitario mínimo de la Tarea 2.5 (traducción de separadores de path,
 * AC 6.6).
 *
 * NOTA: esto NO es el property test de la tarea 2.6 (Property 10). Es solo un
 * conjunto de ejemplos que fija el criterio central y los casos borde
 * documentados en `vpk-path.ts` para evitar ambigüedad.
 */

describe("internalPathToDiskPath: traduce `/` a `\\` (AC 6.6)", () => {
  test("caso típico: cada `/` se sustituye por `\\`", () => {
    expect(internalPathToDiskPath("materials/models/x.vmt")).toBe(
      "materials\\models\\x.vmt",
    );
  });

  test("path sin separadores queda intacto", () => {
    expect(internalPathToDiskPath("addoninfo.txt")).toBe("addoninfo.txt");
  });

  test("cadena vacía devuelve cadena vacía", () => {
    expect(internalPathToDiskPath("")).toBe("");
  });

  test("decisión 1: preserva un `\\` literal preexistente tal cual", () => {
    // El `\` no es separador interno del VPK; se trata como parte del nombre y
    // no se toca. El `/` sí se traduce.
    expect(internalPathToDiskPath("materials/we\\ird/x.vmt")).toBe(
      "materials\\we\\ird\\x.vmt",
    );
  });

  test("decisión 2: preserva el `/` inicial (lo traduce a `\\` sin recortar)", () => {
    expect(internalPathToDiskPath("/materials/x.vmt")).toBe(
      "\\materials\\x.vmt",
    );
  });

  test("decisión 3: preserva el separador final (trailing)", () => {
    expect(internalPathToDiskPath("materials/")).toBe("materials\\");
  });

  test("decisión 4: no colapsa separadores consecutivos (traducción 1:1)", () => {
    expect(internalPathToDiskPath("a//b")).toBe("a\\\\b");
  });

  test("criterio central: nº de `\\` de salida == nº de `/` de entrada", () => {
    const input = "/a//b/c/";
    const slashCount = input.split(VPK_INTERNAL_SEPARATOR).length - 1;
    const output = internalPathToDiskPath(input);
    const backslashCount = output.split(DISK_SEPARATOR).length - 1;
    expect(backslashCount).toBe(slashCount);
  });

  test("no muta la entrada: devuelve una nueva cadena", () => {
    const input = "materials/x.vmt";
    internalPathToDiskPath(input);
    // El path interno original permanece con `/` intacto.
    expect(input).toBe("materials/x.vmt");
  });
});
