import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

import { SqliteLocalStore } from "../src/main/domain/index.js";
import type { AddonManifestEntry, GamePaths } from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 15.3 (ciclo de sesión pendiente) y cobertura de las
 * decisiones no triviales de `local-store.ts` (getPaths/savePaths merge parcial,
 * separación manifest vs sesión pendiente), contra una base SQLite REAL en
 * memoria (`new Database(":memory:")`), sin mocks a mano.
 *
 * El ciclo `savePendingSession` -> `getPendingSession` -> `clearPendingSession`
 * es el soporte de rehidratación del relanzo elevado (AC 9.2): tras guardar se
 * lee el mismo Active_Set candidato (selección + Priority_Order); tras limpiar,
 * `getPendingSession` devuelve `null`. El CONSUMO de este estado (persistir antes
 * de `runas`, rehidratar al arrancar elevado) es de la tarea 17, no de aquí.
 */

const CANDIDATE: AddonManifestEntry[] = [
  { addonId: "3776576407", priorityOrder: 0 },
  { addonId: "3776602410", priorityOrder: 1 },
  { addonId: "121272536", priorityOrder: 2 },
];

const FULL_PATHS: GamePaths = {
  steamPath: "C:\\Program Files (x86)\\Steam",
  gameRoot: "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2",
  left4dead2Dir: "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2\\left4dead2",
  workshopFolder: "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\addons\\workshop",
  vpkToolPath: "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2\\bin\\vpk.exe",
  gameInfoFile: "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\gameinfo.txt",
  modsvsFolder: "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\modsvs",
};

let db: DatabaseType;
let store: SqliteLocalStore;

beforeEach(() => {
  db = new Database(":memory:");
  store = new SqliteLocalStore(db);
});

afterEach(() => {
  db.close();
});

describe("LocalStore — estado de sesión pendiente (Tarea 15.3, AC 9.2)", () => {
  test("primera ejecución: getPendingSession devuelve null (nada guardado)", () => {
    expect(store.getPendingSession()).toBeNull();
  });

  test("savePendingSession -> getPendingSession devuelve el mismo Active_Set candidato", () => {
    store.savePendingSession(CANDIDATE);
    const read = store.getPendingSession();
    expect(read).not.toBeNull();
    // Se preserva selección + Priority_Order (orden por priorityOrder ascendente).
    expect(read).toEqual(CANDIDATE);
  });

  test("clearPendingSession -> getPendingSession vuelve a null", () => {
    store.savePendingSession(CANDIDATE);
    expect(store.getPendingSession()).not.toBeNull();
    store.clearPendingSession();
    expect(store.getPendingSession()).toBeNull();
  });

  test("savePendingSession reemplaza la lista entera (no acumula)", () => {
    store.savePendingSession(CANDIDATE);
    const nuevo: AddonManifestEntry[] = [{ addonId: "999", priorityOrder: 0 }];
    store.savePendingSession(nuevo);
    expect(store.getPendingSession()).toEqual(nuevo);
  });

  test("savePendingSession([]) deja getPendingSession en [] (sesión activa, candidato vacío)", () => {
    // Nueva semántica (DECISIÓN 5): guardar [] a propósito NO es lo mismo que no
    // haber sesión. Representa un Active_Set candidato intencionalmente vacío (el
    // usuario quitó el último addon antes de relanzar elevado, p. ej.
    // MergeOrchestrator.removeAddon sobre un Active_Set de tamaño 1).
    store.savePendingSession(CANDIDATE);
    store.savePendingSession([]);
    expect(store.getPendingSession()).toEqual([]);
  });

  test("savePendingSession([]) directo (sin sesión previa) -> [] (no null)", () => {
    store.savePendingSession([]);
    expect(store.getPendingSession()).toEqual([]);
  });

  test("savePendingSession([]) luego clearPendingSession() -> null", () => {
    store.savePendingSession([]);
    expect(store.getPendingSession()).toEqual([]);
    store.clearPendingSession();
    expect(store.getPendingSession()).toBeNull();
  });

  test("la sesión pendiente y el manifest instalado son independientes", () => {
    const instalado: AddonManifestEntry[] = [{ addonId: "aaa", priorityOrder: 0 }];
    store.saveManifest(instalado);
    store.savePendingSession(CANDIDATE);
    // Limpiar la pendiente NO toca el manifest instalado.
    store.clearPendingSession();
    expect(store.getPendingSession()).toBeNull();
    expect(store.getManifest()).toEqual(instalado);
  });
});

describe("LocalStore — manifest instalado (Tarea 15.1, AC 8.1/8.6)", () => {
  test("primera ejecución: getManifest devuelve lista vacía", () => {
    expect(store.getManifest()).toEqual([]);
  });

  test("saveManifest -> getManifest round-trip por priorityOrder ascendente", () => {
    const desordenado: AddonManifestEntry[] = [
      { addonId: "b", priorityOrder: 2 },
      { addonId: "a", priorityOrder: 0 },
      { addonId: "c", priorityOrder: 1 },
    ];
    store.saveManifest(desordenado);
    expect(store.getManifest()).toEqual([
      { addonId: "a", priorityOrder: 0 },
      { addonId: "c", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 2 },
    ]);
  });
});

describe("LocalStore — rutas (Tarea 15.1, AC 1.13; DECISIÓN 4: merge parcial)", () => {
  test("primera ejecución: getPaths devuelve null", () => {
    expect(store.getPaths()).toBeNull();
  });

  test("savePaths parcial no devuelve GamePaths hasta estar completo", () => {
    store.savePaths({ steamPath: FULL_PATHS.steamPath });
    // Un GamePaths incompleto no es válido -> null.
    expect(store.getPaths()).toBeNull();
  });

  test("savePaths completo -> getPaths devuelve el GamePaths entero", () => {
    store.savePaths(FULL_PATHS);
    expect(store.getPaths()).toEqual(FULL_PATHS);
  });

  test("savePaths parcial hace MERGE con lo ya guardado (no reemplaza)", () => {
    // Se guarda todo salvo modsvsFolder...
    const sinModsvs: Partial<GamePaths> = { ...FULL_PATHS };
    delete (sinModsvs as Partial<GamePaths>).modsvsFolder;
    store.savePaths(sinModsvs);
    expect(store.getPaths()).toBeNull(); // falta una ruta

    // ...y luego solo la faltante: el resto NO se pierde (merge parcial).
    store.savePaths({ modsvsFolder: FULL_PATHS.modsvsFolder });
    expect(store.getPaths()).toEqual(FULL_PATHS);
  });

  test("savePaths sobreescribe solo la clave presente, conservando las demás", () => {
    store.savePaths(FULL_PATHS);
    store.savePaths({ steamPath: "E:\\OtroSteam" });
    expect(store.getPaths()).toEqual({ ...FULL_PATHS, steamPath: "E:\\OtroSteam" });
  });
});
