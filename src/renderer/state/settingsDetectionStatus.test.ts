import { describe, expect, test } from "vitest";

import type { GamePaths } from "../../main/domain/index.js";
import { computeDetectionStatus, TOTAL_PATH_FIELDS } from "./settingsDetectionStatus.js";

const FULL_PATHS: GamePaths = {
  steamPath: "C:/Steam",
  gameRoot: "C:/Steam/steamapps/common/Left 4 Dead 2",
  left4dead2Dir: "C:/Steam/steamapps/common/Left 4 Dead 2/left4dead2",
  workshopFolder: "C:/Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons/workshop",
  vpkToolPath: "C:/Steam/steamapps/common/Left 4 Dead 2/bin/vpk.exe",
  gameInfoFile: "C:/Steam/steamapps/common/Left 4 Dead 2/left4dead2/gameinfo.txt",
  modsvsFolder: "C:/Steam/steamapps/common/Left 4 Dead 2/left4dead2/modsvs",
};

describe("computeDetectionStatus", () => {
  test("paths null: 0/7, checklist entero en false, falta gameRoot primero", () => {
    const status = computeDetectionStatus(null);

    expect(status.resolvedCount).toBe(0);
    expect(status.totalCount).toBe(TOTAL_PATH_FIELDS);
    expect(status.checklist.every((item) => !item.ok)).toBe(true);
    expect(status.missingRequiredField).toBe("gameRoot");
  });

  test("las 7 rutas presentes: 7/7, checklist entero en true, sin ruta faltante", () => {
    const status = computeDetectionStatus(FULL_PATHS);

    expect(status.resolvedCount).toBe(7);
    expect(status.checklist.every((item) => item.ok)).toBe(true);
    expect(status.missingRequiredField).toBeNull();
  });

  test("solo vpkToolPath vacío: 6/7, el cuarto ítem del checklist en false, falta vpkToolPath", () => {
    const status = computeDetectionStatus({ ...FULL_PATHS, vpkToolPath: "" });

    expect(status.resolvedCount).toBe(6);
    expect(status.checklist.map((item) => item.ok)).toEqual([true, true, true, false]);
    expect(status.missingRequiredField).toBe("vpkToolPath");
  });

  test("varias rutas requeridas faltantes: prioriza el orden gameRoot > workshopFolder > vpkToolPath > gameInfoFile", () => {
    const status = computeDetectionStatus({
      ...FULL_PATHS,
      workshopFolder: "",
      gameInfoFile: "",
    });

    expect(status.missingRequiredField).toBe("workshopFolder");
  });

  test("los 4 ítems del checklist mapean steamPath/gameRoot/gameInfoFile/vpkToolPath, no left4dead2Dir/workshopFolder/modsvsFolder", () => {
    const status = computeDetectionStatus({
      ...FULL_PATHS,
      steamPath: "",
      left4dead2Dir: "",
      workshopFolder: "",
      modsvsFolder: "",
    });

    // steamPath vacio -> solo el primer item cae; left4dead2Dir/workshopFolder/
    // modsvsFolder vacios no tocan NINGUN item del checklist (no estan en el).
    expect(status.checklist.map((item) => item.ok)).toEqual([false, true, true, true]);
  });

  test("BUG FIX: la etiqueta del 4º ítem (vpk.exe) es coherente con el ✓/✕, no un texto fijo", () => {
    const withVpk = computeDetectionStatus(FULL_PATHS);
    const withoutVpk = computeDetectionStatus({ ...FULL_PATHS, vpkToolPath: "" });

    const vpkItemWithVpk = withVpk.checklist[3];
    const vpkItemWithoutVpk = withoutVpk.checklist[3];

    expect(vpkItemWithVpk).toEqual({ label: "vpk.exe encontrado", ok: true });
    expect(vpkItemWithoutVpk).toEqual({ label: "vpk.exe sin ubicar", ok: false });
  });
});
