import { describe, expect, test } from "vitest";

import { canDeletePreset, createAndActivatePreset } from "./presetSwitcher.js";
import type { CreateAndActivateApi } from "./presetSwitcher.js";
import type { OperationResult, Preset } from "../../main/domain/index.js";

function preset(id: string, name: string): Preset {
  return { id, name, entries: [] };
}

describe("createAndActivatePreset (P-30, Paso 5)", () => {
  test("camino feliz: crea el preset y lo activa encadenando switchActivePreset con SU id", async () => {
    const switchCalls: string[] = [];
    const api: CreateAndActivateApi = {
      createPreset: async (name) => preset("preset-nuevo", name),
      switchActivePreset: async (id) => {
        switchCalls.push(id);
        return { status: "success" };
      },
    };

    const { preset: created, switchResult } = await createAndActivatePreset(api, "Skins");

    expect(created).toEqual(preset("preset-nuevo", "Skins"));
    expect(switchCalls).toEqual(["preset-nuevo"]);
    expect(switchResult).toEqual<OperationResult>({ status: "success" });
  });

  test("si createPreset falla (nombre vacío), NO llama a switchActivePreset y propaga el error", async () => {
    let switchCalled = false;
    const api: CreateAndActivateApi = {
      createPreset: async () => {
        throw new Error("El nombre del preset no puede estar vacío.");
      },
      switchActivePreset: async () => {
        switchCalled = true;
        return { status: "success" };
      },
    };

    await expect(createAndActivatePreset(api, "   ")).rejects.toThrow(
      "El nombre del preset no puede estar vacío.",
    );
    expect(switchCalled).toBe(false);
  });

  test("si createPreset tiene éxito pero switchActivePreset falla, devuelve el preset creado junto al resultado de falla (no se deshace la creación)", async () => {
    const api: CreateAndActivateApi = {
      createPreset: async (name) => preset("preset-x", name),
      switchActivePreset: async () => ({ status: "failure", error: "boom" }),
    };

    const { preset: created, switchResult } = await createAndActivatePreset(api, "Armas");

    expect(created.id).toBe("preset-x");
    expect(switchResult).toEqual<OperationResult>({ status: "failure", error: "boom" });
  });
});

describe("canDeletePreset (P-30, Paso 5)", () => {
  test("un preset distinto del activo se puede borrar", () => {
    expect(canDeletePreset("preset-b", "preset-a")).toBe(true);
  });

  test("el preset ACTIVO no se puede borrar", () => {
    expect(canDeletePreset("preset-a", "preset-a")).toBe(false);
  });

  test("sin ningún preset activo (null), cualquier preset se puede borrar", () => {
    expect(canDeletePreset("preset-a", null)).toBe(true);
  });
});
