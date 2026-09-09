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
 */

import type { Database } from "better-sqlite3";

import type { AddonManifestEntry, GamePaths } from "./types.js";

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
  /** Active_Set INSTALADO, en Priority_Order ascendente. */
  getManifest(): AddonManifestEntry[];
  /** Reemplaza el Active_Set instalado entero (transacción). */
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

/** DDL idempotente: crea las cuatro tablas si no existen (ver DECISIONES 3 y 5). */
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
