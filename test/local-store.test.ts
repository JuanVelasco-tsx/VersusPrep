import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

import { DEFAULT_PRESET_FOLDER_ID, DEFAULT_PRESET_NAME, SqliteLocalStore } from "../src/main/domain/index.js";
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

// ---------------------------------------------------------------------------
// Presets (P-30, Paso 1 — solo persistencia; ver DECISIÓN 6 en local-store.ts).
// ---------------------------------------------------------------------------

describe("LocalStore — presets: estado inicial por migración (P-30, DECISIÓN 6)", () => {
  // El `store` de `beforeEach` es SIEMPRE una base "nueva" (`:memory:` fresca),
  // así que su PRIMERA construcción ya disparó la migración (manifest vacío en
  // ese momento) antes de que este test corra.
  test("una base nueva arranca con un preset 'Principal' vacío, ya marcado ACTIVO", () => {
    const presets = store.listPresets();
    expect(presets).toHaveLength(1);
    expect(presets[0]).toEqual({
      id: presets[0]!.id,
      name: DEFAULT_PRESET_NAME,
      description: null,
      entries: [],
    });
    expect(store.getActivePresetId()).toBe(presets[0]!.id);
  });

  // P-30, Paso 4.5a (DECISIÓN 6-bis): el id de "Principal" es el literal FIJO
  // "modsvs", NO uno generado al azar — así converger addAddon/removeAddon/
  // applyActiveSet hacia el preset activo (Paso 4.5b) no re-funde nada para
  // ninguna instalación existente.
  test("el id de 'Principal' es DEFAULT_PRESET_FOLDER_ID ('modsvs'), no un id generado al azar", () => {
    const presets = store.listPresets();
    expect(presets[0]!.id).toBe(DEFAULT_PRESET_FOLDER_ID);
    expect(presets[0]!.id).toBe("modsvs");
  });
});

describe("LocalStore — presets: CRUD (P-30, Paso 1)", () => {
  test("createPreset agrega un preset con id TÉCNICO (preset-<hex>) distinto del nombre", () => {
    const preset = store.createPreset("Armas", CANDIDATE);
    expect(preset.name).toBe("Armas");
    expect(preset.entries).toEqual(CANDIDATE);
    expect(preset.id).toMatch(/^preset-[0-9a-f]{6}$/);
    // Se suma al "Principal" que ya dejó la migración (ver describe de arriba).
    expect(store.listPresets()).toHaveLength(2);
    expect(store.getPreset(preset.id)).toEqual(preset);
  });

  test("createPreset genera ids distintos para presets distintos", () => {
    const a = store.createPreset("A", []);
    const b = store.createPreset("B", []);
    expect(a.id).not.toBe(b.id);
  });

  test("getPreset devuelve null para un id inexistente", () => {
    expect(store.getPreset("preset-noexiste")).toBeNull();
  });

  test("renamePreset cambia SOLO el nombre (id y entries intactos)", () => {
    const preset = store.createPreset("Armas", CANDIDATE);
    store.renamePreset(preset.id, "Armas v2");
    expect(store.getPreset(preset.id)).toEqual({ ...preset, name: "Armas v2" });
  });

  test("renamePreset sobre un id inexistente es un no-op silencioso", () => {
    expect(() => store.renamePreset("preset-noexiste", "x")).not.toThrow();
    expect(store.getPreset("preset-noexiste")).toBeNull();
  });

  test("deletePreset quita el preset Y sus entries", () => {
    const preset = store.createPreset("Armas", CANDIDATE);
    store.deletePreset(preset.id);
    expect(store.getPreset(preset.id)).toBeNull();
    expect(store.listPresets().map((p) => p.id)).not.toContain(preset.id);
  });

  test("deletePreset sobre un id inexistente es un no-op silencioso", () => {
    expect(() => store.deletePreset("preset-noexiste")).not.toThrow();
  });

  test("listPresets preserva el orden de CREACIÓN", () => {
    // "Principal" (migración) ya ocupa el primer lugar.
    const a = store.createPreset("A", []);
    const b = store.createPreset("B", []);
    const ids = store.listPresets().map((p) => p.id);
    expect(ids.slice(-2)).toEqual([a.id, b.id]);
  });
});

describe("LocalStore — presets.description (bug/feature post P-30 Paso 5)", () => {
  test("createPreset con descripción la persiste tal cual, en createPreset/getPreset/listPresets", () => {
    const preset = store.createPreset("Armas", CANDIDATE, "Solo las mejores armas");
    expect(preset.description).toBe("Solo las mejores armas");
    expect(store.getPreset(preset.id)?.description).toBe("Solo las mejores armas");
    expect(store.listPresets().find((p) => p.id === preset.id)?.description).toBe(
      "Solo las mejores armas",
    );
  });

  test("createPreset sin descripción (parámetro omitido) persiste null, no undefined ni cadena vacía", () => {
    const preset = store.createPreset("Skins", []);
    expect(preset.description).toBeNull();
    expect(store.getPreset(preset.id)?.description).toBeNull();
  });

  test("createPreset con descripción explícita null persiste null", () => {
    const preset = store.createPreset("Skins", [], null);
    expect(preset.description).toBeNull();
  });

  test("migración de esquema: una tabla `presets` SIN columna description (versión previa a este cambio) gana la columna vía ALTER TABLE, sin perder filas existentes", () => {
    const rawDb = new Database(":memory:");
    // Esquema VIEJO exacto (sin `description`), ya con un preset creado por
    // una version anterior de la app.
    rawDb.exec(`
      CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE preset_entries (
        presetId TEXT NOT NULL, addonId TEXT NOT NULL, priorityOrder INTEGER NOT NULL,
        PRIMARY KEY (presetId, addonId)
      );
      CREATE TABLE active_preset (id INTEGER PRIMARY KEY CHECK (id = 1), presetId TEXT);
    `);
    rawDb.prepare("INSERT INTO presets (id, name) VALUES (?, ?)").run("modsvs", DEFAULT_PRESET_NAME);
    rawDb.prepare("INSERT INTO active_preset (id, presetId) VALUES (1, ?)").run("modsvs");

    const migrated = new SqliteLocalStore(rawDb);

    // La fila preexistente sigue ahí, ahora con description = null (columna
    // nueva sin valor), no se duplicó ni se perdió.
    expect(migrated.listPresets()).toEqual([
      { id: "modsvs", name: DEFAULT_PRESET_NAME, description: null, entries: [] },
    ]);
    // La columna nueva ya admite escritura normal tras la migración.
    const nuevo = migrated.createPreset("Armas", [], "desc");
    expect(migrated.getPreset(nuevo.id)?.description).toBe("desc");

    rawDb.close();
  });

  test("migración de columna es IDEMPOTENTE: reconstruir sobre una base ya migrada no falla ni duplica la columna", () => {
    const rawDb = new Database(":memory:");
    const first = new SqliteLocalStore(rawDb);
    first.createPreset("Armas", [], "desc");

    expect(() => new SqliteLocalStore(rawDb)).not.toThrow();
    const second = new SqliteLocalStore(rawDb);
    expect(second.listPresets().find((p) => p.name === "Armas")?.description).toBe("desc");

    rawDb.close();
  });
});

describe("LocalStore — presets: puntero de preset ACTIVO (P-30, Paso 1)", () => {
  test("setActivePresetId / getActivePresetId round-trip", () => {
    const preset = store.createPreset("Armas", []);
    store.setActivePresetId(preset.id);
    expect(store.getActivePresetId()).toBe(preset.id);
  });

  test("cambiar el activo entre dos presets existentes", () => {
    const a = store.createPreset("A", []);
    const b = store.createPreset("B", []);
    store.setActivePresetId(a.id);
    expect(store.getActivePresetId()).toBe(a.id);
    store.setActivePresetId(b.id);
    expect(store.getActivePresetId()).toBe(b.id);
  });

  test("deletePreset del preset ACTIVO limpia también el puntero de activo (integridad)", () => {
    const preset = store.createPreset("Armas", []);
    store.setActivePresetId(preset.id);
    store.deletePreset(preset.id);
    expect(store.getActivePresetId()).toBeNull();
  });

  test("deletePreset de un preset NO activo no toca el puntero de activo", () => {
    const active = store.createPreset("Activo", []);
    const other = store.createPreset("Otro", []);
    store.setActivePresetId(active.id);
    store.deletePreset(other.id);
    expect(store.getActivePresetId()).toBe(active.id);
  });
});

describe("LocalStore — presets: migración del Active_Set existente (P-30, Paso 1)", () => {
  test("migra un manifest EXISTENTE (previo a este cambio) a un preset 'Principal' ACTIVO", () => {
    const rawDb = new Database(":memory:");
    // Simula una base de una versión ANTERIOR a P-30: la tabla `manifest` ya
    // existe con datos, pero `SqliteLocalStore` (y su esquema de presets)
    // todavía NUNCA corrió sobre esta base.
    rawDb.exec(
      "CREATE TABLE manifest (addonId TEXT PRIMARY KEY, priorityOrder INTEGER NOT NULL)",
    );
    const insert = rawDb.prepare(
      "INSERT INTO manifest (addonId, priorityOrder) VALUES (?, ?)",
    );
    insert.run("111", 0);
    insert.run("222", 1);

    // PRIMERA construcción de SqliteLocalStore sobre esta base: `presets` está
    // vacía -> dispara la migración.
    const migrated = new SqliteLocalStore(rawDb);

    const activeId = migrated.getActivePresetId();
    expect(activeId).not.toBeNull();
    expect(migrated.listPresets()).toEqual([
      {
        id: activeId,
        name: DEFAULT_PRESET_NAME,
        description: null,
        entries: [
          { addonId: "111", priorityOrder: 0 },
          { addonId: "222", priorityOrder: 1 },
        ],
      },
    ]);
    // El manifest ORIGINAL NO se toca ni se borra en este paso (Paso 1 = solo
    // agregar la persistencia de presets, sin reemplazar todavía el manifest).
    expect(migrated.getManifest()).toEqual([
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ]);

    rawDb.close();
  });

  test("migra un manifest EXISTENTE VACÍO a un preset 'Principal' vacío ACTIVO (estado válido)", () => {
    const rawDb = new Database(":memory:");
    rawDb.exec(
      "CREATE TABLE manifest (addonId TEXT PRIMARY KEY, priorityOrder INTEGER NOT NULL)",
    );
    // Sin filas: un Active_Set vacío es un estado válido (mismo criterio que
    // `pending_session` con candidato []) y la migración igual debe correr.
    const migrated = new SqliteLocalStore(rawDb);

    expect(migrated.listPresets()).toEqual([
      {
        id: migrated.getActivePresetId(),
        name: DEFAULT_PRESET_NAME,
        description: null,
        entries: [],
      },
    ]);
    expect(migrated.getActivePresetId()).not.toBeNull();

    rawDb.close();
  });

  test("la migración es IDEMPOTENTE: una segunda construcción sobre la misma base no duplica el preset por defecto", () => {
    const rawDb = new Database(":memory:");
    const first = new SqliteLocalStore(rawDb); // dispara la migración (manifest vacío).
    const defaultId = first.getActivePresetId();
    // Actividad real del usuario tras la migración: un preset nuevo.
    const extra = first.createPreset("Otro", []);

    // Reconstruir SqliteLocalStore sobre la MISMA base (p. ej. un reinicio de
    // la app): `presets` ya NO está vacía -> la migración debe ser un no-op.
    const second = new SqliteLocalStore(rawDb);

    expect(second.listPresets().map((p) => p.id).sort()).toEqual(
      [defaultId, extra.id].sort(),
    );
    expect(second.getActivePresetId()).toBe(defaultId);

    rawDb.close();
  });

  // ---------------------------------------------------------------------------
  // P-30, Paso 4.5a — reparación idempotente de una migración YA corrida (con
  // el Paso 1, ya pusheado) ANTES de esta corrección, que dejó "Principal" con
  // un id generado al azar en vez de "modsvs" (DECISIÓN 6-bis).
  // ---------------------------------------------------------------------------

  test("reparación: una base con 'Principal' en un id viejo (preset-xxxxx) se auto-repara a 'modsvs', sin duplicar ni perder datos", () => {
    const rawDb = new Database(":memory:");
    // Simula el ESTADO EXACTO que dejaba el Paso 1 (antes de esta corrección):
    // se construye un store, lo que corre la migración vieja con un id al
    // azar (acá, simplemente el que YA generaba `createPreset` antes del
    // fix — reproducido a mano insertando directo, para no depender de
    // código viejo que ya no existe).
    rawDb.exec(`
      CREATE TABLE presets (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE preset_entries (
        presetId TEXT NOT NULL, addonId TEXT NOT NULL, priorityOrder INTEGER NOT NULL,
        PRIMARY KEY (presetId, addonId)
      );
      CREATE TABLE active_preset (id INTEGER PRIMARY KEY CHECK (id = 1), presetId TEXT);
    `);
    const oldId = "preset-abc123";
    rawDb.prepare("INSERT INTO presets (id, name) VALUES (?, ?)").run(oldId, DEFAULT_PRESET_NAME);
    rawDb
      .prepare("INSERT INTO preset_entries (presetId, addonId, priorityOrder) VALUES (?, ?, ?)")
      .run(oldId, "111", 0);
    rawDb
      .prepare("INSERT INTO active_preset (id, presetId) VALUES (1, ?)")
      .run(oldId);

    // PRIMERA construcción de SqliteLocalStore sobre esta base YA migrada
    // (con el id viejo): `presets` NO está vacía -> dispara la REPARACIÓN,
    // no la migración desde cero.
    const repaired = new SqliteLocalStore(rawDb);

    // Sin duplicar: sigue habiendo UN solo preset.
    expect(repaired.listPresets()).toHaveLength(1);
    // El id quedó corregido a "modsvs"; el id viejo ya no existe.
    expect(repaired.getPreset(oldId)).toBeNull();
    const fixed = repaired.getPreset(DEFAULT_PRESET_FOLDER_ID);
    expect(fixed).toEqual({
      id: DEFAULT_PRESET_FOLDER_ID,
      name: DEFAULT_PRESET_NAME,
      // La tabla `presets` simulada arriba NO tenía columna `description`
      // (esquema previo a esta corrección): `#migratePresetDescriptionColumn`
      // la agrega vía ALTER TABLE ANTES de la reparación, así que la fila
      // reparada queda con `description = null` (columna nueva, sin valor).
      description: null,
      entries: [{ addonId: "111", priorityOrder: 0 }], // sin perder las entries que ya tenía
    });
    // El puntero de activo cascadeó al id nuevo (seguía apuntando al preset
    // "Principal", ahora bajo su id corregido).
    expect(repaired.getActivePresetId()).toBe(DEFAULT_PRESET_FOLDER_ID);

    rawDb.close();
  });

  test("reparación es IDEMPOTENTE: reconstruir sobre una base YA reparada no la vuelve a tocar", () => {
    const rawDb = new Database(":memory:");
    const first = new SqliteLocalStore(rawDb); // migración desde cero -> ya usa "modsvs".
    const second = new SqliteLocalStore(rawDb); // reconstrucción: #repairDefaultPresetFolder corre, pero no encuentra nada que reparar.

    expect(second.listPresets()).toHaveLength(1);
    expect(second.listPresets()[0]!.id).toBe(DEFAULT_PRESET_FOLDER_ID);
    expect(second.getActivePresetId()).toBe(first.getActivePresetId());

    rawDb.close();
  });
});

describe("LocalStore — onboarding (rediseño Paso 8/8, README 2e)", () => {
  test("getOnboardingSeen: false por defecto (base nueva, sin fila todavía)", () => {
    expect(store.getOnboardingSeen()).toBe(false);
  });

  test("markOnboardingSeen: queda en true, y llamarlo de nuevo no lo cambia (idempotente)", () => {
    store.markOnboardingSeen();
    expect(store.getOnboardingSeen()).toBe(true);
    store.markOnboardingSeen();
    expect(store.getOnboardingSeen()).toBe(true);
  });

  test("getTrustNoticesAcknowledged: false por defecto", () => {
    expect(store.getTrustNoticesAcknowledged()).toBe(false);
  });

  test("setTrustNoticesAcknowledged: round-trip true/false", () => {
    store.setTrustNoticesAcknowledged(true);
    expect(store.getTrustNoticesAcknowledged()).toBe(true);
    store.setTrustNoticesAcknowledged(false);
    expect(store.getTrustNoticesAcknowledged()).toBe(false);
  });

  test("los dos flags son INDEPENDIENTES: setear uno no toca el otro", () => {
    store.setTrustNoticesAcknowledged(true);
    expect(store.getOnboardingSeen()).toBe(false);

    store.markOnboardingSeen();
    expect(store.getTrustNoticesAcknowledged()).toBe(true); // no se pisó

    store.setTrustNoticesAcknowledged(false);
    expect(store.getOnboardingSeen()).toBe(true); // tampoco se pisó
  });

  test("persiste entre instancias sobre la MISMA base (no es solo estado en memoria)", () => {
    const rawDb = new Database(":memory:");
    const first = new SqliteLocalStore(rawDb);
    first.markOnboardingSeen();
    first.setTrustNoticesAcknowledged(true);

    const second = new SqliteLocalStore(rawDb);
    expect(second.getOnboardingSeen()).toBe(true);
    expect(second.getTrustNoticesAcknowledged()).toBe(true);

    rawDb.close();
  });
});
