/**
 * Tipos de dominio compartidos del L4D2 Versus Addon Manager.
 *
 * Este módulo concentra las firmas EXACTAS derivadas del design.md (Núcleo
 * Validado, Requisitos 1-9). Es la fuente de verdad de las estructuras de datos
 * que atraviesan las capas (dominio, aplicación/orquestación, IPC/preload).
 *
 * Nota de scope (Tarea 1): aquí SOLO viven los tipos. La implementación de los
 * componentes (PathDetector, VpkTool, MergeEngine, etc.) corresponde a tareas
 * posteriores.
 */

// ---------------------------------------------------------------------------
// Requirement 1 — Detección de rutas (PathDetector)
// ---------------------------------------------------------------------------

/**
 * Conjunto de rutas de Steam y de la instalación de L4D2, derivadas y
 * verificadas contra disco. Todas son rutas absolutas en formato Windows.
 */
export interface GamePaths {
  steamPath: string;
  /** `<lib>\steamapps\common\Left 4 Dead 2` */
  gameRoot: string;
  /** `<gameRoot>\left4dead2` */
  left4dead2Dir: string;
  /** `<left4dead2Dir>\addons\workshop` */
  workshopFolder: string;
  /** `<gameRoot>\bin\vpk.exe` */
  vpkToolPath: string;
  /** `<left4dead2Dir>\gameinfo.txt` */
  gameInfoFile: string;
  /** `<left4dead2Dir>\modsvs` */
  modsvsFolder: string;
}

/**
 * Entrada parseada de `libraryfolders.vdf` (formato KeyValues de Valve).
 *
 * Decisión de representación (documentada): el diseño solo necesita, por
 * biblioteca, (a) su `path` en disco y (b) el conjunto de AppIDs presentes en
 * su bloque `apps`, para poder seleccionar la primera biblioteca que contiene
 * la clave `550` (L4D2) en orden de aparición (AC 1.5). Por eso `apps` se
 * modela como un `string[]` de AppIDs (las claves del bloque `apps`), que es la
 * información mínima suficiente. El orden del array preserva el orden de
 * aparición en el archivo, coherente con la selección "primera biblioteca".
 */
export interface LibraryEntry {
  /** Ruta en disco de la biblioteca (puede estar en otro disco que Steam). */
  path: string;
  /** AppIDs presentes en el bloque `apps` de esta biblioteca (p. ej. "550"). */
  apps: string[];
}

/**
 * Claves de `GamePaths` que el AC 1.9 enumera como REQUERIDAS de verificar en
 * disco: `gameRoot`, `workshopFolder`, `vpkToolPath`, `gameInfoFile` y
 * `modsvsFolder`.
 *
 * Se modela como un subconjunto tipado de las claves de {@link GamePaths} (no un
 * `string` libre) para que `verifyPathsOnDisk` y `detect` (tarea 5.3) no puedan
 * referirse a un rol de ruta inexistente y para que, ante cualquier cambio de
 * `GamePaths`, el compilador obligue a revisar qué rutas se verifican. `steamPath`
 * y `left4dead2Dir` NO están aquí: el AC 1.9 no los lista como requeridos (ver la
 * DECISIÓN documentada en el historial 2026-09-05, tarea 5.3).
 */
export type RequiredPathKey =
  | "gameRoot"
  | "workshopFolder"
  | "vpkToolPath"
  | "gameInfoFile"
  | "modsvsFolder";

/**
 * Resultado de verificar en disco las rutas REQUERIDAS de un {@link GamePaths}
 * (AC 1.9).
 *
 * DECISIÓN DE FORMA (documentada): NO se usa un booleano global. `detect` (AC
 * 1.10) necesita saber QUÉ ruta específica falta para ofrecer la selección
 * manual de ESA ruta y no de todas; un simple `boolean` perdería esa
 * información. Por eso el núcleo es `present`, un mapa ruta→existencia con una
 * entrada por CADA {@link RequiredPathKey} (todas presentes en el objeto; el
 * valor dice si existe o no). De ahí se derivan dos conveniencias:
 *
 *  - `missing`: la lista de claves cuyo `present[key] === false`, en el orden de
 *    {@link RequiredPathKey}, para que `detect` recorra e itere las rutas a pedir.
 *  - `allPresent`: `true` si y solo si `missing.length === 0` (ninguna falta).
 *
 * `allPresent` es el ÚNICO predicado que habilita construir el estado "listo para
 * persistir" de {@link PathDetectionResult} (ver invariante allí): así se hace
 * estructuralmente imposible marcar rutas como persistibles sin una verificación
 * en disco cuyas rutas requeridas estén TODAS presentes.
 *
 * Se usa `Record<RequiredPathKey, boolean>` (todas las claves obligatorias) en
 * vez de un mapa parcial, para que el compilador garantice que se verificó CADA
 * ruta requerida —no se puede "olvidar" una— antes de derivar `allPresent`.
 */
export interface PathVerification {
  /** Existencia en disco de cada ruta requerida (una entrada por clave). */
  present: Record<RequiredPathKey, boolean>;
  /** Claves cuyas rutas NO existen en disco, en orden de {@link RequiredPathKey}. */
  missing: RequiredPathKey[];
  /** `true` solo si todas las rutas requeridas existen (`missing` vacío). */
  allPresent: boolean;
}

/**
 * Cómo se llegó a un {@link GamePaths}: por detección automática (registro +
 * `libraryfolders.vdf`) o porque el usuario suplió al menos una ruta manualmente
 * tras un fallo de la detección (AC 1.10–1.12). Útil para que la UI comunique el
 * origen y para trazabilidad.
 */
export type PathDetectionSource = "auto" | "manual";

/**
 * Motivo por el que la detección AUTOMÁTICA no pudo completarse por sí sola y
 * requiere selección manual. Cada variante mapea 1:1 con un AC de fallo del
 * Requirement 1 y dice al orquestador/UI QUÉ selección manual ofrecer:
 *
 *  - `steam-not-installed` (AC 1.2): falta la clave/valor del registro →
 *    selección manual del Steam_Path.
 *  - `library-folders-unreadable` (AC 1.4): `libraryfolders.vdf` ausente,
 *    ilegible o KeyValues malformado → selección manual del Game_Root.
 *  - `l4d2-not-in-libraries` (AC 1.6): ninguna biblioteca contiene `550` →
 *    selección manual del Game_Root.
 *  - `required-path-missing` (AC 1.10): la detección llegó a derivar rutas pero
 *    una o más rutas requeridas no existen en disco → selección manual de esas
 *    rutas.
 */
export type PathDetectionFailureReason =
  | "steam-not-installed"
  | "library-folders-unreadable"
  | "l4d2-not-in-libraries"
  | "required-path-missing";

/**
 * Resultado del flujo completo de `PathDetector.detect()` (AC 1.1–1.12).
 *
 * DECISIÓN DE FORMA (documentada): se modela como UNIÓN DISCRIMINADA por `kind`,
 * siguiendo el estilo de `OperationResult`/`ElevationOutcome` de este módulo.
 * Motivo: el flujo tiene caminos cualitativamente distintos (rutas listas vs.
 * distintos modos de fallo que piden selecciones manuales distintas y vs.
 * cancelación del usuario), y cada uno acarrea datos diferentes. Una unión
 * discriminada obliga al consumidor (orquestador/IPC, tarea 20) a manejar cada
 * caso explícitamente y evita campos "válidos a veces".
 *
 *  - `kind: "ready"` — RUTAS LISTAS PARA PERSISTIR. Es el ÚNICO estado que
 *    representa un `GamePaths` verificado y persistible. INVARIANTE ESTRUCTURAL
 *    (lo prueba la tarea 5.4 / Property 2): esta variante SOLO puede construirse
 *    a partir de un {@link PathVerification} con `allPresent === true`. Por eso
 *    lleva embebido el `verification` que la respalda: no existe un `ready` sin
 *    su verificación exitosa adjunta. El constructor `pathsReady` (path-detector.ts)
 *    es el único camino de código que la produce y valida `allPresent` antes de
 *    hacerlo; no hay otra forma de fabricar un `ready`. `source` indica si las
 *    rutas vinieron de detección automática o de selección manual (ambas pasan
 *    por la MISMA verificación en disco antes de llegar a `ready`).
 *    NOTA: la PERSISTENCIA en sí (LocalStore.savePaths, AC 1.13) NO ocurre aquí;
 *    es de una tarea posterior. `ready` solo significa "verificado y apto para
 *    que el orquestador lo persista".
 *
 *  - `kind: "needs-manual"` — la detección no pudo completarse automáticamente y
 *    se agotaron/rechazaron las oportunidades de selección manual, o el usuario
 *    canceló. Lleva el `reason` (qué falló, AC 1.2/1.4/1.6/1.10) para que la UI
 *    informe el motivo y ofrezca la selección manual pertinente. `paths` y
 *    `verification` son opcionales: se incluyen cuando el fallo ocurrió después
 *    de derivar rutas (`required-path-missing`), aportando qué rutas faltaban.
 */
export type PathDetectionResult =
  | {
      kind: "ready";
      paths: GamePaths;
      verification: PathVerification;
      source: PathDetectionSource;
    }
  | {
      kind: "needs-manual";
      reason: PathDetectionFailureReason;
      /** Rutas derivadas hasta el punto del fallo, si ya se habían derivado. */
      paths?: GamePaths;
      /** Verificación que reveló las rutas faltantes, si aplica. */
      verification?: PathVerification;
    };

// ---------------------------------------------------------------------------
// Requirement 2 — Escaneo de la Workshop_Folder (AddonScanner)
// ---------------------------------------------------------------------------

/**
 * Metadata opcional leída del `addoninfo.txt` interno del VPK. Su lectura no
 * bloquea el escaneo si falta o falla (AC 2.5).
 *
 * Nota (AC 3.4): esta forma NO expone `addonContent_Script`. La clasificación
 * VScript se hace SIEMPRE inspeccionando el listado real del VPK, nunca ese flag.
 */
export interface AddonInfo {
  title?: string;
  author?: string;
  description?: string;
}

/**
 * Un addon detectado en la Workshop_Folder. `<id>.vpk` se trata como Addon `<id>`.
 */
export interface ScannedAddon {
  /** `<id>` extraído del nombre de archivo `<id>.vpk`. */
  id: string;
  vpkPath: string;
  /** Ruta de `<id>.jpg` junto al VPK si existe; `null` en caso contrario. */
  coverPath: string | null;
  /** Metadata leída del `addoninfo.txt` interno; `null` si no disponible. */
  info: AddonInfo | null;
}

// ---------------------------------------------------------------------------
// Requirement 3 — Clasificación VScript (VScriptDetector)
// ---------------------------------------------------------------------------

/**
 * Resultado de clasificar un addon como incompatible con Versus por contener
 * VScripts.
 *
 * - `nut-in-vscripts`: se halló un `.nut` bajo `scripts/vscripts/` (VScript_Addon).
 * - `listing-failed`: `vpk l` falló; se clasifica como VScript_Addon por precaución (AC 3.5).
 * - `clean`: no hay `.nut` bajo `scripts/vscripts/`; el addon es apto.
 */
export interface VScriptClassification {
  addonId: string;
  isVScriptAddon: boolean;
  reason: "nut-in-vscripts" | "listing-failed" | "clean";
}

// ---------------------------------------------------------------------------
// Requirement 7 / 6 — Fusión y resolución de colisiones
// ---------------------------------------------------------------------------

/** Carpeta raíz donde quedó extraído el contenido de un addon. */
export interface ExtractedRoot {
  addonId: string;
  rootDir: string;
}

/** Una colisión de archivos entre addons y su ganador según Priority_Order. */
export interface FileCollision {
  relativePath: string;
  /** addonIds que aportaron un archivo en esta ruta relativa. */
  contributors: string[];
  /** addonId cuyo archivo prevaleció ("el último del Priority_Order gana"). */
  winner: string;
}

/** Reporte de la fusión: colisiones detectadas durante el merge. */
export interface MergeReport {
  collisions: FileCollision[];
}

// ---------------------------------------------------------------------------
// Requirement 5 — Backup automatico (BackupManager)
// ---------------------------------------------------------------------------

/**
 * Resultado de {@link BackupManager.backupExisting} (Requirement 5; AC 5.1,
 * 5.2, 5.3).
 *
 * DECISION DE FORMA (documentada, ver DECISION 1 en `backup-manager.ts`): union
 * discriminada por `created`, SIN campo `ok`. Los fallos de la operacion de
 * backup se propagan SIEMPRE por `throw` (AC 5.2: si la creacion del Backup
 * falla, el orquestador aborta), por lo que NUNCA hay una rama de "error
 * controlado" en el retorno. Un campo `ok` seria siempre `true` y no
 * discriminaria nada, asi que se omite deliberadamente.
 *
 *  - `created: true`  — existia un `pak01_dir.vpk` actual y se copio al archivo
 *    de backup; `backupPath` es la ruta absoluta del backup creado (AC 5.1).
 *    Si ya habia un backup previo, se sobrescribio (unico nivel, AC 5.3).
 *  - `created: false` — NO existia un `pak01_dir.vpk` previo (primera
 *    instalacion); no se creo ningun backup. Esto NO es un fallo: no hay nada
 *    que respaldar y el orquestador sigue adelante (ver DECISION 2 en
 *    `backup-manager.ts`).
 */
export type BackupResult =
  | { created: true; backupPath: string }
  | { created: false };

// ---------------------------------------------------------------------------
// Requirement 8 — Persistencia del Active_Set (LocalStore)
// ---------------------------------------------------------------------------

/**
 * Entrada del Addon_Manifest. El manifest NO registra archivos individuales por
 * addon; solo `{ addonId, priorityOrder }`, suficiente para reconstruir el
 * Merged_Package mediante una fusión completa desde cero.
 */
export interface AddonManifestEntry {
  addonId: string;
  priorityOrder: number;
}

// ---------------------------------------------------------------------------
// Requirement 9 — Elevación UAC bajo demanda (ElevationService)
// ---------------------------------------------------------------------------

/**
 * Operación pendiente que se transfiere a la instancia elevada. Lleva SOLO lo
 * mínimo (tipo + handle): la instancia elevada rehidrata el Active_Set candidato
 * leyendo el estado de sesión pendiente del LocalStore, no de la línea de comando.
 */
export interface PendingOperation {
  type: "applyActiveSet" | "addAddon" | "removeAddon";
  /** Identifica el estado de sesión pendiente persistido en el LocalStore. */
  resumeHandle: string;
}

/**
 * Resultado de la decisión/mecanismo de elevación.
 *
 * - `already-writable`: no hacía falta elevar (o ya se está elevado).
 * - `elevated-handoff`: se relanzó elevado; esta instancia cede el trabajo.
 * - `denied`: el usuario canceló el prompt UAC.
 */
export type ElevationOutcome =
  | { kind: "already-writable" }
  | { kind: "elevated-handoff" }
  | { kind: "denied"; reason: string };

// ---------------------------------------------------------------------------
// Capa de aplicación — Resultado de operaciones del orquestador
// ---------------------------------------------------------------------------

/**
 * Resultado de una operación del MergeOrchestrator (applyActiveSet / addAddon /
 * removeAddon).
 *
 * Decisión de forma (documentada): se usa una unión discriminada por el campo
 * `ok`. En éxito, se expone opcionalmente el `MergeReport` (colisiones) y las
 * entradas finales del Active_Set instalado, útiles para que la UI refleje el
 * resultado. En fallo, se expone un `error` legible y, cuando aplica, el
 * `addonId` que causó el fallo (p. ej. una extracción que devolvió exit ≠ éxito),
 * para trazabilidad y mensajes de usuario precisos (AC 6.12).
 */
export type OperationResult =
  | {
      ok: true;
      report?: MergeReport;
      installedManifest?: AddonManifestEntry[];
    }
  | {
      ok: false;
      error: string;
      addonId?: string;
    };
