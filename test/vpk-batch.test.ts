import { describe, expect, test } from "vitest";

import {
  DEFAULT_MAX_COMMAND_LENGTH,
  DEFAULT_EXECUTABLE_NAME,
  batchInternalPaths,
  commandLengthForBatch,
  commandOverheadPrefix,
} from "../src/main/domain/index.js";

/**
 * Test unitario mínimo de la Tarea 2.3 (batching por longitud de línea de
 * comando, AC 6.4 / 6.5).
 *
 * NOTA: esto NO es el property test de la tarea 2.4 (Property 9). Es solo un
 * conjunto de ejemplos que fija el comportamiento y el modelo de costo
 * documentados en `vpk-batch.ts` para evitar ambigüedad.
 */

const VPK = "workshop/12345.vpk";

describe("batchInternalPaths: particionado por longitud de línea (AC 6.4, 6.5)", () => {
  test("entrada vacía devuelve cero lotes (sin lotes vacíos)", () => {
    expect(batchInternalPaths([], VPK)).toEqual([]);
  });

  test("sin pérdida: la concatenación en orden reproduce la entrada exacta", () => {
    const paths = Array.from({ length: 500 }, (_, i) => `materials/model_${i}/texture.vtf`);
    const batches = batchInternalPaths(paths, VPK, { maxCommandLength: 200 });

    expect(batches.flat()).toEqual(paths);
    // No hay lotes vacíos.
    expect(batches.every((b) => b.length > 0)).toBe(true);
  });

  test("cada lote respeta el límite salvo el path sobredimensionado", () => {
    const paths = Array.from({ length: 300 }, (_, i) => `sound/clip_${i}.wav`);
    const max = 300;
    const batches = batchInternalPaths(paths, VPK, { maxCommandLength: max });

    for (const batch of batches) {
      const cost = commandLengthForBatch(batch, VPK);
      // Un lote multi-path nunca excede; uno de un solo path solo puede exceder
      // si ese path por sí solo ya se pasa (no es el caso aquí).
      expect(cost).toBeLessThanOrEqual(max);
    }
  });

  test("un path que por sí solo excede el límite queda en su propio lote y se preserva", () => {
    const overhead = commandOverheadPrefix(VPK, DEFAULT_EXECUTABLE_NAME).length;
    const max = overhead + 20;
    const huge = "materials/" + "x".repeat(200) + ".vtf"; // > límite por sí solo
    const small = "a.txt";
    const paths = [small, huge, small];

    const batches = batchInternalPaths(paths, VPK, { maxCommandLength: max });

    // El path grande está aislado en su propio lote.
    const hugeBatch = batches.find((b) => b.includes(huge));
    expect(hugeBatch).toEqual([huge]);
    // No se pierde ni duplica nada.
    expect(batches.flat()).toEqual(paths);
    expect(commandLengthForBatch([huge], VPK)).toBeGreaterThan(max);
  });

  test("todo cabe en un único lote cuando el límite es holgado (default)", () => {
    const paths = ["materials/a.vmt", "models/b.mdl", "scripts/c.txt"];
    const batches = batchInternalPaths(paths, VPK);

    expect(batches).toEqual([paths]);
    expect(commandLengthForBatch(paths, VPK)).toBeLessThanOrEqual(DEFAULT_MAX_COMMAND_LENGTH);
  });

  test("commandLengthForBatch usa overhead + Σ(1 + len(path))", () => {
    const overhead = commandOverheadPrefix(VPK, DEFAULT_EXECUTABLE_NAME).length;
    const paths = ["ab", "cde"];
    // overhead + (1+2) + (1+3)
    expect(commandLengthForBatch(paths, VPK)).toBe(overhead + 3 + 4);
  });
});
