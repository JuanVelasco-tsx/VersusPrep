import { describe, expect, test } from "vitest";

import { ProcessGuard } from "../src/main/domain/index.js";
import type { ProcessListProvider } from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 14.2: deteccion del proceso `left4dead2.exe`
 * (AC 4.1, 4.2).
 *
 * Se ejercita `ProcessGuard` con un {@link ProcessListProvider} MOCKEADO en
 * memoria, del mismo modo que `test/vpk-tool.test.ts` inyecta un
 * `MockCommandRunner`. NO son property tests (ProcessGuard no esta entre las 15
 * Correctness Properties del diseño): son ejemplos concretos que fijan el
 * contrato documentado en `process-guard.ts`, incluidos los bordes de la
 * DECISION 1 (matching exacto case-insensitive) y la DECISION 2 (basename).
 */

// ---------------------------------------------------------------------------
// Mock de ProcessListProvider en memoria.
// ---------------------------------------------------------------------------

/**
 * `ProcessListProvider` mockeado: devuelve una lista fija de nombres de proceso
 * configurada en el constructor. Suficiente para verificar la logica de
 * deteccion sin enumerar procesos reales del sistema.
 */
class MockProcessListProvider implements ProcessListProvider {
  readonly #names: string[];

  constructor(names: string[]) {
    this.#names = names;
  }

  listRunningProcessNames(): Promise<string[]> {
    return Promise.resolve(this.#names);
  }
}

/** Atajo: construye un ProcessGuard sobre una lista fija de procesos. */
function guardWith(names: string[]): ProcessGuard {
  return new ProcessGuard(new MockProcessListProvider(names));
}

describe("ProcessGuard.isGameRunning", () => {
  test("juego en ejecucion: la lista incluye left4dead2.exe -> true", async () => {
    const guard = guardWith(["explorer.exe", "left4dead2.exe", "steam.exe"]);
    expect(await guard.isGameRunning()).toBe(true);
  });

  test("juego cerrado: la lista no incluye left4dead2.exe -> false", async () => {
    const guard = guardWith(["explorer.exe", "steam.exe", "chrome.exe"]);
    expect(await guard.isGameRunning()).toBe(false);
  });

  test("presencia de hl2.exe (sin left4dead2.exe) no cuenta -> false", async () => {
    // hl2.exe es el ejecutable de otros juegos Source; NO es el del juego (AC 4.1).
    const guard = guardWith(["hl2.exe", "steam.exe"]);
    expect(await guard.isGameRunning()).toBe(false);
  });

  test("case-insensitive: LEFT4DEAD2.EXE -> true (DECISION 1)", async () => {
    const guard = guardWith(["LEFT4DEAD2.EXE"]);
    expect(await guard.isGameRunning()).toBe(true);
  });

  test("case-insensitive: Left4Dead2.exe -> true (DECISION 1)", async () => {
    const guard = guardWith(["Left4Dead2.exe"]);
    expect(await guard.isGameRunning()).toBe(true);
  });

  test("ruta completa Windows: se compara el basename -> true (DECISION 2)", async () => {
    const guard = guardWith([
      "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2.exe",
    ]);
    expect(await guard.isGameRunning()).toBe(true);
  });

  test("ruta completa con separador / (Linux/Steam Deck): basename -> true (DECISION 2)", async () => {
    const guard = guardWith([
      "/home/deck/.steam/steam/steamapps/common/Left 4 Dead 2/left4dead2.exe",
    ]);
    expect(await guard.isGameRunning()).toBe(true);
  });

  test("falso positivo por sufijo: left4dead2.exe.bak -> false (DECISION 1)", async () => {
    const guard = guardWith(["left4dead2.exe.bak"]);
    expect(await guard.isGameRunning()).toBe(false);
  });

  test("falso positivo por prefijo: notleft4dead2.exe -> false (DECISION 1)", async () => {
    const guard = guardWith(["notleft4dead2.exe"]);
    expect(await guard.isGameRunning()).toBe(false);
  });

  test("lista vacia -> false", async () => {
    const guard = guardWith([]);
    expect(await guard.isGameRunning()).toBe(false);
  });
});
