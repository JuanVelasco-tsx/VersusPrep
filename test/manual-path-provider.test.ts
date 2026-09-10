import { describe, expect, test } from "vitest";
import type { Dialog, OpenDialogOptions, OpenDialogReturnValue } from "electron";

import {
  RealManualPathProvider,
  toManualPathResponse,
  toOpenDialogOptions,
  toRequiredPathOptions,
} from "../src/main/data/manual-path-provider.js";

/**
 * Tests del bloque 2 de la Tarea 20.4 (ManualPathProvider). Cubren el mapeo PURO
 * kind/pathKey -> OpenDialogOptions y OpenDialogReturnValue -> ManualPathResponse,
 * mas la clase RealManualPathProvider con un dialog falso que implementa
 * Pick<Dialog, "showOpenDialog"> (sin runtime de Electron, sin vi.fn()).
 */

// ---------------------------------------------------------------------------
// toRequiredPathOptions (un caso por cada RequiredPathKey)
// ---------------------------------------------------------------------------

describe("toRequiredPathOptions", () => {
  test("gameRoot -> carpeta (openDirectory)", () => {
    expect(toRequiredPathOptions("gameRoot").properties).toEqual(["openDirectory"]);
  });

  test("workshopFolder -> carpeta (openDirectory)", () => {
    expect(toRequiredPathOptions("workshopFolder").properties).toEqual(["openDirectory"]);
  });

  test("modsvsFolder -> carpeta (openDirectory)", () => {
    expect(toRequiredPathOptions("modsvsFolder").properties).toEqual(["openDirectory"]);
  });

  test("vpkToolPath -> archivo (openFile) con filtro .exe", () => {
    const opts = toRequiredPathOptions("vpkToolPath");
    expect(opts.properties).toEqual(["openFile"]);
    expect(opts.filters).toEqual([{ name: "vpk.exe", extensions: ["exe"] }]);
  });

  test("gameInfoFile -> archivo (openFile) con filtro .txt", () => {
    const opts = toRequiredPathOptions("gameInfoFile");
    expect(opts.properties).toEqual(["openFile"]);
    expect(opts.filters).toEqual([{ name: "gameinfo.txt", extensions: ["txt"] }]);
  });
});

// ---------------------------------------------------------------------------
// toOpenDialogOptions
// ---------------------------------------------------------------------------

describe("toOpenDialogOptions", () => {
  test("steam-path -> carpeta (openDirectory)", () => {
    expect(toOpenDialogOptions({ kind: "steam-path" }).properties).toEqual([
      "openDirectory",
    ]);
  });

  test("game-root -> carpeta (openDirectory)", () => {
    expect(toOpenDialogOptions({ kind: "game-root" }).properties).toEqual([
      "openDirectory",
    ]);
  });

  test("required-path (carpeta) delega en toRequiredPathOptions", () => {
    expect(toOpenDialogOptions({ kind: "required-path", pathKey: "modsvsFolder" })).toEqual(
      toRequiredPathOptions("modsvsFolder"),
    );
  });

  test("required-path (archivo) delega en toRequiredPathOptions", () => {
    expect(toOpenDialogOptions({ kind: "required-path", pathKey: "vpkToolPath" })).toEqual(
      toRequiredPathOptions("vpkToolPath"),
    );
  });
});

// ---------------------------------------------------------------------------
// toManualPathResponse
// ---------------------------------------------------------------------------

describe("toManualPathResponse", () => {
  test("canceled=true, filePaths=[] -> cancelled", () => {
    const result: OpenDialogReturnValue = { canceled: true, filePaths: [] };
    expect(toManualPathResponse(result)).toEqual({ kind: "cancelled" });
  });

  test("canceled=false, filePaths=['C:\\Steam'] -> selected con ese path", () => {
    const result: OpenDialogReturnValue = { canceled: false, filePaths: ["C:\\Steam"] };
    expect(toManualPathResponse(result)).toEqual({ kind: "selected", path: "C:\\Steam" });
  });

  test("defensivo: canceled=false pero filePaths=[] -> cancelled", () => {
    const result: OpenDialogReturnValue = { canceled: false, filePaths: [] };
    expect(toManualPathResponse(result)).toEqual({ kind: "cancelled" });
  });
});

// ---------------------------------------------------------------------------
// RealManualPathProvider.requestPath (dialog falso, sin vi.fn())
// ---------------------------------------------------------------------------

// Tipo EXACTO de showOpenDialog (dos sobrecargas). Se deriva de electron para
// que el doble sea asignable a Pick<Dialog, "showOpenDialog">.
type ShowOpenDialog = Dialog["showOpenDialog"];

/** Dialog falso: registra las options recibidas y devuelve un resultado fijo. */
function fakeDialog(returnValue: OpenDialogReturnValue): {
  dialog: Pick<Dialog, "showOpenDialog">;
  calls: OpenDialogOptions[];
} {
  const calls: OpenDialogOptions[] = [];
  const showOpenDialog = ((...args: unknown[]): Promise<OpenDialogReturnValue> => {
    // La sobrecarga sin ventana pasa las options como primer argumento; la modal
    // las pasa como segundo. El proveedor usa la variante sin ventana (DECISION D2).
    const options = (args.length === 1 ? args[0] : args[1]) as OpenDialogOptions;
    calls.push(options);
    return Promise.resolve(returnValue);
  }) as ShowOpenDialog;
  return { dialog: { showOpenDialog }, calls };
}

describe("RealManualPathProvider.requestPath", () => {
  test("(a) steam-path -> showOpenDialog con openDirectory; respuesta -> selected", async () => {
    const { dialog, calls } = fakeDialog({ canceled: false, filePaths: ["C:\\Steam"] });
    const provider = new RealManualPathProvider(dialog);

    const res = await provider.requestPath({ kind: "steam-path" });

    expect(calls.length).toBe(1);
    expect(calls[0]?.properties).toEqual(["openDirectory"]);
    expect(res).toEqual({ kind: "selected", path: "C:\\Steam" });
  });

  test("(b) required-path vpkToolPath -> showOpenDialog con filtro .exe", async () => {
    const { dialog, calls } = fakeDialog({
      canceled: false,
      filePaths: ["C:\\Steam\\...\\bin\\vpk.exe"],
    });
    const provider = new RealManualPathProvider(dialog);

    await provider.requestPath({ kind: "required-path", pathKey: "vpkToolPath" });

    expect(calls[0]?.properties).toEqual(["openFile"]);
    expect(calls[0]?.filters).toEqual([{ name: "vpk.exe", extensions: ["exe"] }]);
  });

  test("(c) canceled=true -> requestPath resuelve cancelled", async () => {
    const { dialog } = fakeDialog({ canceled: true, filePaths: [] });
    const provider = new RealManualPathProvider(dialog);

    const res = await provider.requestPath({ kind: "game-root" });

    expect(res).toEqual({ kind: "cancelled" });
  });
});