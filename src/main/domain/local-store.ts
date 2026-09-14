/**
 * LocalStore — persistencia del Active_Set y las rutas verificadas (Sección 15,
 * Requirement 8; AC 1.13, 8.1, 8.6; soporte de rehidratación del relanzo elevado
 * del Requirement 9.2).
 *
 * Responsabilidad única: persistir y recuperar (a) las `GamePaths` verificadas
 * (AC 1.13), (b) el Addon_Manifest instalado —el Active_Set actualmente aplicado,
 * como lista de `{ addonId, priorityOrder }` (AC 8.1, 8.6)— y (c) el ESTADO DE
 * SESIÓN PENDIENTE: el Active_Set CANDIDATO (selección + Priority_Order) que el
 * usuario tenía preparado en la UI ANTES de un relanzo elevado, para que la
 * instancia elevada rehidrate la vista leyéndolo del store y NO de la línea de
 * comando (AC 9.2). Esta Sección SOLO implementa el CICLO DE VIDA de ese estado
 * (guardar/leer/limpiar); su CONSUMO (persistir antes de `runas`, rehidratar al
 * arrancar elevado) es de la tarea 17 (ElevationService), que NO se toca aquí.
 *
 * El manifest NO registra archivos individuales por addon; solo
 * `{ addonId, priorityOrder }`, suficiente para reconstruir el Merged_Package
 * mediante una fusión completa desde cero (coherente con la arquitectura de
 * "fusión completa siempre" del design.md).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 1 — Motor de persistencia: SQLite vía `better-sqlite3` (JSON plano
 * descartado como alternativa).
 *
 * El design.md recomienda SQLite y deja JSON como alternativa "detrás de la misma
 * interfaz"; la decisión de usar SQLite ya fue TOMADA por el usuario. Motivos que
 * la sostienen: (a) transacciones atómicas al guardar el manifest/sesión (guardar
 * una lista completa reemplazando la anterior sin estados intermedios corruptos),
 * (b) API SÍNCRONA en el proceso main (encaja con el resto del dominio, que no es
 * async salvo el I/O de VpkTool), y (c) escala a las entidades de la Fase Posterior
 * (favoritos/presets/categorías, Req 11-13) sin reescribir el motor. JSON plano se
 * DESCARTA para esta implementación (sin atomicidad real, riesgo de corrupción en
 * escrituras concurrentes). La interfaz `LocalStore` queda igualmente desacoplada
 * del motor: un backend JSON alternativo podría implementarla en el futuro sin
 * tocar a los consumidores.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 2 — `Database` de better-sqlite3 INYECTADA por constructor (patrón
 * `CommandRunner`/`ProcessListProvider`/`*FileSystem` del resto del dominio).
 *
 * `SqliteLocalStore` NO abre el archivo por sí misma: recibe una instancia de
 * `Database` ya construida. En producción se le pasa `new Database(rutaArchivo)`
 * (un `.sqlite` en el userData de la app); en los tests se le pasa
 * `new Database(":memory:")`, una base REAL en memoria (no un mock a mano), de
 * modo que los property/unit tests ejerciten el MISMO código SQL que producción
 * sin tocar disco. El constructor ejecuta el DDL idempotente (`CREATE TABLE IF NOT
 * EXISTS`) para que un archivo nuevo/`:memory:` quede utilizable de inmediato.
 * Nota de empaquetado (test-time vs package-time): los tests corren bajo Node vía
 * Vitest, que comparte la ABI nativa con el Node del sistema, así que un
 * `npm install` normal basta para que `better-sqlite3` cargue en los tests SIN
 * `electron-rebuild`. `electron-rebuild` (`@electron/rebuild`, ya presente en las
 * devDependencies) solo hace falta al EMPAQUETAR la app, para recompilar el módulo
 * nativo contra la ABI del runtime de Electron. Esa distinción es la razón de que
 * la suite de tests pase sin rebuild.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 3 — Esquema SQL (el design.md deja el formato a criterio de
 * implementación).
 *
 * Tres tablas:
 *
 *   - `paths` (fila ÚNICA): una sola fila lógica con las `GamePaths`, fijada con
 *     `id INTEGER PRIMARY KEY CHECK (id = 1)`. Cada columna es una clave de
 *     `GamePaths` (`steamPath`, `gameRoot`, `left4dead2Dir`, `workshopFolder`,
 *     `vpkToolPath`, `gameInfoFile`, `modsvsFolder`), TODAS nullable para admitir
 *     el guardado PARCIAL (ver DECISIÓN 4). `getPaths()` devuelve `null` si la fila
 *     no existe o si NO están presentes las 7 rutas (un `GamePaths` incompleto no
 *     es un `GamePaths` válido).
 *
 *   - `manifest` (lista): el Active_Set INSTALADO. Columnas `(addonId TEXT PRIMARY
 *     KEY, priorityOrder INTEGER NOT NULL)`. `saveManifest` REEMPLAZA la lista
 *     entera (borra + inserta) dentro de una transacción; `getManifest` la lee
 *     ordenada por `priorityOrder` ascendente para un orden estable y determinista.
 *
 *   - `pending_session` (lista, SEPARADA del manifest instalado): el Active_Set
 *     CANDIDATO del relanzo elevado. Misma forma que `manifest`
 *     `(addonId TEXT PRIMARY KEY, priorityOrder INTEGER NOT NULL)` pero en su
 *     PROPIA tabla, para que el candidato pendiente y el instalado no se pisen:
 *     mientras hay una sesión pendiente, el manifest instalado sigue reflejando lo
 *     realmente aplicado. `savePendingSession` reemplaza la lista entera en una
 *     transacción; `clearPendingSession` la vacía; la DISTINCIÓN entre "no hay
 *     sesión" y "sesión activa vacía" NO se infiere de la cantidad de filas, sino
 *     de un flag de estado explícito (ver DECISIÓN 5).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 4 — Semántica de `savePaths(paths: Partial<GamePaths>)`: MERGE parcial
 * con lo ya guardado (NO reemplazo del registro entero).
 *
 * El tipo del parámetro es `Partial<GamePaths>`: el llamador puede suplir SOLO
 * algunas rutas (p. ej. el flujo de selección manual del PathDetector, AC
 * 1.10-1.12, resuelve una ruta faltante por vez y la persiste). Un reemplazo
 * entero borraría las rutas ya guardadas que no vengan en el objeto parcial, lo
 * que contradice la forma `Partial`. Por eso `savePaths` hace UPSERT columna por
 * columna: cada clave PRESENTE en el argumento sobrescribe su columna; las claves
 * AUSENTES conservan su valor previo (vía `COALESCE(nuevo, actual)`). Guardar
 * `{ steamPath }` no borra el `gameRoot` guardado antes. Esto también permite ir
 * acumulando rutas a medida que se resuelven, hasta que `getPaths()` pueda
 * devolver un `GamePaths` completo. `getPaths()` devuelve `null` en la primera
 * ejecución (sin nada guardado todavía).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 5 — `getPendingSession()` distingue `null` (no hay sesión) de `[]`
 * (sesión activa cuyo Active_Set candidato es vacío), vía un FLAG DE ESTADO
 * explícito, NO por la cantidad de filas de `pending_session`.
 *
 * El problema: contar filas NO alcanza para distinguir dos situaciones
 * semánticamente distintas que ambas dejan `pending_session` sin filas:
 *   - NUNCA se guardó una sesión (o se limpió con `clearPendingSession`): no hay
 *     nada que rehidratar tras un relanzo elevado.
 *   - Se guardó a propósito una sesión con Active_Set candidato VACÍO. Caso real:
 *     `MergeOrchestrator.removeAddon` sobre un Active_Set de tamaño 1 deja el
 *     candidato en `[]` justo antes de un relanzo elevado; la instancia elevada
 *     DEBE rehidratar ese "vacío intencional" (aplicar un Active_Set vacío), no
 *     interpretarlo como "no había sesión".
 *
 * Solución: una tabla de estado de UNA sola fila `pending_session_state
 * (id INTEGER PRIMARY KEY CHECK (id = 1), active INTEGER NOT NULL DEFAULT 0)`
 * que rastrea si hay una sesión pendiente ACTIVA, independiente de cuántas filas
 * tenga `pending_session`. Se eligió una tabla aparte (en vez de un flag en
 * `paths`) para no acoplar el ciclo de vida de la sesión pendiente al de las
 * rutas: son estados ortogonales (puede haber sesión pendiente sin rutas aún
 * completas, y viceversa) y mezclarlos en `paths` obligaría a que la fila de
 * rutas exista para poder marcar una sesión activa.
 *
 * Semántica observable resultante de `getPendingSession()`:
 *   - `null`  = no hay Active_Set candidato para rehidratar (nunca se guardó, o
 *               se limpió). `active = 0`.
 *   - `[]`    = hay una sesión ACTIVA y el Active_Set candidato es efectivamente
 *               vacío (el usuario quitó el último addon antes de relanzar). `active = 1`
 *               y `pending_session` sin filas.
 *   - lista con entradas = el Active_Set candidato tal cual se guardó. `active = 1`.
 *
 * `savePendingSession(entries)` marca `active = 1` SIEMPRE (incluso con `entries`
 * vacío); `clearPendingSession()` marca `active = 0` y vacía las filas.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 6 (P-30, Paso 1) — Presets: tablas SEPARADAS del `manifest`
 * INSTALADO, sin wiring todavía a GameInfoEditor/MergeOrchestrator/IPC/UI.
 *
 * Dos tablas nuevas mas un puntero de un solo valor:
 *
 *   - `presets` (id TEXT PRIMARY KEY, name TEXT NOT NULL): un preset por fila.
 *     `id` es el identificador TÉCNICO generado (`preset-<hex>`, ver
 *     `#generateUniquePresetId`), NUNCA derivado de `name` (ver {@link Preset}
 *     en `types.ts` para el motivo). `name` es la etiqueta editable.
 *
 *   - `preset_entries` (presetId TEXT, addonId TEXT, priorityOrder INTEGER,
 *     PRIMARY KEY (presetId, addonId)): el Active_Set de CADA preset, mismo
 *     shape que `manifest`/`pending_session` pero con `presetId` para poder
 *     tener muchos presets a la vez. `deletePreset` borra sus filas a mano
 *     dentro de una transacción (mismo criterio que `#replaceEntries`: sin FK
 *     `ON DELETE CASCADE`, `better-sqlite3` no fuerza `foreign_keys` por
 *     defecto y el resto del esquema ya resuelve la integridad a mano).
 *
 *   - `active_preset` (id INTEGER PRIMARY KEY CHECK (id = 1), presetId TEXT
 *     NULLABLE): fila única con el id del preset ACTIVO, o `NULL` si ninguno
 *     lo es todavía. A diferencia de `pending_session_state` (DECISIÓN 5), acá
 *     NO hace falta un flag de estado aparte: no existe una ambigüedad "activo
 *     con valor vacío" que distinguir de "sin activo" — `presetId` es un id de
 *     preset o no lo es, así que `NULL` alcanza como único significado de "sin
 *     preset activo".
 *
 * `deletePreset(id)` limpia también `active_preset.presetId` si apuntaba a
 * `id` (en la MISMA transacción), para que el puntero de activo nunca quede
 * apuntando a un preset borrado — invariante de integridad que le corresponde
 * a esta capa de persistencia, independiente de qué decida hacer la UI/el
 * orquestador (pasos posteriores) cuando el preset activo se borra.
 *
 * MIGRACIÓN (`#migrateActiveSetToDefaultPreset`, corre en el constructor,
 * después del DDL): antes de este cambio el único Active_Set vivía en
 * `manifest` sin ningún concepto de preset. Para no perder la selección
 * actual de nadie al actualizar, la PRIMERA vez que este esquema corre sobre
 * una base existente (`presets` vacía) copia el `manifest` ACTUAL a un preset
 * por defecto (`DEFAULT_PRESET_NAME`, "Principal") y lo marca ACTIVO.
 * Idempotente: si ya hay al menos un preset (migración ya corrida, o el
 * usuario ya creó uno), es un no-op. Corre incondicionalmente aunque
 * `manifest` esté vacío — un Active_Set vacío es un estado válido (mismo
 * criterio que la DECISIÓN 5 de `pending_session`), y preservarlo como un
 * preset "Principal" vacío es más correcto que omitir la migración. El
 * `manifest`/`saveManifest`/`getManifest` ORIGINALES NO se tocan ni se
 * eliminan en este paso: siguen siendo la única fuente real que consume el
 * MergeOrchestrator hasta que un paso posterior los reemplace por presets.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 7 (bug/feature post P-30 Paso 5) — `presets.description` (TEXT,
 * nullable): campo libre y OPCIONAL, agregado vía `ALTER TABLE` idempotente
 * (`#migratePresetDescriptionColumn`, corre ANTES de la migración de la
 * DECISIÓN 6 en el constructor) porque `CREATE TABLE IF NOT EXISTS` no altera
 * una tabla `presets` que ya existía de una versión previa de la app. Motivo
 * del campo: "Nuevo preset" (Paso 5) solo pedía un nombre vía `prompt()`, sin
 * forma de anotar para qué es cada preset — un modal real (renderer) lo
 * reemplaza y agrega este campo. Solo se CAPTURA y persiste por ahora, ver
 * {@link Preset}.
 */

import { randomUUID } from "node:crypto";

import type { Database } from "better-sqlite3";

import type { AddonManifestEntry, GamePaths, Preset } from "./types.js";

/**
 * Contrato de persistencia del Active_Set y las rutas (design.md, sección
 * LocalStore). Desacoplado del motor concreto: `SqliteLocalStore` es la
 * implementación SQLite; un backend JSON alternativo podría implementar la misma
 * interfaz sin tocar a los consumidores (orquestador tarea 18, ElevationService
 * tarea 17, capa IPC tarea 20).
 */
export interface LocalStore {
  /** Rutas verificadas persistidas, o `null` si aún no hay un `GamePaths` completo. */
  getPaths(): GamePaths | null;
  /** Guarda rutas de forma PARCIAL (merge con lo ya guardado; ver DECISIÓN 4). */
  savePaths(paths: Partial<GamePaths>): void;
  /**
   * @deprecated (P-30, Paso 4.5b) El Active_Set INSTALADO ya NO vive acá desde
   * que `MergeOrchestrator.applyActiveSet`/`addAddon`/`removeAddon` convergieron
   * hacia el preset ACTIVO (`preset_entries`, vía `getPreset`/
   * `updatePresetEntries`). `manifest` queda como dato HISTÓRICO/DE SOLO
   * LECTURA — nada vuelve a escribirle desde este cambio — solo se conserva
   * por si algo necesita el último valor pre-presets. Active_Set INSTALADO,
   * en Priority_Order ascendente.
   */
  getManifest(): AddonManifestEntry[];
  /**
   * @deprecated (P-30, Paso 4.5b) Ver `getManifest`: NADIE debe llamar esto
   * desde este cambio (ni `MergeOrchestrator` ni ningún handler IPC lo hacen
   * ya). Se conserva en la interfaz para no romper el contrato existente,
   * NO porque siga en uso. Reemplaza el Active_Set instalado entero (transacción).
   */
  saveManifest(entries: AddonManifestEntry[]): void;
  /**
   * Persiste el Active_Set CANDIDATO del relanzo elevado (transacción) y marca la
   * sesión pendiente como ACTIVA. Vale incluso con `entries` vacío: guardar `[]`
   * deja una sesión activa cuyo candidato es vacío (ver DECISIÓN 5).
   */
  savePendingSession(entries: AddonManifestEntry[]): void;
  /**
   * Active_Set candidato pendiente (ver DECISIÓN 5):
   *  - `null` si no hay sesión activa (nunca se guardó, o se limpió).
   *  - `[]` si hay sesión activa con candidato vacío (p. ej. se quitó el último addon).
   *  - la lista de entradas tal cual se guardó, en Priority_Order ascendente.
   */
  getPendingSession(): AddonManifestEntry[] | null;
  /** Vacía el estado de sesión pendiente y lo marca como INACTIVO. */
  clearPendingSession(): void;

  // -------------------------------------------------------------------------
  // Presets (P-30, Paso 1 — ver DECISIÓN 6). SIN wiring todavía a
  // GameInfoEditor/MergeOrchestrator/IPC/UI: solo la capa de persistencia.
  // -------------------------------------------------------------------------

  /** Todos los presets guardados, en orden de creación. */
  listPresets(): Preset[];
  /** Un preset por `id`, o `null` si no existe. */
  getPreset(id: string): Preset | null;
  /**
   * Crea un preset nuevo con un `id` TÉCNICO generado (nunca derivado de
   * `name`), las `entries` dadas y una `description` OPCIONAL (bug/feature
   * post P-30 Paso 5: ver {@link Preset}). `description` ausente o `null`
   * persiste `NULL`. Devuelve el {@link Preset} creado (incluido su `id`
   * nuevo, para que el llamador pueda usarlo de inmediato, p. ej. para
   * marcarlo activo).
   */
  createPreset(name: string, entries: AddonManifestEntry[], description?: string | null): Preset;
  /** Renombra un preset existente (no-op si `id` no existe). NO toca `entries`. */
  renamePreset(id: string, newName: string): void;
  /**
   * Borra un preset y sus entries (no-op si `id` no existe). Si `id` era el
   * preset ACTIVO, también limpia `active_preset` (ver DECISIÓN 6) para que
   * el puntero nunca quede apuntando a un preset inexistente.
   */
  deletePreset(id: string): void;
  /** `id` del preset ACTIVO, o `null` si ninguno lo es todavía. */
  getActivePresetId(): string | null;
  /**
   * Marca `id` como el preset ACTIVO. NO valida que `id` exista (mismo
   * criterio liviano que el resto del store, p. ej. `savePendingSession` no
   * valida `addonId` contra ningún catálogo).
   */
  setActivePresetId(id: string): void;
  /**
   * Reemplaza las `entries` de un preset EXISTENTE entero (P-30, Paso 4.5b;
   * mismo criterio de reemplazo TOTAL que el `saveManifest` deprecado, pero
   * scoped a UN preset). NO-op sobre un `id` inexistente (mismo criterio
   * liviano que `renamePreset`/`deletePreset`: el llamador real,
   * `MergeOrchestrator`, siempre resuelve el preset activo con `getPreset`
   * ANTES de llegar acá, así que en la práctica `id` ya viene validado).
   */
  updatePresetEntries(id: string, entries: AddonManifestEntry[]): void;
}

/** Claves de `GamePaths` en orden estable; una columna por cada una en la tabla `paths`. */
const GAME_PATH_KEYS = [
  "steamPath",
  "gameRoot",
  "left4dead2Dir",
  "workshopFolder",
  "vpkToolPath",
  "gameInfoFile",
  "modsvsFolder",
] as const satisfies readonly (keyof GamePaths)[];

// Assert de exhaustividad en compile-time: si `GamePaths` gana/pierde una clave y
// `GAME_PATH_KEYS` no se actualiza, este tipo resuelve a `never` y el typecheck falla.
type AssertPathKeysExhaustive<Keys extends readonly (keyof GamePaths)[]> =
  [keyof GamePaths] extends [Keys[number]] ? true : never;
const _pathKeysExhaustive: AssertPathKeysExhaustive<typeof GAME_PATH_KEYS> = true;
void _pathKeysExhaustive;

/** Nombre del preset por defecto que crea la migración (P-30, DECISIÓN 6). */
export const DEFAULT_PRESET_NAME = "Principal";

/**
 * Id TÉCNICO (= carpeta de fusión) FIJO del preset por defecto (P-30, Paso
 * 4.5a, DECISIÓN 6-bis): `"modsvs"`, la carpeta que YA usaba toda instalación
 * existente antes de que existieran los presets. NO sigue el formato
 * `preset-<hex>` de `#generateUniquePresetId` a propósito, para que converger
 * `addAddon`/`removeAddon`/`applyActiveSet` hacia el preset activo sea
 * transparente (nada se re-fusiona ni se mueve en disco) para cualquier
 * instalación que nunca creó un preset adicional.
 */
export const DEFAULT_PRESET_FOLDER_ID = "modsvs";

/** DDL idempotente: crea las siete tablas si no existen (ver DECISIONES 3, 5 y 6). */
const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS paths (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  steamPath TEXT,
  gameRoot TEXT,
  left4dead2Dir TEXT,
  workshopFolder TEXT,
  vpkToolPath TEXT,
  gameInfoFile TEXT,
  modsvsFolder TEXT
);
CREATE TABLE IF NOT EXISTS manifest (
  addonId TEXT PRIMARY KEY,
  priorityOrder INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_session (
  addonId TEXT PRIMARY KEY,
  priorityOrder INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_session_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preset_entries (
  presetId TEXT NOT NULL,
  addonId TEXT NOT NULL,
  priorityOrder INTEGER NOT NULL,
  PRIMARY KEY (presetId, addonId)
);
CREATE TABLE IF NOT EXISTS active_preset (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  presetId TEXT
);
`;

/**
 * Implementación SQLite de {@link LocalStore} sobre una `Database` de
 * `better-sqlite3` INYECTADA (ver DECISIÓN 2). El constructor asegura el esquema
 * (DDL idempotente) para que una base nueva o `:memory:` sea utilizable enseguida.
 */
export class SqliteLocalStore implements LocalStore {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
    this.#db.exec(SCHEMA_DDL);
    this.#migratePresetDescriptionColumn();
    this.#migrateActiveSetToDefaultPreset();
  }

  getPaths(): GamePaths | null {
    const row = this.#db
      .prepare<[], Record<keyof GamePaths, string | null>>(
        "SELECT steamPath, gameRoot, left4dead2Dir, workshopFolder, vpkToolPath, gameInfoFile, modsvsFolder FROM paths WHERE id = 1",
      )
      .get();
    if (row === undefined) return null;
    // Un GamePaths incompleto no es válido: si falta cualquiera de las 7 rutas,
    // se devuelve null (aún no hay rutas completas persistidas).
    const result = {} as GamePaths;
    for (const key of GAME_PATH_KEYS) {
      const value = row[key];
      if (value === null || value === undefined) return null;
      result[key] = value;
    }
    return result;
  }

  savePaths(paths: Partial<GamePaths>): void {
    // UPSERT columna por columna con COALESCE: cada clave presente sobrescribe su
    // columna; las ausentes conservan el valor previo (MERGE parcial, DECISIÓN 4).
    const values: Record<string, string | null> = {};
    for (const key of GAME_PATH_KEYS) {
      values[key] = key in paths ? (paths[key] ?? null) : null;
    }
    this.#db
      .prepare(
        `INSERT INTO paths (id, steamPath, gameRoot, left4dead2Dir, workshopFolder, vpkToolPath, gameInfoFile, modsvsFolder)
         VALUES (1, @steamPath, @gameRoot, @left4dead2Dir, @workshopFolder, @vpkToolPath, @gameInfoFile, @modsvsFolder)
         ON CONFLICT(id) DO UPDATE SET
           steamPath = COALESCE(@steamPath, steamPath),
           gameRoot = COALESCE(@gameRoot, gameRoot),
           left4dead2Dir = COALESCE(@left4dead2Dir, left4dead2Dir),
           workshopFolder = COALESCE(@workshopFolder, workshopFolder),
           vpkToolPath = COALESCE(@vpkToolPath, vpkToolPath),
           gameInfoFile = COALESCE(@gameInfoFile, gameInfoFile),
           modsvsFolder = COALESCE(@modsvsFolder, modsvsFolder)`,
      )
      .run(values);
  }

  getManifest(): AddonManifestEntry[] {
    return this.#readEntries("manifest");
  }

  saveManifest(entries: AddonManifestEntry[]): void {
    this.#replaceEntries("manifest", entries);
  }

  savePendingSession(entries: AddonManifestEntry[]): void {
    // Reemplaza las filas del candidato y marca la sesión como ACTIVA en la MISMA
    // transacción (atómico): filas + flag no pueden quedar desincronizados. Vale
    // con `entries` vacío -> sesión activa con candidato [] (ver DECISIÓN 5).
    const del = this.#db.prepare("DELETE FROM pending_session");
    const ins = this.#db.prepare(
      "INSERT INTO pending_session (addonId, priorityOrder) VALUES (@addonId, @priorityOrder)",
    );
    const setActive = this.#db.prepare(
      "INSERT INTO pending_session_state (id, active) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET active = 1",
    );
    const tx = this.#db.transaction((rows: AddonManifestEntry[]) => {
      del.run();
      for (const row of rows) ins.run(row);
      setActive.run();
    });
    tx(entries);
  }

  getPendingSession(): AddonManifestEntry[] | null {
    // El flag de estado —NO la cantidad de filas— decide null vs []: null si no
    // hay sesión activa; si la hay, se devuelven las filas tal cual (que pueden
    // ser [] cuando el candidato es intencionalmente vacío). Ver DECISIÓN 5.
    if (!this.#isPendingSessionActive()) return null;
    return this.#readEntries("pending_session");
  }

  clearPendingSession(): void {
    // Vacía el candidato y marca la sesión como INACTIVA, en la misma transacción.
    const del = this.#db.prepare("DELETE FROM pending_session");
    const setInactive = this.#db.prepare(
      "INSERT INTO pending_session_state (id, active) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET active = 0",
    );
    const tx = this.#db.transaction(() => {
      del.run();
      setInactive.run();
    });
    tx();
  }

  // ---------------------------------------------------------------------------
  // Presets (P-30, Paso 1 — ver DECISIÓN 6).
  // ---------------------------------------------------------------------------

  listPresets(): Preset[] {
    // `rowid` (implícito, la tabla no es WITHOUT ROWID) da el orden de
    // INSERCIÓN de forma estable; `id` es hex aleatorio y no serviría para
    // ordenar de forma significativa.
    const rows = this.#db
      .prepare<[], { id: string; name: string; description: string | null }>(
        "SELECT id, name, description FROM presets ORDER BY rowid ASC",
      )
      .all();
    return rows.map((row) => ({ ...row, entries: this.#readPresetEntries(row.id) }));
  }

  getPreset(id: string): Preset | null {
    const row = this.#db
      .prepare<[string], { id: string; name: string; description: string | null }>(
        "SELECT id, name, description FROM presets WHERE id = ?",
      )
      .get(id);
    if (row === undefined) return null;
    return { ...row, entries: this.#readPresetEntries(id) };
  }

  createPreset(name: string, entries: AddonManifestEntry[], description?: string | null): Preset {
    return this.#insertPresetRow(this.#generateUniquePresetId(), name, entries, description ?? null);
  }

  renamePreset(id: string, newName: string): void {
    this.#db.prepare("UPDATE presets SET name = ? WHERE id = ?").run(newName, id);
  }

  updatePresetEntries(id: string, entries: AddonManifestEntry[]): void {
    // Reemplazo TOTAL (borra + inserta), mismo patrón que `#replaceEntries`
    // (manifest/pending_session) pero con `presetId` fijo por fila.
    const del = this.#db.prepare("DELETE FROM preset_entries WHERE presetId = ?");
    const ins = this.#db.prepare(
      "INSERT INTO preset_entries (presetId, addonId, priorityOrder) VALUES (@presetId, @addonId, @priorityOrder)",
    );
    const tx = this.#db.transaction((rows: AddonManifestEntry[]) => {
      del.run(id);
      for (const row of rows) ins.run({ presetId: id, ...row });
    });
    tx(entries);
  }

  deletePreset(id: string): void {
    // Borra el preset + sus entries y, en la MISMA transacción, limpia el
    // puntero de activo SI apuntaba a este `id` (ver DECISIÓN 6): evita que
    // `active_preset` quede referenciando un preset que ya no existe. Las
    // tres sentencias son no-op silencioso si `id` no existe o no era el activo.
    const delEntries = this.#db.prepare("DELETE FROM preset_entries WHERE presetId = ?");
    const delPreset = this.#db.prepare("DELETE FROM presets WHERE id = ?");
    const clearActiveIfMatches = this.#db.prepare(
      "UPDATE active_preset SET presetId = NULL WHERE id = 1 AND presetId = ?",
    );
    const tx = this.#db.transaction((presetId: string) => {
      delEntries.run(presetId);
      delPreset.run(presetId);
      clearActiveIfMatches.run(presetId);
    });
    tx(id);
  }

  getActivePresetId(): string | null {
    const row = this.#db
      .prepare<[], { presetId: string | null }>("SELECT presetId FROM active_preset WHERE id = 1")
      .get();
    return row === undefined ? null : row.presetId;
  }

  setActivePresetId(id: string): void {
    this.#db
      .prepare(
        "INSERT INTO active_preset (id, presetId) VALUES (1, @id) ON CONFLICT(id) DO UPDATE SET presetId = @id",
      )
      .run({ id });
  }

  /**
   * MIGRACIÓN (P-30, Paso 1; ver DECISIÓN 6): copia el `manifest` ACTUAL a un
   * preset por defecto (`DEFAULT_PRESET_NAME`) y lo marca ACTIVO, SOLO la
   * primera vez que este esquema corre sobre una base sin presets todavía
   * (`presets` vacía). NO toca `manifest` (sigue siendo la fuente real hasta
   * un paso posterior que la reemplace por presets).
   *
   * DECISIÓN 6-bis (P-30, Paso 4.5a) — el id de "Principal" es el literal FIJO
   * `DEFAULT_PRESET_FOLDER_ID` ("modsvs"), NO uno generado al azar.
   *
   * Converger `addAddon`/`removeAddon`/`applyActiveSet` hacia el preset activo
   * (Paso 4.5b) significa que su carpeta técnica de fusión pasa a ser
   * `preset.id` (ya parametrizado desde el Paso 2). Si "Principal" tuviera un
   * `id` generado al azar como cualquier otro preset, la PRIMERA vez que
   * cualquier instalación EXISTENTE tocara un addon, la app re-fusionaría TODO
   * hacia esa carpeta nueva y reescribiría gameinfo.txt — una operación
   * pesada y sorpresiva que nadie pidió, para una instalación que ya tenía
   * todo funcionando en `modsvs`.
   *
   * Se evaluó separar `id` (identidad estable para las FK implícitas de
   * `preset_entries`/`active_preset`, sin FK declarada — ver DECISIÓN 3) de un
   * campo `folderName` aparte, pero se descartó: `id` YA es opaco (nunca se
   * deriva de `name`, ver {@link Preset}) y NINGÚN código lo trata como un
   * patrón fijo `preset-<hex>` — es un string cualquiera. Fijarlo en
   * `"modsvs"` para ESTE preset puntual logra el mismo resultado
   * (`destFolder`/`gameInfoFolderName` = `"modsvs"` sin ningún cambio en
   * `merge-orchestrator.ts`) sin agregar una columna nueva, sin tocar el tipo
   * `Preset` ni ningún consumidor: la MENOR fricción posible con lo ya
   * construido. `#generateUniquePresetId` nunca produce `"modsvs"` (su formato
   * es siempre `preset-<hex>`), así que no hay riesgo de colisión futura.
   *
   * IDEMPOTENCIA + REPARACIÓN: si `presets` YA tiene filas (el Paso 1 —ya
   * pusheado— pudo haber corrido esta migración ANTES de esta corrección,
   * dejando "Principal" con un id al azar), se delega en
   * `#repairDefaultPresetFolder` para corregir ESA fila puntual in-place, en
   * vez de crear una fila nueva (evita duplicar "Principal").
   */
  #migrateActiveSetToDefaultPreset(): void {
    const row = this.#db
      .prepare<[], { count: number }>("SELECT COUNT(*) as count FROM presets")
      .get();
    if (row !== undefined && row.count > 0) {
      this.#repairDefaultPresetFolder();
      return;
    }
    const preset = this.#insertPresetRow(
      DEFAULT_PRESET_FOLDER_ID,
      DEFAULT_PRESET_NAME,
      this.getManifest(),
      null,
    );
    this.setActivePresetId(preset.id);
  }

  /**
   * Migración idempotente de esquema (bug/feature post P-30 Paso 5): agrega
   * la columna `presets.description` (TEXT, nullable) si todavía no existe.
   * `CREATE TABLE IF NOT EXISTS` (SCHEMA_DDL) NO alcanza para esto — no
   * modifica una tabla que ya existía de una versión anterior de la app, solo
   * crea la tabla si falta por completo — así que hace falta un `ALTER TABLE`
   * aparte, guardado detrás de un chequeo `PRAGMA table_info` para no
   * relanzarlo en cada arranque (SQLite no tiene `ADD COLUMN IF NOT EXISTS`).
   * Mismo criterio de migración idempotente que `#repairDefaultPresetFolder`
   * (Paso 4.5a): corre SIEMPRE en el constructor, es un no-op si la columna ya
   * está, y no requiere que el usuario haga nada. Las filas existentes quedan
   * con `description = NULL` (comportamiento default de `ALTER TABLE ... ADD
   * COLUMN` sin `DEFAULT`), que es exactamente la semántica de "sin
   * descripción" que ya usa el resto del campo (ver {@link Preset}).
   */
  #migratePresetDescriptionColumn(): void {
    const columns = this.#db.prepare<[], { name: string }>("PRAGMA table_info(presets)").all();
    const hasDescription = columns.some((col) => col.name === "description");
    if (!hasDescription) {
      this.#db.exec("ALTER TABLE presets ADD COLUMN description TEXT");
    }
  }

  /**
   * Reparación idempotente (P-30, Paso 4.5a, ver DECISIÓN 6-bis): si esta base
   * ya corrió la migración ANTES de esta corrección, "Principal" quedó con un
   * `id` generado al azar en vez de `DEFAULT_PRESET_FOLDER_ID`. Este método
   * cambia el `id` de ESA fila puntual a `"modsvs"` — CASCADEANDO a mano a
   * `preset_entries.presetId`/`active_preset.presetId` (sin FK declarada, ver
   * DECISIÓN 3, así que SQLite no lo hace solo) en la MISMA transacción — sin
   * duplicar filas ni perder las entries que ya tuviera.
   *
   * Identifica la fila por `name = DEFAULT_PRESET_NAME` (mismo criterio
   * explícito que pidió la tarea): best-effort para el único caso real que
   * puede existir (el propio "Principal" que dejó la migración original), no
   * una garantía sobre cualquier preset que el usuario haya nombrado
   * "Principal" a mano después con otro propósito. No-op si no hay ninguna
   * fila así, o si ya está reparada (`id === DEFAULT_PRESET_FOLDER_ID`).
   */
  #repairDefaultPresetFolder(): void {
    const row = this.#db
      .prepare<[string, string], { id: string }>("SELECT id FROM presets WHERE name = ? AND id != ?")
      .get(DEFAULT_PRESET_NAME, DEFAULT_PRESET_FOLDER_ID);
    if (row === undefined) return; // ya reparada, o nunca corrió con un id viejo

    const oldId = row.id;
    const tx = this.#db.transaction(() => {
      this.#db
        .prepare("UPDATE preset_entries SET presetId = ? WHERE presetId = ?")
        .run(DEFAULT_PRESET_FOLDER_ID, oldId);
      this.#db
        .prepare("UPDATE active_preset SET presetId = ? WHERE presetId = ?")
        .run(DEFAULT_PRESET_FOLDER_ID, oldId);
      this.#db.prepare("UPDATE presets SET id = ? WHERE id = ?").run(DEFAULT_PRESET_FOLDER_ID, oldId);
    });
    tx();
  }

  /**
   * INSERT crudo de un preset con `id` YA DECIDIDO por el llamador. Compartido
   * por `createPreset` (id generado, `#generateUniquePresetId`) y la
   * migración (id fijo `DEFAULT_PRESET_FOLDER_ID` para "Principal", ver
   * DECISIÓN 6-bis) — un solo lugar arma la transacción INSERT preset +
   * entries, para que ambos caminos no puedan desincronizarse. `description`
   * es explícito (no opcional acá): los dos llamadores ya saben si tienen una
   * o no (`createPreset` normaliza `undefined` a `null`; la migración siempre
   * pasa `null`), así que no hace falta un segundo default en este nivel.
   */
  #insertPresetRow(
    id: string,
    name: string,
    entries: readonly AddonManifestEntry[],
    description: string | null,
  ): Preset {
    const insertPreset = this.#db.prepare(
      "INSERT INTO presets (id, name, description) VALUES (@id, @name, @description)",
    );
    const insertEntry = this.#db.prepare(
      "INSERT INTO preset_entries (presetId, addonId, priorityOrder) VALUES (@presetId, @addonId, @priorityOrder)",
    );
    const tx = this.#db.transaction((rows: readonly AddonManifestEntry[]) => {
      insertPreset.run({ id, name, description });
      for (const row of rows) insertEntry.run({ presetId: id, ...row });
    });
    tx(entries);
    return { id, name, description, entries: [...entries] };
  }

  /** Lee las entries de un preset, en Priority_Order ascendente. */
  #readPresetEntries(presetId: string): AddonManifestEntry[] {
    return this.#db
      .prepare<[string], AddonManifestEntry>(
        "SELECT addonId, priorityOrder FROM preset_entries WHERE presetId = ? ORDER BY priorityOrder ASC, addonId ASC",
      )
      .all(presetId);
  }

  /**
   * Genera un id TÉCNICO único (`preset-<hex de 6>`, ver {@link Preset}),
   * re-generando ante una colisión (estadísticamente casi imposible con pocos
   * presets, pero se verifica en vez de asumirlo). Nunca deriva de `name`.
   */
  #generateUniquePresetId(): string {
    for (;;) {
      const candidate = `preset-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
      const exists = this.#db.prepare<[string], { id: string }>("SELECT id FROM presets WHERE id = ?").get(candidate);
      if (exists === undefined) return candidate;
    }
  }

  /** `true` si hay una sesión pendiente ACTIVA (flag de estado; ver DECISIÓN 5). */
  #isPendingSessionActive(): boolean {
    const row = this.#db
      .prepare<[], { active: number }>(
        "SELECT active FROM pending_session_state WHERE id = 1",
      )
      .get();
    return row !== undefined && row.active === 1;
  }

  /** Lee una tabla de entradas (manifest | pending_session) ordenada por priorityOrder ascendente. */
  #readEntries(table: "manifest" | "pending_session"): AddonManifestEntry[] {
    return this.#db
      .prepare<[], AddonManifestEntry>(
        `SELECT addonId, priorityOrder FROM ${table} ORDER BY priorityOrder ASC, addonId ASC`,
      )
      .all();
  }

  /** Reemplaza la lista entera de una tabla (borra + inserta) dentro de una transacción. */
  #replaceEntries(table: "manifest" | "pending_session", entries: AddonManifestEntry[]): void {
    const del = this.#db.prepare(`DELETE FROM ${table}`);
    const ins = this.#db.prepare(
      `INSERT INTO ${table} (addonId, priorityOrder) VALUES (@addonId, @priorityOrder)`,
    );
    const tx = this.#db.transaction((rows: AddonManifestEntry[]) => {
      del.run();
      for (const row of rows) ins.run(row);
    });
    tx(entries);
  }
}
