import { describe, expect, test } from "vitest";

import {
  VScriptDetector,
  VpkTool,
  classifyVScriptPaths,
  isVScriptPath,
} from "../src/main/domain/index.js";
import type { CommandResult, CommandRunner, ScannedAddon } from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 7.1: clasificación VScript a partir del listado REAL
 * del VPK (AC 3.1, 3.2, 3.3, 3.4, 3.5).
 *
 * Se ejercita el `VScriptDetector` completo (orquestación) construyendo un
 * `VpkTool` REAL sobre un `CommandRunner` MOCKEADO en memoria (mismo patrón que
 * `test/vpk-tool.test.ts`), de modo que la ruta de éxito/fallo de `vpk l` sea
 * la de producción (incluida la conversión de exit ≠ 0 en `VpkToolError`) sin
 * tocar `vpk.exe` real. Además se testea el NÚCLEO PURO (`classifyVScriptPaths`)
 * de forma aislada con arrays de paths.
 *
 * NOTA: esto NO es el property test (Property 5); esa es la tarea 7.2 (commit
 * aparte). Aquí se fija el contrato con ejemplos y casos borde.
 */

// ---------------------------------------------------------------------------
// Mock de CommandRunner: `vpk l <vpk>` devuelve el stdout configurado, o exit ≠ 0.
// ---------------------------------------------------------------------------

/**
 * `CommandRunner` mockeado. Devuelve un `CommandResult` configurable en la
 * construcción. Sirve tanto para éxito (`exitCode: 0` + stdout con paths) como
 * para el fallo de `vpk l` (`exitCode` ≠ 0, que `VpkTool.list` convierte en
 * `VpkToolError`).
 */
class StubCommandRunner implements CommandRunner {
  #result: CommandResult;

  constructor(result: CommandResult) {
    this.#result = result;
  }

  run(): Promise<CommandResult> {
    return Promise.resolve(this.#result);
  }
}

const VPK_EXE = "C:\\game\\bin\\vpk.exe";

/** Construye un `VScriptDetector` cuyo `vpk l` devuelve el `stdout` dado (exit 0). */
function detectorForListing(stdout: string): VScriptDetector {
  const runner = new StubCommandRunner({ exitCode: 0, stdout, stderr: "" });
  return new VScriptDetector(new VpkTool(runner, VPK_EXE));
}

/** Construye un `VScriptDetector` cuyo `vpk l` FALLA con el exit dado (≠ 0). */
function detectorForFailure(exitCode: number, stderr = "boom"): VScriptDetector {
  const runner = new StubCommandRunner({ exitCode, stdout: "", stderr });
  return new VScriptDetector(new VpkTool(runner, VPK_EXE));
}

/** Un `ScannedAddon` mínimo; solo `id` y `vpkPath` se usan en la clasificación. */
function addon(id: string, overrides: Partial<ScannedAddon> = {}): ScannedAddon {
  return {
    id,
    vpkPath: `workshop/${id}.vpk`,
    coverPath: null,
    info: null,
    ...overrides,
  };
}

/** Une paths en un stdout como el que produce `vpk l` (una línea por path). */
const listing = (...paths: string[]): string => paths.join("\n");

// ---------------------------------------------------------------------------
// AC 3.2: un `.nut` bajo `scripts/vscripts/` ⇒ VScript_Addon (nut-in-vscripts).
// ---------------------------------------------------------------------------

describe("VScriptDetector.classify: `.nut` bajo scripts/vscripts/ ⇒ VScript_Addon (AC 3.2)", () => {
  test("path directo `scripts/vscripts/foo.nut`", async () => {
    const detector = detectorForListing(listing("materials/a.vmt", "scripts/vscripts/foo.nut"));

    const result = await detector.classify(addon("111"));

    expect(result).toEqual({
      addonId: "111",
      isVScriptAddon: true,
      reason: "nut-in-vscripts",
    });
  });

  test("subdirectorio más profundo `scripts/vscripts/ai/bar.nut` cuenta", async () => {
    const detector = detectorForListing(listing("scripts/vscripts/ai/bar.nut"));

    const result = await detector.classify(addon("222"));

    expect(result.isVScriptAddon).toBe(true);
    expect(result.reason).toBe("nut-in-vscripts");
  });

  test("variaciones de mayúsculas en prefijo y extensión `Scripts/VScripts/Foo.NUT`", async () => {
    const detector = detectorForListing(listing("Scripts/VScripts/Foo.NUT"));

    const result = await detector.classify(addon("333"));

    expect(result.isVScriptAddon).toBe(true);
    expect(result.reason).toBe("nut-in-vscripts");
  });
});

// ---------------------------------------------------------------------------
// AC 3.3: `.nut` FUERA del prefijo NO cuenta ⇒ clean.
// ---------------------------------------------------------------------------

describe("VScriptDetector.classify: `.nut` fuera de scripts/vscripts/ NO cuenta (AC 3.3)", () => {
  test("`scripts/foo.nut` (falta vscripts/) ⇒ clean", async () => {
    const detector = detectorForListing(listing("scripts/foo.nut"));

    const result = await detector.classify(addon("444"));

    expect(result).toEqual({ addonId: "444", isVScriptAddon: false, reason: "clean" });
  });

  test("`materials/vscripts/foo.nut` (prefijo distinto) ⇒ clean", async () => {
    const detector = detectorForListing(listing("materials/vscripts/foo.nut"));

    const result = await detector.classify(addon("555"));

    expect(result.isVScriptAddon).toBe(false);
    expect(result.reason).toBe("clean");
  });

  test("`vscripts/foo.nut` (sin scripts/ delante) ⇒ clean", async () => {
    const detector = detectorForListing(listing("vscripts/foo.nut"));

    const result = await detector.classify(addon("666"));

    expect(result.isVScriptAddon).toBe(false);
    expect(result.reason).toBe("clean");
  });
});

// ---------------------------------------------------------------------------
// Mezcla: un `.nut` fuera Y uno dentro ⇒ VScript (basta uno dentro).
// ---------------------------------------------------------------------------

describe("VScriptDetector.classify: basta un `.nut` bajo el prefijo (AC 3.2 vs 3.3)", () => {
  test("mezcla de `.nut` fuera y dentro ⇒ VScript_Addon", async () => {
    const detector = detectorForListing(
      listing("scripts/foo.nut", "materials/vscripts/x.nut", "scripts/vscripts/valido.nut"),
    );

    const result = await detector.classify(addon("777"));

    expect(result.isVScriptAddon).toBe(true);
    expect(result.reason).toBe("nut-in-vscripts");
  });
});

// ---------------------------------------------------------------------------
// Sin ningún `.nut`, o `.nut` solo fuera ⇒ clean.
// ---------------------------------------------------------------------------

describe("VScriptDetector.classify: sin `.nut` bajo el prefijo ⇒ clean", () => {
  test("addon sin ningún `.nut` ⇒ clean", async () => {
    const detector = detectorForListing(
      listing("materials/a.vmt", "models/b.mdl", "sound/c.wav"),
    );

    const result = await detector.classify(addon("888"));

    expect(result).toEqual({ addonId: "888", isVScriptAddon: false, reason: "clean" });
  });

  test("listado vacío ⇒ clean", async () => {
    const detector = detectorForListing("");

    const result = await detector.classify(addon("999"));

    expect(result.isVScriptAddon).toBe(false);
    expect(result.reason).toBe("clean");
  });
});

// ---------------------------------------------------------------------------
// AC 3.5: `vpk l` con exit ≠ 0 ⇒ classify NO lanza ⇒ VScript_Addon por precaución.
// ---------------------------------------------------------------------------

describe("VScriptDetector.classify: fallo de `vpk l` ⇒ VScript_Addon por precaución (AC 3.5)", () => {
  test("exit ≠ 0 (VpkTool lanza VpkToolError) ⇒ listing-failed, isVScriptAddon true, sin lanzar", async () => {
    const detector = detectorForFailure(-1, "no such vpk");

    const result = await detector.classify(addon("1010"));

    expect(result).toEqual({
      addonId: "1010",
      isVScriptAddon: true,
      reason: "listing-failed",
    });
  });
});

// ---------------------------------------------------------------------------
// AC 3.4 (implícito): la clasificación NO depende de addoninfo.
// ---------------------------------------------------------------------------

describe("VScriptDetector.classify: NO depende de addoninfo (AC 3.4)", () => {
  test("listado con `addoninfo.txt` pero sin `.nut` bajo el prefijo ⇒ clean", async () => {
    const detector = detectorForListing(listing("addoninfo.txt", "materials/a.vmt"));

    // Aunque el addon traiga metadata/info, el detector solo mira el listado.
    const result = await detector.classify(
      addon("1111", { info: { title: "Con Script", author: "x" } }),
    );

    expect(result.isVScriptAddon).toBe(false);
    expect(result.reason).toBe("clean");
  });

  test("`addoninfo.txt` presente Y un `.nut` bajo el prefijo ⇒ VScript por el listado", async () => {
    const detector = detectorForListing(listing("addoninfo.txt", "scripts/vscripts/logic.nut"));

    const result = await detector.classify(addon("1212"));

    expect(result.isVScriptAddon).toBe(true);
    expect(result.reason).toBe("nut-in-vscripts");
  });
});

// ---------------------------------------------------------------------------
// Núcleo puro: classifyVScriptPaths / isVScriptPath con arrays de paths.
// ---------------------------------------------------------------------------

describe("classifyVScriptPaths (núcleo puro)", () => {
  test("true cuando hay un `.nut` bajo scripts/vscripts/", () => {
    expect(classifyVScriptPaths(["materials/a.vmt", "scripts/vscripts/x.nut"])).toBe(true);
  });

  test("false cuando no hay `.nut` bajo el prefijo", () => {
    expect(classifyVScriptPaths(["scripts/foo.nut", "vscripts/bar.nut", "models/a.mdl"])).toBe(
      false,
    );
  });

  test("false para array vacío", () => {
    expect(classifyVScriptPaths([])).toBe(false);
  });

  test("subdir profundo con casing mixto cuenta", () => {
    expect(classifyVScriptPaths(["SCRIPTS/VScripts/AI/Deep.Nut"])).toBe(true);
  });
});

describe("isVScriptPath (predicado puro)", () => {
  test.each([
    ["scripts/vscripts/foo.nut", true],
    ["scripts/vscripts/ai/bar.nut", true],
    ["Scripts/VScripts/Foo.NUT", true],
    ["./scripts/vscripts/foo.nut", true], // `./` líder contemplado en la normalización
    ["scripts/foo.nut", false],
    ["materials/vscripts/foo.nut", false],
    ["vscripts/foo.nut", false],
    ["scripts/vscripts/readme.txt", false], // bajo el prefijo pero no .nut
    ["scripts/vscripts_notdir/foo.nut", false], // prefijo debe terminar en `/`
  ])("isVScriptPath(%j) === %s", (path, expected) => {
    expect(isVScriptPath(path)).toBe(expected);
  });
});
