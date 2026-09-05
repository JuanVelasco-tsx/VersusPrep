import { describe, expect, test } from "vitest";
import fc from "fast-check";

import { MIN_NUM_RUNS, propertyName, propertyTest } from "./helpers/property.js";
import type {
  AddonManifestEntry,
  ElevationOutcome,
  GamePaths,
  OperationResult,
  ScannedAddon,
} from "../src/main/domain/index.js";

/**
 * Test de humo de la Tarea 1: confirma que Vitest + fast-check + el helper de
 * propiedades funcionan, que el naming es el exacto del spec y que los tipos de
 * dominio compartidos importan y se pueden usar.
 */

describe("Andamiaje: tipos de dominio importables", () => {
  test("las estructuras de dominio se pueden construir con las firmas esperadas", () => {
    const paths: GamePaths = {
      steamPath: "C:\\Program Files (x86)\\Steam",
      gameRoot: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Left 4 Dead 2",
      left4dead2Dir: "C:\\...\\Left 4 Dead 2\\left4dead2",
      workshopFolder: "C:\\...\\left4dead2\\addons\\workshop",
      vpkToolPath: "C:\\...\\Left 4 Dead 2\\bin\\vpk.exe",
      gameInfoFile: "C:\\...\\left4dead2\\gameinfo.txt",
      modsvsFolder: "C:\\...\\left4dead2\\modsvs",
    };

    const addon: ScannedAddon = {
      id: "123456",
      vpkPath: `${paths.workshopFolder}\\123456.vpk`,
      coverPath: null,
      info: null,
    };

    const manifest: AddonManifestEntry[] = [{ addonId: addon.id, priorityOrder: 0 }];

    const success: OperationResult = { ok: true, installedManifest: manifest };
    const failure: OperationResult = { ok: false, error: "algo falló", addonId: addon.id };
    const outcome: ElevationOutcome = { kind: "already-writable" };

    expect(addon.id).toBe("123456");
    expect(manifest[0]?.priorityOrder).toBe(0);
    expect(success.ok).toBe(true);
    expect(failure.ok).toBe(false);
    expect(outcome.kind).toBe("already-writable");
  });
});

describe("Andamiaje: convención de nombre de propiedad", () => {
  test("propertyName produce el string EXACTO del spec", () => {
    expect(propertyName(1, "Ejemplo")).toBe(
      "Feature: l4d2-versus-addon-manager, Property 1: Ejemplo",
    );
  });

  test("el mínimo de iteraciones es 100", () => {
    expect(MIN_NUM_RUNS).toBe(100);
  });
});

// Propiedad trivial registrada con el helper: confirma el wiring end-to-end
// (nombre canónico + numRuns >= 100). Property 0 es un placeholder de humo, no
// una de las 15 propiedades de corrección del diseño.
propertyTest(
  0,
  "Humo: la concatenación de arrays preserva la longitud total",
  fc.property(fc.array(fc.integer()), fc.array(fc.integer()), (a, b) => {
    return a.concat(b).length === a.length + b.length;
  }),
);
