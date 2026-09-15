import { describe, expect, test } from "vitest";

import { computeFirstLaunchChecklist } from "./firstLaunchChecklist.js";

describe("computeFirstLaunchChecklist", () => {
  test("antes de resolver detectPaths: los 4 ítems pending, sin detalle", () => {
    const rows = computeFirstLaunchChecklist(false, null, null);
    expect(rows.map((r) => r.state)).toEqual(["pending", "pending", "pending", "pending"]);
    expect(rows.every((r) => r.detail === null)).toBe(true);
  });

  test("rutas resueltas, escaneo sin arrancar todavía: steam/biblioteca/verificando done, escaneo current sin detalle", () => {
    const rows = computeFirstLaunchChecklist(true, null, null);
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "current", "done"]);
    expect(rows.find((r) => r.id === "scanning")?.detail).toBeNull();
  });

  test("escaneo en curso: detalle 'N de M' y estado current", () => {
    const rows = computeFirstLaunchChecklist(true, 41, 73);
    const scanning = rows.find((r) => r.id === "scanning");
    expect(scanning?.state).toBe("current");
    expect(scanning?.detail).toBe("41 de 73");
  });

  test("escaneo completo (done === total): estado done", () => {
    const rows = computeFirstLaunchChecklist(true, 73, 73);
    expect(rows.find((r) => r.id === "scanning")?.state).toBe("done");
  });
});
