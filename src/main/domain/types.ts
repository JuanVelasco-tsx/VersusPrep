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
  /** `<gameRoot>\modsvs` */
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
 * Claves de `GamePaths` verificables como REQUERIDAS de existir en disco.
 *
 * Se modela como un subconjunto tipado de las claves de {@link GamePaths} (no un
 * `string` libre) para que `verifyPathsOnDisk` y `detect` no puedan referirse a
 * un rol de ruta inexistente y para que, ante cualquier cambio de `GamePaths`, el
 * compilador obligue a revisar qué rutas se verifican. `steamPath` y
 * `left4dead2Dir` NO están aquí: el AC 1.9 no los lista como requeridos (ver la
 * DECISIÓN documentada en el historial 2026-09-05, tarea 5.3).
 *
 * BUG-009: `modsvsFolder` SE MANTIENE en esta unión de tipo porque
 * {@link PathVerification.present} usa `Record<RequiredPathKey, boolean>` y sacarlo
 * del tipo rompería más de lo necesario. SIN EMBARGO, `modsvsFolder` ya NO se
 * verifica en disco: `REQUIRED_PATH_KEYS` (el recorrido efectivo en
 * `path-detector.ts`) dejó de incluirlo, porque `modsvs` es una carpeta que la
 * propia app CREA (en `MergeOrchestrator.#materialize`), no una ruta preexistente.
 * Como `present`/`missing` se construyen recorriendo `REQUIRED_PATH_KEYS`, en la
 * práctica NO tendrán una entrada para `modsvsFolder` aunque el tipo la admita.
 * Las rutas realmente verificadas son: `gameRoot`, `workshopFolder`, `vpkToolPath`
 * y `gameInfoFile`.
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
 * Se usa `Record<RequiredPathKey, boolean>` (tipa todas las claves de la unión)
 * en vez de un mapa parcial, para que el compilador acompañe el recorrido de las
 * rutas verificadas antes de derivar `allPresent`.
 *
 * BUG-009: aunque el tipo `RequiredPathKey` admite `modsvsFolder`, esta carpeta
 * ya NO se verifica en disco (la app la crea en `MergeOrchestrator.#materialize`).
 * `present` y `missing` se construyen recorriendo `REQUIRED_PATH_KEYS`
 * (path-detector.ts), que ya NO incluye `modsvsFolder`; por lo tanto, en la
 * práctica `present` no tendrá esa entrada y `missing` nunca la listará. Las
 * rutas efectivamente verificadas son `gameRoot`, `workshopFolder`, `vpkToolPath`
 * y `gameInfoFile`.
 */
export interface PathVerification {
  /**
   * Existencia en disco de cada ruta EFECTIVAMENTE verificada (una entrada por
   * clave de `REQUIRED_PATH_KEYS`). No incluye `modsvsFolder` (ya no se verifica).
   */
  present: Record<RequiredPathKey, boolean>;
  /** Claves cuyas rutas NO existen en disco, en orden de `REQUIRED_PATH_KEYS`. */
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
  /**
   * `mtimeMs` del `.vpk` (P-31, Paso 1, datos para el ordenamiento de
   * Biblioteca — el ORDENAMIENTO en sí vive en el renderer, este campo solo
   * provee el dato). Metadata de FILESYSTEM (`fs.stat`), NO requiere
   * `vpk.exe`. Best-effort, mismo criterio que `info` (AC 2.5): si el `stat`
   * falla (ventana muy chica entre listar el directorio y leerlo), degrada a
   * `0` sin abortar ni omitir el addon — `0` nunca es un valor real de
   * `mtimeMs`/`sizeBytes` para un archivo existente, así que no se confunde
   * con un dato válido en la UI (un `Date` de época 0 o un tamaño "0 KB" se
   * reconocen como degradados a simple vista).
   */
  mtimeMs: number;
  /** Tamaño en bytes del `.vpk` (`fs.stat`); mismo criterio best-effort que `mtimeMs`. */
  sizeBytes: number;
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
// Requirement 6 — Edición del GameInfo_File (GameInfoEditor)
// ---------------------------------------------------------------------------

/**
 * Caso aplicado por {@link GameInfoEditor.ensureModsvsFirst} sobre el bloque
 * SearchPaths del gameinfo.txt (Requirement 6, AC 6.10). Refina/precisa los tres
 * casos de design.md:
 *
 *  - `inserted`  — Caso A: `Game modsvs` NO existía en SearchPaths; se insertó
 *    como primera entrada.
 *  - `moved`     — Caso B: `Game modsvs` existía en posición no-primera y/o con
 *    múltiples ocurrencias; se movió/colapsó a una única primera entrada.
 *  - `unchanged` — Caso C: `Game modsvs` ya era la primera y única entrada; no se
 *    modificó el archivo (operación idempotente).
 */
export type GameInfoEditCase = "inserted" | "moved" | "unchanged";

/**
 * Resultado de {@link GameInfoEditor.ensureModsvsFirst} (Requirement 6, AC 6.10).
 *
 * DECISIÓN DE FORMA (documentada, ver DECISIÓN 5 en `game-info-editor.ts`): UNIÓN
 * DISCRIMINADA REAL por `appliedCase`, SIN campo `ok`, igual que {@link BackupResult}.
 * Los fallos (por ejemplo, ausencia de un bloque SearchPaths) se propagan SIEMPRE
 * por `throw` de un `GameInfoEditError`, nunca por una rama de error del retorno;
 * un campo `ok` sería siempre `true` y no discriminaría nada.
 *
 * El discriminante `appliedCase` está ACOPLADO al valor de `changed` a nivel de
 * tipos, de modo que el compilador garantice la correspondencia: `unchanged` (Caso
 * C) implica `changed: false` y no hay otra combinación posible; `inserted`/`moved`
 * (Casos A/B) implican `changed: true`. Así es imposible construir, por ejemplo, un
 * `{ appliedCase: "unchanged", changed: true }` incoherente.
 *
 *  - `appliedCase` dice QUÉ caso se aplicó (`inserted` / `moved` / `unchanged`),
 *    útil para logs/UI y para verificar idempotencia (una segunda aplicación
 *    SHALL devolver `unchanged` con `changed: false`).
 *  - `changed` es `true` si el archivo se modificó (Casos A/B), `false` en el Caso
 *    C. El orquestador (tarea 18) solo escribe/reporta cuando `changed` es `true`.
 */
export type GameInfoEditResult =
  | { appliedCase: "unchanged"; changed: false }
  | { appliedCase: "inserted" | "moved"; changed: true };

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

/**
 * Preset de addons (P-30, Paso 1 — solo persistencia, sin wiring a
 * GameInfoEditor/MergeOrchestrator/IPC/UI todavía): un Active_Set con nombre
 * editable, para soportar múltiples modpacks intercambiables (ej. "armas",
 * "skins") elegibles por el usuario.
 *
 * `id` es un identificador TÉCNICO generado (`preset-<hex>`, ver
 * `local-store.ts`), estable durante toda la vida del preset y SIN relación
 * con `name`. `name` es la ETIQUETA visible que el usuario edita libremente.
 * Esta separación es una DECISIÓN de diseño ya tomada (Context/02-pendientes.md
 * P-30): si `name` se usara como nombre de carpeta técnica, caracteres
 * especiales/espacios/duplicados romperían el filesystem, y renombrar
 * obligaría a mover archivos en disco. Con `id` desacoplado, renombrar es un
 * UPDATE de una columna; la carpeta técnica (cuando exista, en un paso
 * posterior) usa `id`, nunca `name`.
 */
export interface Preset {
  id: string;
  name: string;
  entries: AddonManifestEntry[];
  /**
   * Descripción libre y OPCIONAL del preset (bug/feature reportado tras P-30
   * Paso 5: "Nuevo preset" solo pedía un nombre por `prompt()`, sin forma de
   * anotar para qué es cada preset). `string | null` —no una propiedad
   * `description?:` ausente— mismo idioma que el resto de los campos
   * respaldados por una columna SQLite nullable en este archivo (`coverPath`,
   * `info`, `getActivePresetId()`): `null` es el valor explícito de "sin
   * descripción", no una clave faltante. Solo se CAPTURA y persiste por
   * ahora; ningún panel la muestra todavía (paso de UI futuro).
   */
  description: string | null;
}

// ---------------------------------------------------------------------------
// Requirement 9 — Elevación UAC bajo demanda (ElevationService)
// ---------------------------------------------------------------------------

/**
 * Operación pendiente que se transfiere a la instancia elevada. Lleva SOLO lo
 * mínimo (tipo + handle): la instancia elevada rehidrata el Active_Set candidato
 * leyendo el estado de sesión pendiente del LocalStore, no de la línea de comando.
 *
 * `"switchActivePreset"` (P-30, Paso 3.5, cierra la DECISIÓN 8 de
 * `merge-orchestrator.ts`): un cambio de preset activo TAMBIÉN puede necesitar
 * elevación UAC (P-10 documenta que la instalación default de Steam suele caer
 * bajo Program Files). Sin este caso, la instancia elevada no tenía forma de
 * distinguir un switch interrumpido de un `applyActiveSet` normal, y resumía
 * fusionando hacia `modsvs` en vez de hacia la carpeta del preset — el switch
 * se completaba MAL tras el relanzo.
 *
 * `presetId` (OPCIONAL a nivel de tipo, pero REQUERIDO en la práctica cuando
 * `type === "switchActivePreset"`) es el ÚNICO dato extra que hace falta
 * agregar: el `id` técnico del preset destino. El resto de lo que el resume
 * necesita para completar el switch (la carpeta técnica destino, y si hay que
 * quitar la entrada de un preset anterior en gameinfo.txt) se RE-DERIVA en la
 * instancia elevada a partir de este único dato más el estado YA PERSISTIDO en
 * el LocalStore (`getPreset(presetId)`, `getActivePresetId()`,
 * `GamePaths.gameRoot`) — no hace falta transportar nada más por la línea de
 * comando ni por la sesión pendiente. Queda opcional a nivel de tipo (no un
 * campo separado por `type` en una unión discriminada) para no reestructurar
 * los tres casos existentes, que nunca lo usan; `resumePendingOperation`
 * (`merge-orchestrator.ts`) es quien exige que esté presente cuando
 * `type === "switchActivePreset"`.
 */
export interface PendingOperation {
  /**
   * `"addAddons"`/`"removeAddons"` (P-31+P-22, Paso 1): variantes en LOTE de
   * `"addAddon"`/`"removeAddon"` (`MergeOrchestrator.addAddons`/`removeAddons`).
   * No necesitan tratamiento especial en el resume: `resumePendingOperation`
   * ya trata CUALQUIER `type !== "switchActivePreset"` de forma genérica
   * (re-deriva el preset activo fresco y materializa hacia él, ver
   * `merge-orchestrator.ts`), así que agregar estos dos literales es
   * puramente informativo/de trazabilidad — no dispara ninguna rama nueva.
   * Sí hace falta sumarlos al allow-list de `parseResumeArgs`
   * (`composition-root.ts`), que valida `type` contra una lista explícita de
   * literales: sin eso, un relanzo elevado a mitad de una operación en lote
   * arrancaría sin resume (la app perdería la sesión pendiente en vez de
   * completarla).
   */
  type: "applyActiveSet" | "addAddon" | "removeAddon" | "addAddons" | "removeAddons" | "switchActivePreset";
  /** Identifica el estado de sesión pendiente persistido en el LocalStore. */
  resumeHandle: string;
  /** Id técnico del preset destino. Presente SOLO si `type === "switchActivePreset"`. */
  presetId?: string;
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
 * DIVERGENCIA CONSCIENTE de `design.md` (mismo formato y criterio que la
 * DECISIÓN 6 de `merge-engine.ts` y la DECISIÓN 1 de `elevation-service.ts`):
 *
 *  - QUÉ PUBLICA design.md: la sección "MergeOrchestrator" describe operaciones
 *    que terminan en un resultado de ÉXITO o de FALLO (el flujo "notifica el
 *    resultado al usuario", Req 6.11). En la Tarea 1 se fijó `OperationResult`
 *    como una unión de DOS ramas discriminada por `ok` (`ok: true` con
 *    `report?`/`installedManifest?` | `ok: false` con `error`/`addonId?`).
 *
 *  - POR QUÉ ESA FORMA NO ALCANZA: la elevación UAC bajo demanda (Req 9.2)
 *    introduce un TERCER desenlace que no es ni éxito ni fallo. Cuando
 *    `ElevationService.ensureCanWrite` (proactivo) o `handleWriteFailure`
 *    (reactivo) resuelven `elevated-handoff`, la operación NO terminó: esta
 *    instancia (sin privilegios) va a CERRARSE y una instancia elevada nueva va a
 *    materializar y reportar la operación por su cuenta (Tarea 18.2). Ese estado
 *    "elevando / handoff" del `ElevationOutcome` no tiene dónde reportarse en una
 *    unión de solo éxito/fallo: mapearlo a `ok: false` sería MENTIR (no falló) y
 *    mapearlo a `ok: true` también (no hay `report` ni manifest instalado
 *    todavía). El orquestador necesita devolver "ni terminó ni falló: se cedió el
 *    trabajo a la instancia elevada" para que el llamador (IPC/UI, Tarea 20) NO
 *    muestre éxito ni error y simplemente deje que la instancia elevada continúe.
 *
 *  - QUÉ FORMA REAL SE USA: unión discriminada de TRES ramas por un campo `status`
 *    (`"success" | "failure" | "elevating"`), NO por `ok`. Se ELIMINA el `ok`
 *    booleano justamente porque un booleano no puede representar tres estados; se usa
 *    un discriminante de tres literales, replicando el estilo de `ElevationOutcome`
 *    (unión por `kind`) y de `PathDetectionResult` (unión por `kind`) de este
 *    mismo módulo. Al no haber HOY ningún consumidor de `OperationResult` (ni el
 *    MergeOrchestrator ni la capa IPC existían al fijarlo en la Tarea 1), el cambio
 *    de discriminante no rompe llamadores existentes.
 *
 *  - `status: "success"` — la operación completó. Expone opcionalmente el
 *    `MergeReport` (colisiones, Req 7.1) y el Active_Set instalado, útiles para
 *    que la UI refleje el resultado. Mismos datos que la antigua rama `ok: true`.
 *  - `status: "failure"` — fallo DEFINITIVO. Expone un `error` legible y, cuando
 *    aplica, el `addonId` que causó el fallo (p. ej. una extracción con exit ≠
 *    éxito, AC 6.12, o un addon candidato ausente del escaneo de la Workshop).
 *    Mismos datos que la antigua rama `ok: false`.
 *  - `status: "elevating"` — la operación NO terminó: se disparó la elevación UAC
 *    (`elevated-handoff`), esta instancia va a cerrarse y una instancia elevada la
 *    completará y reportará por su cuenta (Tarea 18.2). SIN campos de datos: no hay
 *    nada que reportar todavía (ni resultado ni error).
 */
export type OperationResult =
  | {
      status: "success";
      report?: MergeReport;
      installedManifest?: AddonManifestEntry[];
    }
  | {
      status: "failure";
      error: string;
      addonId?: string;
    }
  | {
      status: "elevating";
    };

// ---------------------------------------------------------------------------
// Capa de aplicación — Preview de solo lectura del Active_Set (Sección 21.2)
// ---------------------------------------------------------------------------

/**
 * Un addon del Active_Set candidato cuyo `VpkTool.list()` falló durante el
 * cálculo del preview (VPK corrupto, exit ≠ éxito, u otro error del
 * `CommandRunner`). Ver DECISIÓN 7 en `merge-engine.ts` sobre por qué esto NO
 * aborta el preview completo (a diferencia de `merge()`, que sí aborta ante el
 * mismo fallo).
 */
export interface UnavailablePreviewAddon {
  addonId: string;
  /** Motivo legible del fallo (mensaje del error capturado). */
  reason: string;
}

/**
 * Cálculo de colisiones exitoso para un preview: mismos datos que
 * `OperationResult.report`, más el conteo total de archivos únicos a empaquetar
 * y los addons que no se pudieron incluir en el cálculo (ver
 * {@link UnavailablePreviewAddon}).
 */
export interface MergePreview {
  report: MergeReport;
  /** Cantidad de paths únicos que se empaquetarían (tamaño del mapa de ganadores). */
  fileCount: number;
  /** Addons excluidos best-effort del cálculo. Vacío si ninguno falló. */
  unavailable: UnavailablePreviewAddon[];
}

/**
 * Resultado de {@link MergeOrchestrator.previewActiveSet} (Sección 21.2, capacidad
 * agregada fuera del scope original de la Tarea 21.2 — ver
 * `Context/04-historial-decisiones.md`). Cálculo de SOLO LECTURA de cómo
 * quedaría la fusión de un Active_Set candidato: no escribe nada en disco, no
 * dispara elevación UAC.
 *
 * DIVERGE deliberadamente de `OperationResult` (NO se reutiliza esa unión):
 * `previewActiveSet` nunca escribe, así que no existe un desenlace `elevating`;
 * y el único caso "no exitoso" no es un fallo de una operación en curso, sino
 * una precondición de datos (un `addonId` candidato que ya no está en la
 * Workshop, igual que detecta `#resolveOrderedAddons` para `applyActiveSet`).
 * Forzar esos dos casos dentro de `OperationResult` obligaría a mentir con un
 * `status: "failure"`/`"elevating"` que no describe lo que pasó.
 *
 *  - `kind: "ready"` — se pudo calcular el preview (con o sin addons
 *    `unavailable`, ver {@link MergePreview}).
 *  - `kind: "addon-missing"` — (OBSOLETO desde BUG-001) NINGÚN productor lo
 *    emite ya: `previewActiveSet` dejó de escanear la Workshop para detectar
 *    el faltante y ahora deriva el `vpkPath` directo, dejando que un addon
 *    desuscrito/borrado caiga en `unavailable` (su `VpkTool.list()` falla). Se
 *    conserva la variante en el tipo para no forzar un cambio simultáneo en el
 *    renderer; un consumidor puede quitar su branch de `addon-missing` cuando
 *    quiera, es inalcanzable. Los faltantes hoy se ven en `MergePreview.unavailable`.
 */
export type ActiveSetPreview =
  | ({ kind: "ready" } & MergePreview)
  | { kind: "addon-missing"; addonId: string };

// ---------------------------------------------------------------------------
// Capa de aplicación — Progreso de fusión (MergeOrchestrator -> capa IPC)
// ---------------------------------------------------------------------------

/**
 * Evento de progreso emitido por el MergeOrchestrator, uno por cada PASO del
 * flujo de una operación (applyActiveSet / addAddon / removeAddon / resume).
 *
 * SEMÁNTICA (canal ADITIVO y OPCIONAL, ver `merge-orchestrator.ts`):
 *  - Se emite UN evento por paso, SIEMPRE ANTES de iniciar ese paso (no después).
 *  - `"done"` se emite JUSTO ANTES de retornar un `status: "success"` (tras
 *    persistir el manifest), como señal de operación completada con éxito.
 *  - `"failed"` (P-26) se emite JUSTO ANTES de retornar CUALQUIER
 *    `status: "failure"` — juego corriendo, addon candidato ausente del
 *    escaneo, UAC denegado, un fallo de `#writeStep` que resulta
 *    `already-writable` (no era de permisos), o el `catch` de
 *    `MergeEngine.merge()` (`VpkToolError`). Antes de este fix ningún camino de
 *    fallo emitía un step terminal (asimetría con `"done"`) y el renderer no
 *    tenía forma de detectar por este canal que una operación fallida había
 *    terminado; dependía únicamente de un polling de respaldo aparte, que
 *    sigue existiendo como red de seguridad pero ya no es el mecanismo
 *    principal. Centralizado en el helper `#failure` de
 *    `merge-orchestrator.ts`: todo `OperationResult` de fallo se construye ahí,
 *    nunca a mano en cada `return`.
 *  - La ÚNICA excepción sigue siendo la elevación: si la elevación resuelve
 *    `elevated-handoff` (`status: "elevating"`), NO se emite ningún evento
 *    terminal en ESTA instancia — la operación sigue viva en la instancia
 *    elevada (señalizada por `"restarting"`, ver abajo), que retoma la
 *    secuencia de steps y emitirá su propio `"done"`/`"failed"` al terminar.
 *  - `"restarting"` (BUG-004) lo emite ElevationService JUSTO ANTES del relanzo
 *    `runas`, cuando una escritura va a elevar y la instancia actual se va a
 *    cerrar. Es la señal para que la UI del renderer todavía vivo cambie su
 *    mensaje ("Reiniciando con permisos de administrador...") en vez de quedar
 *    congelada en el paso anterior antes del cierre. A diferencia del resto de
 *    los steps (emitidos por el MergeOrchestrator), este lo emite el
 *    ElevationService por el MISMO canal `onProgress` (el composition root le
 *    inyecta el mismo broadcaster).
 *  - En el resume de la instancia elevada NO se emiten `"guard"` (no chequea
 *    ProcessGuard) ni `"elevation"` (ya está elevada): la secuencia arranca en
 *    `"scan"`.
 *
 * Es un canal de OBSERVABILIDAD puro: no altera el control de flujo ni el
 * resultado de la operación. La Sección 20 (capa IPC) lo consumirá para traducir
 * cada evento a `webContents.send` hacia el renderer.
 */
export interface MergeProgressEvent {
  step:
    | "guard"
    | "scan"
    | "elevation"
    | "restarting"
    | "backup"
    | "merge"
    | "install"
    | "gameinfo"
    | "saveManifest"
    | "done"
    | "failed";
}

/**
 * Listener opcional de eventos de progreso del MergeOrchestrator. Se inyecta como
 * dependencia OPCIONAL (`MergeOrchestratorDeps.onProgress`); si no se provee, la
 * operación se comporta de forma idéntica (el orquestador no emite nada).
 */
export type MergeProgressListener = (event: MergeProgressEvent) => void;

/**
 * Progreso del escaneo de la Workshop_Folder (`AddonScanner.scan`, rediseño
 * Paso 8/8, README `2e` — "Leyendo tus addons suscritos: N de M"). Excepción
 * de scope aprobada por el usuario: es la ÚNICA instrumentación nueva que se
 * agregó para la pantalla de primer arranque — `PathDetector.detect()` NO
 * se instrumentó (ver docblock de `FirstLaunchScreen.tsx`): sus pasos
 * ("Steam encontrado"/"Biblioteca con el juego") resuelven en milisegundos
 * (lectura de registro + parseo de un `.vdf`, sin `vpk.exe` de por medio) y
 * pasan de "pendiente" a "hecho" los tres juntos apenas `detectPaths()`
 * resuelve — instrumentarlos no agregaría nada perceptible para el usuario,
 * a cambio de tocar un módulo con tests extensos (`path-detector.test.ts`,
 * `.property.test.ts`) por un beneficio nulo.
 *
 * `total` es la cantidad de candidatos de la FASE 1 (antes de `vpk.exe`);
 * `done` cuenta workers de la FASE 2 que ya escribieron su resultado
 * (orden de FINALIZACIÓN del pool acotado, no el orden posicional del
 * resultado final — ver `AddonScanner.scan`).
 */
export interface ScanProgressEvent {
  done: number;
  total: number;
}

/**
 * Listener opcional de progreso de `AddonScanner.scan` (dependencia OPCIONAL
 * del constructor, mismo criterio que `MergeProgressListener`).
 */
export type ScanProgressListener = (event: ScanProgressEvent) => void;
