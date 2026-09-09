import { afterEach, beforeEach, expect } from "vitest";
import fc from "fast-check";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

import { SqliteLocalStore } from "../src/main/domain/index.js";
import type { AddonManifestEntry } from "../src/main/domain/index.js";
import { MIN_NUM_RUNS, propertyName } from "./helpers/property.js";
import { test } from "vitest";

/**
 * Property test de la Tarea 15.2: round-trip de persistencia del Addon_Manifest.
 *
 * Feature: l4d2-versus-addon-manager, Property 14: Round-trip de persistencia del Addon_Manifest
 * **Validates: Requirements 8.1, 8.6**
 *
 * Se ejercita el CÓDIGO REAL de `SqliteLocalStore` contra una base SQLite REAL en
 * memoria (`new Database(":memory:")`), NO un mock a mano (ver DECISIÓN 2 del
 * encabezado de `local-store.ts`): guardar un conjunto de entradas con
 * `saveManifest` y leerlo con `getManifest` produce el MISMO conjunto de entradas
 * `{ addonId, priorityOrder }`.
 *
 * Nota sobre "mismo conjunto": el manifest guarda `{ addonId, priorityOrder }` con
 * `addonId` como PRIMARY KEY, así que las entradas se comparan como un CONJUNTO
 * indexado por `addonId` (el orden de lectura es por `priorityOrder` ascendente,
 * determinista pero no necesariamente igual al orden de inserción). El generador
 * produce `addonId` ÚNICOS para que "conjunto de entradas" esté bien definido; si
 * hubiera addonIds repetidos en la entrada, el PRIMARY KEY colapsaría a uno solo,
 * lo que no es un round-trip válido de comparar.
 */

// Un `addonId` no vacío y un `priorityOrder` entero (incluye negativos y 0).
const entryArb: fc.Arbitrary<AddonManifestEntry> = fc.record({
  addonId: fc.string({ minLength: 1, maxLength: 24 }),
  priorityOrder: fc.integer({ min: -1000, max: 1000 }),
});

// Lista de entradas con `addonId` ÚNICO (ver nota arriba).
const manifestArb: fc.Arbitrary<AddonManifestEntry[]> = fc
  .uniqueArray(entryArb, {
    maxLength: 30,
    selector: (e) => e.addonId,
  });

/** Normaliza a un Map addonId->priorityOrder para comparar como conjunto. */
function toMap(entries: AddonManifestEntry[]): Map<string, number> {
  return new Map(entries.map((e) => [e.addonId, e.priorityOrder]));
}

let db: DatabaseType;
let store: SqliteLocalStore;

beforeEach(() => {
  db = new Database(":memory:");
  store = new SqliteLocalStore(db);
});

afterEach(() => {
  db.close();
});

test(
  propertyName(14, "Round-trip de persistencia del Addon_Manifest"),
  () => {
    fc.assert(
      fc.property(manifestArb, (entries) => {
        // Round-trip contra la MISMA base en memoria, reiniciando el manifest en
        // cada iteración (saveManifest reemplaza la lista entera).
        store.saveManifest(entries);
        const read = store.getManifest();

        // (1) Round-trip: mismo conjunto de entradas.
        expect(toMap(read)).toEqual(toMap(entries));
        // (2) Cardinalidad: no se pierden ni duplican entradas.
        expect(read.length).toBe(entries.length);
        // (3) Orden estable: getManifest devuelve por priorityOrder ascendente.
        const orders = read.map((e) => e.priorityOrder);
        const sorted = [...orders].sort((a, b) => a - b);
        expect(orders).toEqual(sorted);
      }),
      { numRuns: MIN_NUM_RUNS },
    );
  },
);
