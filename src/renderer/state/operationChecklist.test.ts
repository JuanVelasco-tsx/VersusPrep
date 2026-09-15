import { describe, expect, test } from "vitest";

import { computeChecklist, computeProgressFraction } from "./operationChecklist.js";

describe("computeChecklist", () => {
  test("currentStep null: las 4 filas pending", () => {
    const rows = computeChecklist(null);
    expect(rows.map((r) => r.state)).toEqual(["pending", "pending", "pending", "pending"]);
  });

  test("guard/scan/elevation (precondiciones): las 4 filas siguen pending", () => {
    expect(computeChecklist("guard").map((r) => r.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(computeChecklist("scan").map((r) => r.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(computeChecklist("elevation").map((r) => r.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  test("currentStep backup: backup en curso, el resto pending", () => {
    const rows = computeChecklist("backup");
    expect(rows.map((r) => r.state)).toEqual(["current", "pending", "pending", "pending"]);
  });

  test("currentStep merge: backup hecho, merge en curso, el resto pending", () => {
    const rows = computeChecklist("merge");
    expect(rows.map((r) => r.state)).toEqual(["done", "current", "pending", "pending"]);
  });

  test("currentStep install: backup/merge hechos, install en curso, gameinfo pending", () => {
    const rows = computeChecklist("install");
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "current", "pending"]);
  });

  test("currentStep gameinfo: las primeras 3 hechas, gameinfo en curso", () => {
    const rows = computeChecklist("gameinfo");
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "done", "current"]);
  });

  test("currentStep saveManifest/done: las 4 filas done", () => {
    expect(computeChecklist("saveManifest").map((r) => r.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(computeChecklist("done").map((r) => r.state)).toEqual(["done", "done", "done", "done"]);
  });

  test("currentStep restarting/failed: tratados igual que null (las 4 pending)", () => {
    expect(computeChecklist("restarting").map((r) => r.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(computeChecklist("failed").map((r) => r.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  test("labels correctos y en el orden backup/merge/install/gameinfo", () => {
    const rows = computeChecklist(null);
    expect(rows.map((r) => r.step)).toEqual(["backup", "merge", "install", "gameinfo"]);
    expect(rows.map((r) => r.label)).toEqual([
      "Copia de seguridad del VPK anterior",
      "Fusionando addons (extrayendo y empaquetando el VPK)",
      "Instalando en modsvs\\",
      "Registrando en gameinfo.txt",
    ]);
  });
});

describe("computeProgressFraction", () => {
  test("null -> 0", () => {
    expect(computeProgressFraction(null)).toBe(0);
  });

  test("merge en curso -> 1/4 (solo backup hecho)", () => {
    expect(computeProgressFraction("merge")).toBe(0.25);
  });

  test("gameinfo en curso -> 3/4", () => {
    expect(computeProgressFraction("gameinfo")).toBe(0.75);
  });

  test("done -> 1 (completo)", () => {
    expect(computeProgressFraction("done")).toBe(1);
  });
});
