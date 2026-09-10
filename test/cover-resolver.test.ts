import { describe, expect, test } from "vitest";

import {
  isValidCoverId,
  isWithinBase,
  resolveCoverPath,
} from "../src/main/domain/cover-resolver.js";
import type { CoverFileExists } from "../src/main/domain/cover-resolver.js";

/**
 * Tests del Cover_Resolver (Tarea 21.1, Bloque 1). Cubren la logica PURA de
 * validacion del id (capa 1), contencion en la Workshop_Folder (capa 2) y la
 * resolucion completa con un `fileExists` inyectado (sin Electron ni disco
 * real). El wiring de protocol.handle en main.ts no se testea aca (requiere
 * runtime de Electron); esta suite valida la decision de QUE path servir o por
 * que rechazar.
 */

const WORKSHOP = "C:\\Steam\\steamapps\\workshop\\content\\550";

/** fileExists que dice "existe todo". */
const existsAll: CoverFileExists = async () => true;
/** fileExists que dice "no existe nada". */
const existsNone: CoverFileExists = async () => false;

// ---------------------------------------------------------------------------
// isValidCoverId (capa 1: validacion por patron)
// ---------------------------------------------------------------------------

describe("isValidCoverId", () => {
  test("acepta ids numericos (caso tipico de Workshop)", () => {
    expect(isValidCoverId("123456789")).toBe(true);
  });

  test("acepta alfanumerico con guion y guion bajo (no asume numerico)", () => {
    expect(isValidCoverId("abc-123_XY")).toBe(true);
  });

  test.each([
    ["vacio", ""],
    ["con barra", "12/34"],
    ["con backslash", "12\\34"],
    ["dot-dot", ".."],
    ["traversal", "..\\..\\windows\\system32"],
    ["con punto (extension embebida)", "123.jpg"],
    ["con espacio", "12 34"],
    ["con dos puntos de unidad", "C:"],
  ])("rechaza id invalido: %s", (_label, id) => {
    expect(isValidCoverId(id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isWithinBase (capa 2: contencion)
// ---------------------------------------------------------------------------

describe("isWithinBase", () => {
  test("un archivo directamente bajo la base esta dentro", () => {
    expect(isWithinBase(WORKSHOP, WORKSHOP + "\\123.jpg")).toBe(true);
  });

  test("la propia base cuenta como dentro", () => {
    expect(isWithinBase(WORKSHOP, WORKSHOP)).toBe(true);
  });

  test("un hermano con prefijo comun NO esta dentro (evita match por prefijo crudo)", () => {
    // C:\\...\\550-evil no debe matchear contra base C:\\...\\550
    expect(isWithinBase(WORKSHOP, WORKSHOP + "-evil\\x.jpg")).toBe(false);
  });

  test("un path que sube fuera de la base NO esta dentro", () => {
    expect(isWithinBase(WORKSHOP, WORKSHOP + "\\..\\..\\secret.jpg")).toBe(false);
  });

  test("comparacion case-insensitive (FS de Windows)", () => {
    expect(isWithinBase(WORKSHOP, WORKSHOP.toLowerCase() + "\\123.jpg")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveCoverPath (flujo completo con fileExists inyectado)
// ---------------------------------------------------------------------------

describe("resolveCoverPath", () => {
  test("id valido + archivo existente -> ok con path absoluto <id>.jpg", async () => {
    const res = await resolveCoverPath("123456789", WORKSHOP, existsAll);
    expect(res).toEqual({ ok: true, absolutePath: WORKSHOP + "\\123456789.jpg" });
  });

  test("workshopFolder null -> paths-not-detected (mismo gate que scanAddons)", async () => {
    const res = await resolveCoverPath("123", null, existsAll);
    expect(res).toEqual({ ok: false, reason: "paths-not-detected" });
  });

  test("id invalido -> invalid-id, SIN tocar disco", async () => {
    let called = false;
    const spy: CoverFileExists = async () => {
      called = true;
      return true;
    };
    const res = await resolveCoverPath("..\\evil", WORKSHOP, spy);
    expect(res).toEqual({ ok: false, reason: "invalid-id" });
    expect(called).toBe(false);
  });

  test("id valido pero archivo ausente -> not-found", async () => {
    const res = await resolveCoverPath("123", WORKSHOP, existsNone);
    expect(res).toEqual({ ok: false, reason: "not-found" });
  });

  test("el archivo consultado es exactamente <workshopFolder>\\<id>.jpg", async () => {
    let queried = "";
    const spy: CoverFileExists = async (abs) => {
      queried = abs;
      return true;
    };
    await resolveCoverPath("777", WORKSHOP, spy);
    expect(queried).toBe(WORKSHOP + "\\777.jpg");
  });
});
