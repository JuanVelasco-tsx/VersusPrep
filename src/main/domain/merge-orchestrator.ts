/**
 * MergeOrchestrator — capa de APLICACIÓN que coordina el flujo completo de
 * aplicar/agregar/quitar addons y garantiza el ORDEN y las PRECONDICIONES
 * (Sección 18, Requisitos 4, 5, 6, 8, 9.2). Es el punto que atienden los handlers
 * IPC (Tarea 20) para las operaciones de fusión, adición y quita.
 *
 * Secuencia garantizada (design.md, sección "MergeOrchestrator"):
 *   1. ProcessGuard.isGameRunning()      -> si corre, abortar (Req 4.1, 4.2).
 *   2. Resolver el Active_Set candidato + Priority_Order (add/remove = fusión
 *      completa desde cero, Req 8.3-8.5).
 *   3. ElevationService.ensureCanWrite() -> camino PROACTIVO (Req 9.2). Si
 *      elevated-handoff, esta instancia cede el trabajo y NO sigue.
 *   4. BackupManager.backupExisting()    -> si falla (no-permisos), abortar (Req 5).
 *   5. MergeEngine.merge()               -> genera pak01_dir.vpk en un workDir temporal.
 *   6. Instalar en modsvs/ (o la carpeta técnica del preset activo, P-30) ->
 *      copiar el .vpk a `<destFolder>\pak01_dir.vpk` (Req 6.9).
 *   7. GameInfoEditor.switchFolderEntry()-> (Req 6.10; generalización de
 *      `ensureModsvsFirst`, P-30 Pasos 2-3).
 *   8. LocalStore.updatePresetEntries() sobre el preset ACTIVO -> (Req 8.1,
 *      8.6; P-30, Paso 4.5b — reemplaza al `saveManifest` DEPRECADO, ver
 *      `local-store.ts`).
 *   9. Notificar resultado (Req 6.11) — vía el OperationResult devuelto.
 *
 * Los pasos 4, 6 y 7 son las ÚNICAS escrituras reales en el Game_Root; van
 * envueltas en un manejo REACTIVO uniforme (ver `#writeStep`) que, ante
 * `EACCES`/`EPERM`, invoca `ElevationService.handleWriteFailure` para elevar y
 * reintentar en la instancia elevada en vez de abortar. El paso 5 (MergeEngine)
 * opera en el workDir temporal FUERA del Game_Root: sus errores (`VpkToolError`)
 * NO son de permisos y se propagan directo como fallo definitivo. El paso 8
 * escribe en la base local del Manager, no en el Game_Root, así que tampoco va
 * envuelto.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 1 — Dependencias inyectadas por constructor (mismo patrón de todo el
 * dominio: `CommandRunner`/`ProcessListProvider`/`*FileSystem`/`Database`).
 *
 * El orquestador recibe INYECTADOS los seis componentes de dominio que coordina
 * (`ProcessGuard`, `ElevationService`, `BackupManager`, `MergeEngine`,
 * `GameInfoEditor`, `LocalStore`, `AddonScanner`), las `GamePaths` ya
 * verificadas, y su FS propio (`MergeOrchestratorFileSystem`). Ninguno se
 * construye adentro: son dependencias estables que la capa de composición
 * (Tarea 20 / arranque de la app) ensambla. Así el orquestador es testeable sin
 * disco, sin `vpk.exe` y sin procesos reales, inyectando dobles en memoria
 * (unit tests 18.4 y property test 18.3).
 * ---------------------------------------------------------------------------
 * DECISIÓN 2 — FS PROPIO mínimo (`MergeOrchestratorFileSystem`), NO reutilizar el
 * `BackupFileSystem` ni el `MergeFileSystem` de otros componentes.
 *
 * Cada componente de dominio expone el contrato de FS MÍNIMO que necesita
 * (patrón ya aplicado en `BackupFileSystem`, `MergeFileSystem`,
 * `CollisionFileSystem`, `AddonFileSystem`, `GameInfoFileSystem`). El orquestador
 * hace directamente TRES cosas de I/O que no delega en ningún componente: (a)
 * crear el `workDir` temporal donde MergeEngine trabaja, (b) COPIAR el
 * Merged_Package (`pak01_dir.vpk`) desde el workDir a `modsvs/` (paso de
 * instalación, Req 6.9), y (c) LIMPIAR recursivamente el `workDir` al terminar
 * (resuelve P-14). Por eso define su propio `MergeOrchestratorFileSystem` con
 * exactamente `ensureDir` + `copyFile` + `removeDir`. Reutilizar el
 * `BackupFileSystem` (contrato PRIVADO de BackupManager: `exists` + `copyFile`)
 * acoplaría dos componentes por un contrato que no les pertenece y no cubre
 * `ensureDir`/`removeDir`.
 * ---------------------------------------------------------------------------
 * DECISIÓN 3 — Mecanismo del `workDir`: `<workRoot>/merge-<epochMs>-<seq>`, único
 * por operación, creado bajo el prefijo `work/` (ya ignorado por `.gitignore`).
 *
 * Cada operación crea un `workDir` FRESCO combinando la marca de tiempo
 * (`Date.now()`) y un contador incremental por instancia (`#workSeq`), para que
 * dos operaciones consecutivas dentro del mismo milisegundo no colisionen. El
 * `workRoot` base se inyecta por constructor (por defecto la capa de composición
 * pasará algo como `<userData>\work`); los tests inyectan una ruta cualquiera. El
 * `workDir` se limpia SIEMPRE en un `finally` (éxito, fallo o elevación), lo que
 * resuelve el pendiente P-14 (la limpieza que MergeEngine no hacía). Se usa el
 * separador `\` literal (coherente con el resto del dominio: Windows es la
 * plataforma primaria; ver `vpk-path.ts`).
 * ---------------------------------------------------------------------------
 * DECISIÓN 4 — Resolución de `entries` candidatas de `addAddon`/`removeAddon`
 * (decisiones INFERIDAS; no fijadas por ningún AC ni por tasks.md).
 *
 *  - `addAddon(addonId, priorityOrder)`: UPSERT sobre las entries del preset
 *    ACTIVO (P-30, Paso 4.5b; `#currentPresetEntries`, antes
 *    `LocalStore.getManifest()`, DEPRECADO). Si `addonId` ya está, se ACTUALIZA
 *    su `priorityOrder`; si no, se AGREGA. Motivo: "agregar" un addon ya
 *    presente es, naturalmente, reubicarlo en el Priority_Order; duplicarlo
 *    produciría un preset inconsistente (`preset_entries` usa `addonId` como
 *    parte de su clave única, ver `local-store.ts` DECISIÓN 6).
 *  - `removeAddon(addonId)`: FILTRA ese `addonId` de las entries del preset
 *    ACTIVO. Es NO-OP (sin error) si el addon no estaba presente. Motivo:
 *    quitar algo que no está es un no-op idempotente, no un error; el
 *    resultado deseado (ese addon ausente del Active_Set) ya se cumple.
 *  - Ambas derivan el candidato del preset ACTIVO y luego materializan una
 *    fusión completa desde cero con el Active_Set resultante (Req 8.3-8.5): add y
 *    remove NO son operaciones incrementales sobre el `.vpk`, son una nueva fusión
 *    del conjunto final. Esto es lo que valida la Property 13 (tarea 18.3).
 * ---------------------------------------------------------------------------
 * DECISIÓN 5 — Addon candidato ausente del escaneo de la Workshop = fallo
 * DEFINITIVO con ese `addonId` (decisión INFERIDA).
 *
 * Al mapear cada `AddonManifestEntry` candidata a su `ScannedAddon` (por `id`),
 * si algún `addonId` NO aparece en el escaneo de la Workshop_Folder (el usuario lo
 * desuscribió o borró el `.vpk`), la operación falla con `status: "failure"` y ese
 * `addonId`. No hay AC explícito para este caso, pero es coherente con la regla
 * general "fail-fast con estado consistente" de design.md (Error Handling): no se
 * puede fusionar un addon cuyo VPK ya no existe, y seguir sin él cambiaría
 * silenciosamente el Active_Set que el usuario pidió.
 *
 * La resolución ocurre en `#resolveOrderedAddons` y se invoca ANTES del chequeo de
 * elevación proactiva (tanto en `#runPublic` como en `resumePendingOperation`),
 * precisamente para NO disparar un prompt UAC innecesario cuando la operación igual
 * iba a fallar por un addon faltante: si falta un addon, se corta con el fallo
 * definitivo sin llegar a `ensureCanWrite`. `#materialize` recibe los
 * `orderedAddons` ya resueltos como parámetro.
 * ---------------------------------------------------------------------------
 * DECISIÓN 6 — Manejo REACTIVO uniforme de las 3 escrituras en Game_Root
 * (`#writeStep`), traduciendo el `ElevationOutcome` a `OperationResult`.
 *
 * Backup, instalar y gameinfo se ejecutan a través de `#writeStep`, que captura
 * CUALQUIER error del paso y lo pasa a `ElevationService.handleWriteFailure(error,
 * pending, entries)`. Según el `ElevationOutcome`:
 *   - `already-writable` -> el error NO era de permisos: se re-lanza el error
 *     ORIGINAL para que el flujo lo convierta en fallo definitivo (un
 *     `GameInfoEditError` de SearchPaths ausente/malformado cae acá: no es de
 *     permisos, se propaga sin elevar).
 *   - `elevated-handoff`  -> se señaliza "elevando": la instancia se cederá y no se
 *     reintenta nada acá; `#writeStep` corta el flujo devolviendo un
 *     `OperationResult` con `status: "elevating"`.
 *   - `denied`            -> el usuario canceló el UAC: fallo definitivo informando
 *     la cancelación.
 * El `pending` se arma con el `operationType` de la operación en curso y el
 * `resumeHandle` fijo `PENDING_SESSION_HANDLE` (mismo criterio que `ensureCanWrite`
 * en `elevation-service.ts`).
 * ---------------------------------------------------------------------------
 * DECISIÓN 7 — `previewActiveSet`: capacidad AGREGADA fuera del scope original
 * de la Tarea 21.2 (ver `Context/04-historial-decisiones.md`), NO pasa por
 * `guardedWrite`/`operationInFlight` (el guard de la capa IPC, `ipc-handlers.ts`)
 * ni por `ProcessGuard`/`ElevationService`.
 *
 * `previewActiveSet` hace EXACTAMENTE dos cosas de I/O, ambas de LECTURA pura
 * sobre la Workshop_Folder — un SUBCONJUNTO estricto de lo que `applyActiveSet`
 * YA hace, en los mismos Pasos 1-2, ANTES de escribir nada:
 *   1. `#resolveOrderedAddons` -> `AddonScanner.scan(workshopFolder)` ->
 *      `FileSystem.listEntries` (lectura del directorio; `addon-scanner.ts`,
 *      método `scan`).
 *   2. `MergeEngine.preview` -> `VpkTool.list(vpkPath, addonId)` -> `vpk l <vpk>`
 *      (lee el índice del VPK; NO lo modifica).
 *
 * Se confirmó LEYENDO el código que NINGUNA operación de `applyActiveSet`
 * escribe jamás en la Workshop_Folder, así que un `applyActiveSet` en curso y un
 * `previewActiveSet` concurrente NUNCA compiten por una escritura (dos lecturas
 * concurrentes del mismo directorio/VPK son seguras):
 *   - `AddonScanner.scan` solo LEE `workshopFolder` (`listEntries`, y arma
 *     `vpkPath`/`coverPath` para lecturas, `addon-scanner.ts` método `scan`).
 *     Cuando extrae `addoninfo.txt` (`#readAddonInfoSafely`), el destino es
 *     `this.#tempDir` — un directorio TEMPORAL PROPIO del scanner, NUNCA la
 *     Workshop_Folder.
 *   - `MergeEngine.merge()` extrae cada addon a `<workDir>\extract\<addonId>`
 *     (`#extractAddon`), donde `workDir` es el directorio temporal ÚNICO por
 *     operación que crea `#materialize` bajo `workRoot` — nunca dentro de la
 *     Workshop_Folder.
 *   - Las ÚNICAS escrituras reales de `applyActiveSet` en el Game_Root son
 *     backup/instalar (`paths.modsvsFolder`) y `gameinfo.txt`
 *     (`paths.gameInfoFile`, ver `#materialize`) — ambas rutas de `GamePaths`
 *     DISTINTAS y hermanas de `workshopFolder`, nunca la Workshop_Folder misma.
 *
 * Por eso `previewActiveSet` no necesita el guard de escrituras: no escribe
 * nada que ese guard proteja, y sus únicas dos lecturas son un prefijo exacto de
 * lecturas que `applyActiveSet` de todas formas hace primero.
 * ---------------------------------------------------------------------------
 * DECISIÓN 8 (P-30, Paso 3) — `switchActivePreset(presetId)`: mismo patrón
 * guard->scan->elevación->materializar que `#runPublic`, con `destFolder`/
 * `gameInfoFolderName` propios (la carpeta técnica del preset) en vez de
 * `modsvsFolder`/`"modsvs"`.
 *
 * Reusa `#resolveOrderedAddons` y `#materialize` TAL CUAL (ahora parametrizado,
 * ver la doc de `#materialize`), así que hereda el mismo manejo de fallos
 * (`#failure`/`#failureFromError`) y de progreso (`#emit`) que el resto del
 * orquestador. Antes de materializar, resuelve el preset ANTERIOR activo (si
 * había uno distinto del destino) para que `GameInfoEditor.switchFolderEntry`
 * lo quite en la MISMA escritura que asegura el nuevo (ver DECISIÓN 7 en
 * `game-info-editor.ts`): el archivo nunca queda con dos presets referenciados
 * ni con ninguno, ni siquiera ante un fallo a mitad de camino, porque ninguna
 * escritura previa a la de gameinfo pisa el archivo.
 *
 * OPTIMIZACIÓN DIFERIDA A PROPÓSITO (mismo criterio que P-20): este método
 * SIEMPRE re-funde los addons del preset destino, incluso si ya estaba
 * fusionado antes y no cambió desde la última vez. La optimización de "si el
 * preset ya fue fusionado y no cambió, solo reescribir gameinfo.txt sin
 * rehacer la fusión" queda EXPLÍCITAMENTE FUERA de esta tarea, para una
 * sesión futura si se decide.
 *
 * LIMITACIÓN CONOCIDA, CERRADA en el Paso 3.5 (elevación UAC a mitad de un
 * switch): `PendingOperation["type"]` ahora incluye `"switchActivePreset"`
 * con un `presetId` opcional (`types.ts`). `switchActivePreset` pasa
 * `operationType: "switchActivePreset"` + `presetId` a `ensureCanWrite`;
 * `#writeStep` hace lo mismo ante el camino REACTIVO (`handleWriteFailure`,
 * vía el `presetId` que le llega derivado en `#materialize`). Sea cual sea la
 * vía, `ElevationServiceImpl.relaunchElevated` persiste una `PendingOperation`
 * que YA lleva el `presetId`; la instancia elevada la recibe por argv
 * (`--l4d2-resume-preset-id`, `elevation-os-provider.ts` /
 * `parseResumeArgs` en `composition-root.ts`) y `resumePendingOperation`
 * (recibiendo esa `PendingOperation`) completa el switch REAL —hacia la
 * carpeta del preset, con el remove+ensure de `switchFolderEntry`— en vez de
 * caer al camino legado hacia `modsvsFolder`/`"modsvs"`. `#materializePresetSwitch`
 * centraliza la derivación de `destFolder`/`previousFolderName` que
 * necesitan TANTO el camino directo como el resume, para que ambos nunca
 * puedan desincronizarse.
 * ---------------------------------------------------------------------------
 */

import type { BackupManager } from "./backup-manager.js";
import { PENDING_SESSION_HANDLE } from "./elevation-service.js";
import type { ElevationService } from "./elevation-service.js";
import { GameInfoEditError } from "./game-info-editor.js";
import type { GameInfoEditor } from "./game-info-editor.js";
import type { MergeEngine } from "./merge-engine.js";
import type { ProcessGuard } from "./process-guard.js";
import type { LocalStore } from "./local-store.js";
import type { AddonScanner } from "./addon-scanner.js";
import type {
  ActiveSetPreview,
  AddonManifestEntry,
  ElevationOutcome,
  GamePaths,
  MergeProgressEvent,
  MergeProgressListener,
  OperationResult,
  PendingOperation,
  Preset,
  ScannedAddon,
} from "./types.js";

/** Separador de path de Windows, coherente con el resto del dominio. */
const DISK_SEPARATOR = "\\";

/** Nombre canónico del Merged_Package instalado en modsvs/ (o en la carpeta técnica de un preset, P-30). */
const INSTALLED_VPK_NAME = "pak01_dir.vpk";

/** Une un directorio y un segmento con el separador de Windows (sin duplicarlo). */
function joinWindowsPath(dir: string, segment: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  const seg = segment.replace(/^[\\/]+/, "");
  return `${trimmed}${DISK_SEPARATOR}${seg}`;
}

/**
 * Contrato de FS inyectable PROPIO del MergeOrchestrator (ver DECISIÓN 2). Reúne
 * las TRES operaciones de I/O que el orquestador hace directamente y no delega:
 * crear el workDir, instalar el Merged_Package en modsvs/ y limpiar el workDir.
 *
 * Puerto neutro: en producción se implementa con `node:fs/promises`; en los tests
 * con un doble en memoria. Rutas absolutas en formato Windows.
 */
export interface MergeOrchestratorFileSystem {
  /** Crea un directorio (recursivo, idempotente). Para el workDir temporal. */
  ensureDir(dir: string): Promise<void>;
  /**
   * Copia `sourcePath` a `destPath` SOBRESCRIBIENDO si el destino existe. Es el
   * paso de INSTALACIÓN: copia el `pak01_dir.vpk` fusionado a `modsvs/`. Lanza si
   * la copia falla (p. ej. `EACCES`/`EPERM`), para que el manejo reactivo eleve.
   */
  copyFile(sourcePath: string, destPath: string): Promise<void>;
  /**
   * Borra un directorio y todo su contenido de forma recursiva. Idempotente: NO
   * lanza si el directorio no existe (la limpieza del workDir es best-effort).
   */
  removeDir(dir: string): Promise<void>;
}

/** Dependencias inyectadas del MergeOrchestrator (ver DECISIÓN 1). */
export interface MergeOrchestratorDeps {
  processGuard: ProcessGuard;
  elevationService: ElevationService;
  backupManager: BackupManager;
  mergeEngine: MergeEngine;
  gameInfoEditor: GameInfoEditor;
  localStore: LocalStore;
  addonScanner: AddonScanner;
  fs: MergeOrchestratorFileSystem;
  /** Rutas verificadas del juego (workshop, modsvs, gameinfo, etc.). */
  paths: GamePaths;
  /** Directorio base para los workDir temporales (bajo el prefijo `work/`). */
  workRoot: string;
  /**
   * Listener OPCIONAL de progreso (canal aditivo, ver `MergeProgressListener`).
   * Si no se provee, el orquestador no emite eventos y el comportamiento es
   * idéntico. La capa IPC (Sección 20) lo usará para reenviar el progreso al
   * renderer vía `webContents.send`.
   */
  onProgress?: MergeProgressListener;
}

/**
 * MergeOrchestrator — coordina backup -> merge -> instalar -> gameinfo -> manifest
 * con las precondiciones y el manejo de elevación (Sección 18).
 */
export class MergeOrchestrator {
  readonly #processGuard: ProcessGuard;
  readonly #elevation: ElevationService;
  readonly #backup: BackupManager;
  readonly #merge: MergeEngine;
  readonly #gameInfo: GameInfoEditor;
  readonly #store: LocalStore;
  readonly #scanner: AddonScanner;
  readonly #fs: MergeOrchestratorFileSystem;
  readonly #paths: GamePaths;
  readonly #workRoot: string;
  /** Listener OPCIONAL de progreso (canal aditivo; ver `MergeProgressListener`). */
  readonly #onProgress?: MergeProgressListener;
  /** Contador incremental por instancia para la unicidad del workDir (DECISIÓN 3). */
  #workSeq = 0;

  constructor(deps: MergeOrchestratorDeps) {
    this.#processGuard = deps.processGuard;
    this.#elevation = deps.elevationService;
    this.#backup = deps.backupManager;
    this.#merge = deps.mergeEngine;
    this.#gameInfo = deps.gameInfoEditor;
    this.#store = deps.localStore;
    this.#scanner = deps.addonScanner;
    this.#fs = deps.fs;
    this.#paths = deps.paths;
    this.#workRoot = deps.workRoot;
    // Asignación condicional: con `exactOptionalPropertyTypes` no se puede asignar
    // `undefined` explícito a una propiedad opcional. Si no vino listener, el campo
    // queda ausente (el `#emit` con optional-chaining lo trata como no-op).
    if (deps.onProgress !== undefined) {
      this.#onProgress = deps.onProgress;
    }
  }

  /**
   * Emite un evento de progreso ANTES de iniciar el paso indicado. Canal ADITIVO
   * y opcional: si no hay listener inyectado, es un no-op. No altera el control de
   * flujo ni el resultado (ver `MergeProgressEvent`).
   */
  #emit(step: MergeProgressEvent["step"]): void {
    this.#onProgress?.({ step });
  }

  /**
   * Construye un `OperationResult` de fallo definitivo, emitiendo el step
   * terminal `"failed"` JUSTO ANTES de devolverlo (P-26). Punto ÚNICO por el
   * que pasa TODO camino que retorna `status: "failure"` (juego corriendo,
   * addon candidato ausente del escaneo, UAC denegado, `#writeStep`
   * `already-writable`, catch de `VpkToolError` en el merge) — simétrico a
   * como `"done"` se emite justo antes del `status: "success"` en
   * `#materialize`. Reemplaza construir el objeto de fallo a mano en cada
   * `return` para que ningún camino nuevo pueda olvidar emitir el step.
   *
   * NO se usa para `status: "elevating"`: ese desenlace no es un fallo, la
   * operación sigue viva en la instancia elevada (ver `MergeProgressEvent`).
   */
  #failure(error: string, addonId?: string): OperationResult {
    this.#emit("failed");
    if (addonId !== undefined) {
      return { status: "failure", error, addonId };
    }
    return { status: "failure", error };
  }

  /**
   * Aplica un Active_Set candidato completo tal cual lo recibe (fusión completa
   * desde cero). Chequea el juego, resuelve elevación proactiva y materializa.
   */
  async applyActiveSet(entries: readonly AddonManifestEntry[]): Promise<OperationResult> {
    return this.#runPublic([...entries], "applyActiveSet");
  }

  /**
   * Agrega un addon al preset ACTIVO (UPSERT por `priorityOrder`, DECISIÓN 4;
   * P-30, Paso 4.5b: ya NO opera sobre `LocalStore.getManifest()` —deprecado—
   * sino sobre las entries del preset ACTUALMENTE activo, vía
   * `#currentPresetEntries`) y materializa la fusión completa del conjunto
   * resultante.
   */
  async addAddon(addonId: string, priorityOrder: number): Promise<OperationResult> {
    const current = this.#currentPresetEntries();
    const next = current.filter((e) => e.addonId !== addonId);
    next.push({ addonId, priorityOrder });
    return this.#runPublic(next, "addAddon");
  }

  /**
   * Quita un addon del preset ACTIVO (filtra; no-op si ausente, DECISIÓN 4;
   * P-30, Paso 4.5b: mismo cambio de fuente que `addAddon`, ver
   * `#currentPresetEntries`) y materializa la fusión completa del conjunto
   * resultante.
   */
  async removeAddon(addonId: string): Promise<OperationResult> {
    const current = this.#currentPresetEntries();
    const next = current.filter((e) => e.addonId !== addonId);
    return this.#runPublic(next, "removeAddon");
  }

  /**
   * Entries del preset ACTUALMENTE activo (P-30, Paso 4.5b), o `[]` si no hay
   * ninguno activo — un edge case que no debería ocurrir en una instalación
   * normal (la migración de `LocalStore` siempre deja un preset activo) y que
   * `#runPublic` rechaza explícitamente ANTES de escribir nada (ver su Paso 0),
   * así que devolver `[]` acá es inofensivo: la operación no llega a progresar.
   */
  #currentPresetEntries(): AddonManifestEntry[] {
    const activePresetId = this.#store.getActivePresetId();
    if (activePresetId === null) return [];
    return this.#store.getPreset(activePresetId)?.entries ?? [];
  }

  /**
   * Cambia el preset ACTIVO a `presetId` (P-30, Paso 3; el manejo de elevación
   * UAC se cerró en el Paso 3.5): fusiona los `entries` de ESE preset en su
   * carpeta técnica propia (`<gameRoot>\<presetId>`, NO `modsvs`), deja
   * gameinfo.txt apuntando SOLO a esa carpeta (quitando la entrada del preset
   * anterior si había uno distinto) y, recién si todo tuvo éxito, actualiza el
   * puntero de activo (`LocalStore.setActivePresetId`). Ver DECISIÓN 8 para el
   * patrón completo (guard->scan->elevación->materializar, igual que
   * `#runPublic`) y la limitación restante documentada (optimización de
   * re-fusión diferida).
   *
   * `operationType: "switchActivePreset"` + `presetId` viajan a
   * `ensureCanWrite` (P-30, Paso 3.5): si esto dispara elevación UAC, la
   * instancia elevada ahora SÍ sabe, al resumir, que debe completar este MISMO
   * switch (ver `resumePendingOperation`) — ya no cae al camino legado de
   * `applyActiveSet` hacia `modsvs`.
   *
   * @param presetId Id TÉCNICO del preset destino (`LocalStore.getPreset`).
   * @returns Fallo definitivo con `presetId` inexistente si no hay tal preset
   *   (mismo estilo que el resto del orquestador, vía `#failure`); si no,
   *   el mismo `OperationResult` que produciría `applyActiveSet` para los
   *   `entries` de ese preset.
   */
  async switchActivePreset(presetId: string): Promise<OperationResult> {
    const preset: Preset | null = this.#store.getPreset(presetId);
    if (preset === null) {
      return this.#failure(`El preset ${presetId} no existe.`);
    }

    // Paso 1 — Precondición: el juego no puede estar corriendo (Req 4.1, 4.2),
    // igual que `#runPublic`: cambiar de preset también escribe en Game_Root.
    this.#emit("guard");
    if (await this.#processGuard.isGameRunning()) {
      return this.#failure(
        "El juego (left4dead2.exe) está en ejecución. Cerralo antes de aplicar cambios.",
      );
    }

    // Paso 2 — Resolver los ScannedAddon del preset ANTES de la elevación
    // (DECISIÓN 5), mismo camino que `#runPublic`/`resumePendingOperation`.
    this.#emit("scan");
    const resolved = await this.#resolveOrderedAddons(preset.entries);
    if (resolved.kind === "outcome") return resolved.result;

    // Paso 3 — Elevación PROACTIVA, con el tipo y el presetId REALES (P-30,
    // Paso 3.5): si hace falta relanzar, la PendingOperation persistida ya
    // lleva lo necesario para que el resume complete ESTE switch.
    this.#emit("elevation");
    const proactive = await this.#elevation.ensureCanWrite(
      this.#paths.gameRoot,
      preset.entries,
      "switchActivePreset",
      presetId,
    );
    if (proactive.kind === "elevated-handoff") {
      return { status: "elevating" };
    }
    if (proactive.kind === "denied") {
      return this.#failure(
        `Se canceló la solicitud de permisos de administrador (UAC): ${proactive.reason}`,
      );
    }

    return this.#materializePresetSwitch(
      presetId,
      preset.entries,
      resolved.addons,
      "switchActivePreset",
    );
  }

  /**
   * Calcula un {@link ActiveSetPreview} de SOLO LECTURA para `entries`: NO
   * escribe nada en disco, NO dispara elevación UAC (ver DECISIÓN 7). Reutiliza
   * `#resolveOrderedAddons` (el mismo Paso 2 que usan `#runPublic` y
   * `resumePendingOperation`) para resolver los `ScannedAddon` candidatos, y
   * delega el cálculo de colisiones en `MergeEngine.preview`.
   */
  async previewActiveSet(entries: readonly AddonManifestEntry[]): Promise<ActiveSetPreview> {
    // BUG-001: el preview NO escanea la Workshop completa. `MergeEngine.preview`
    // solo usa `{ id, vpkPath }` de cada addon (nunca `coverPath`/`info`), y el
    // `vpkPath` es DERIVABLE del id sin I/O: `<workshopFolder>\<id>.vpk` (misma
    // convención que `AddonScanner` al armar el vpkPath). Se elimina así el
    // `AddonScanner.scan()` completo -recorrer cada `.vpk` + extraer addoninfo,
    // 12-17s con ~73 addons (P-20/P-23)- del camino caliente del preview, que
    // corre en cada edición del Active_Set. El costo restante es solo el
    // `VpkTool.list()` por addon CANDIDATO (no toda la Workshop), inherente al
    // cálculo de colisiones.
    //
    // Un addon cuyo `.vpk` derivado no exista (desuscrito/borrado) NO se detecta
    // acá con un `addon-missing` previo: cae naturalmente en la rama
    // `unavailable` de `MergeEngine.preview` cuando su `VpkTool.list()` falle
    // (mismo criterio best-effort de la DECISIÓN 7 / P-19). No se pierde info: el
    // preview lo reporta como no disponible, que es lo correcto para un dato asesor.
    const ordered = [...entries].sort((a, b) => a.priorityOrder - b.priorityOrder);
    const derivedAddons: ScannedAddon[] = ordered.map((entry) => ({
      id: entry.addonId,
      vpkPath: joinWindowsPath(this.#paths.workshopFolder, `${entry.addonId}.vpk`),
      coverPath: null,
      info: null,
    }));
    const preview = await this.#merge.preview(derivedAddons);
    return { kind: "ready", ...preview };
  }

  /**
   * Resume de la instancia elevada (Tarea 18.2). Lee la sesión pendiente del
   * LocalStore y materializa SALTEANDO la elevación proactiva (esta instancia ya
   * está elevada por construcción). Limpia la sesión al terminar.
   *
   * Devuelve `null` si NO hay sesión pendiente (nada que resumir). Si la hay
   * (incluso `[]`, candidato intencionalmente vacío; ver `local-store.ts` DECISIÓN
   * 5), materializa y devuelve el `OperationResult`.
   *
   * ALCANCE: este método asume que YA SE SABE que hay que resumir (la instancia
   * arrancó elevada con la PendingOperation transferida). El mecanismo de leer esa
   * PendingOperation de los args/archivo al arrancar y el re-escaneo para
   * reconstruir la vista de la UI (tarea 18.2) son responsabilidad de la capa de
   * composición/bootstrap (Tarea 20, aún inexistente), NO de este método de
   * dominio; acá solo se materializa la operación y se limpia el estado.
   *
   * `pendingOperation` (P-30, Paso 3.5, cierra DECISIÓN 8): OPCIONAL para no
   * romper compatibilidad — si se omite (o su `type` no es
   * `"switchActivePreset"`), el resume sigue el camino LEGADO de siempre
   * (`applyActiveSet` hacia `modsvs`). Si `pendingOperation.type ===
   * "switchActivePreset"` (y trae `presetId`), este resume completa ESE
   * switch: re-deriva `destFolder`/`previousFolderName` a partir del
   * `presetId` + el estado YA en `LocalStore` (mismo criterio que
   * `switchActivePreset`, vía `#materializePresetSwitch`) — NUNCA cae al
   * camino de `modsvs` para un switch interrumpido por UAC.
   */
  async resumePendingOperation(
    pendingOperation?: PendingOperation,
  ): Promise<OperationResult | null> {
    const candidateEntries = this.#store.getPendingSession();
    if (candidateEntries === null) return null; // no hay nada que resumir

    // Al resumir NO se re-chequea la elevación proactiva: la instancia ya está
    // elevada.
    try {
      // Paso 2 — Resolver ScannedAddon también en el resume (DECISIÓN 5); un addon
      // ausente del escaneo corta con un fallo definitivo (la sesión igual se
      // limpia en el finally).
      this.#emit("scan");
      const resolved = await this.#resolveOrderedAddons(candidateEntries);
      if (resolved.kind === "outcome") return resolved.result;

      if (pendingOperation?.type === "switchActivePreset" && pendingOperation.presetId !== undefined) {
        const presetId = pendingOperation.presetId;
        // El preset pudo borrarse entre el relanzo y este resume (ventana muy
        // chica, pero se chequea con el MISMO criterio de #failure que el
        // camino directo de `switchActivePreset`).
        if (this.#store.getPreset(presetId) === null) {
          return this.#failure(`El preset ${presetId} no existe.`);
        }
        return await this.#materializePresetSwitch(
          presetId,
          candidateEntries,
          resolved.addons,
          "switchActivePreset",
        );
      }

      // Camino de apply/add/remove (sin pendingOperation, o con un type
      // distinto de "switchActivePreset"): el operationType de resume es
      // "applyActiveSet" (la instancia elevada rehidrata el Active_Set
      // candidato y lo aplica como fusión completa). P-30, Paso 4.5b: hacia
      // el preset ACTIVO, resuelto FRESCO acá — a diferencia de
      // `switchActivePreset` (que SÍ necesita el `presetId` viajado en la
      // `PendingOperation`, porque el destino es DISTINTO del activo actual),
      // acá el preset activo NO cambió durante la elevación (nadie más pudo
      // tocarlo en el ínterin), así que releerlo de `LocalStore` alcanza.
      const activePresetId = this.#store.getActivePresetId();
      if (activePresetId === null) {
        return this.#failure(
          "No hay ningún preset activo. Esto no debería pasar en una instalación normal.",
        );
      }
      return await this.#materializeActivePreset(
        activePresetId,
        candidateEntries,
        resolved.addons,
        "applyActiveSet",
      );
    } finally {
      // El resume no debería producir "elevating" (se salteó el chequeo); en
      // cualquier desenlace (éxito o fallo) se limpia el estado de sesión.
      this.#store.clearPendingSession();
    }
  }

  /**
   * Camino común de los 3 métodos públicos (18.1): chequea el juego, dispara la
   * elevación PROACTIVA y, si procede, materializa. Devuelve el OperationResult.
   *
   * Paso 0 (P-30, Paso 4.5b): resuelve el preset ACTIVO ANTES de cualquier
   * otra cosa — `applyActiveSet`/`addAddon`/`removeAddon` ya NO materializan
   * hacia un `modsvsFolder` fijo, sino hacia la carpeta técnica del preset
   * activo (`#materializeActivePreset`), igual que `switchActivePreset` lo
   * hace para su destino. Si no hay preset activo (edge case que no debería
   * ocurrir en una instalación normal: la migración de `LocalStore` siempre
   * deja uno), corta con un fallo definitivo ANTES de emitir "guard" — ni
   * siquiera vale la pena chequear el juego si no hay dónde materializar.
   */
  async #runPublic(
    entries: AddonManifestEntry[],
    operationType: PendingOperation["type"],
  ): Promise<OperationResult> {
    const activePresetId = this.#store.getActivePresetId();
    if (activePresetId === null) {
      return this.#failure(
        "No hay ningún preset activo. Esto no debería pasar en una instalación normal.",
      );
    }

    // Paso 1 — Precondición: el juego no puede estar corriendo (Req 4.1, 4.2).
    this.#emit("guard");
    if (await this.#processGuard.isGameRunning()) {
      return this.#failure(
        "El juego (left4dead2.exe) está en ejecución. Cerralo antes de aplicar cambios.",
      );
    }

    // Paso 2 — Resolver los ScannedAddon ANTES de la elevación (DECISIÓN 5): si un
    // addon candidato falta, la operación igual iba a fallar, así que se corta acá
    // para NO disparar un prompt UAC innecesario.
    this.#emit("scan");
    const resolved = await this.#resolveOrderedAddons(entries);
    if (resolved.kind === "outcome") return resolved.result;

    // Paso 3 — Elevación PROACTIVA (antes de cualquier escritura). Solo acá; el
    // resume (18.2) la saltea. Pasa el operationType REAL (P-15 resuelto).
    this.#emit("elevation");
    const proactive = await this.#elevation.ensureCanWrite(
      this.#paths.gameRoot,
      entries,
      operationType,
    );
    if (proactive.kind === "elevated-handoff") {
      return { status: "elevating" };
    }
    if (proactive.kind === "denied") {
      return this.#failure(
        `Se canceló la solicitud de permisos de administrador (UAC): ${proactive.reason}`,
      );
    }

    // proactive.kind === "already-writable" -> se puede escribir; materializar
    // hacia la carpeta técnica del preset activo (P-30, Paso 4.5b).
    return this.#materializeActivePreset(activePresetId, entries, resolved.addons, operationType);
  }

  /**
   * Resuelve el Active_Set candidato a `ScannedAddon[]` en Priority_Order
   * ASCENDENTE (Paso 2, DECISIÓN 5). Escanea la Workshop, mapea cada entry por
   * `id` y ordena. Si algún `addonId` NO aparece en el escaneo (desuscrito o
   * borrado), devuelve `{ kind: "outcome" }` con un fallo definitivo que lleva ese
   * `addonId`. Se llama ANTES de la elevación proactiva para no pedir UAC cuando la
   * operación igual iba a fallar por un addon faltante.
   */
  async #resolveOrderedAddons(
    entries: readonly AddonManifestEntry[],
  ): Promise<
    | { kind: "ok"; addons: ScannedAddon[] }
    | { kind: "outcome"; result: OperationResult }
  > {
    const scanned = await this.#scanner.scan(this.#paths.workshopFolder);
    const byId = new Map<string, ScannedAddon>(scanned.map((a) => [a.id, a]));
    const ordered = [...entries].sort((a, b) => a.priorityOrder - b.priorityOrder);
    const addons: ScannedAddon[] = [];
    for (const entry of ordered) {
      const addon = byId.get(entry.addonId);
      if (addon === undefined) {
        return {
          kind: "outcome",
          result: this.#failure(
            `El addon ${entry.addonId} no está en la Workshop (¿desuscrito o borrado?). No se puede fusionar.`,
            entry.addonId,
          ),
        };
      }
      addons.push(addon);
    }
    return { kind: "ok", addons };
  }

  /**
   * Deriva `destFolder`/`previousFolderName` a partir de `presetId` + el
   * estado YA en `LocalStore` (`getActivePresetId`), delega en `#materialize`,
   * y — SOLO si tuvo éxito — actualiza el puntero de activo (P-30, Paso 3.5).
   * COMPARTIDO por `switchActivePreset` (camino directo) y
   * `resumePendingOperation` (resume de un switch interrumpido por elevación
   * UAC): ambos necesitan EXACTAMENTE la misma derivación, y centralizarla acá
   * evita que un futuro cambio la actualice en un solo lugar y no en el otro
   * (justo el tipo de bug que cerró esta tarea).
   */
  async #materializePresetSwitch(
    presetId: string,
    entries: readonly AddonManifestEntry[],
    orderedAddons: readonly ScannedAddon[],
    operationType: PendingOperation["type"],
  ): Promise<OperationResult> {
    // El preset ANTERIOR se quita de gameinfo.txt SOLO si había uno distinto
    // del destino (si ya era el activo, no hay nada que quitar; DECISIÓN 7 en
    // game-info-editor.ts reduce switchFolderEntry a ensureModsvsFirst cuando
    // `previousFolderName` es `null`).
    const activePresetId = this.#store.getActivePresetId();
    const previousFolderName =
      activePresetId !== null && activePresetId !== presetId ? activePresetId : null;

    const destFolder = joinWindowsPath(this.#paths.gameRoot, presetId);
    const result = await this.#materialize(
      entries,
      orderedAddons,
      operationType,
      destFolder,
      presetId,
      previousFolderName,
      // persistOnSuccess: null — las entries del preset NO cambian durante un
      // switch (P-30, Paso 4.5b); lo único que cambia es el puntero de
      // activo, y eso se hace ACÁ ABAJO, no vía #materialize.
      null,
    );

    // Puntero de activo: SOLO se actualiza si `#materialize` tuvo éxito
    // (nunca ante "failure" ni "elevating") — el mismo criterio que evita que
    // gameinfo.txt quede inconsistente aplica acá: el puntero de LocalStore
    // tampoco debe adelantarse a un cambio que no se completó.
    if (result.status === "success") {
      this.#store.setActivePresetId(presetId);
    }
    return result;
  }

  /**
   * Materializa hacia la carpeta técnica del preset ACTIVO (P-30, Paso 4.5b):
   * usado por `#runPublic` (`applyActiveSet`/`addAddon`/`removeAddon`) y por
   * el resume de esas operaciones. A diferencia de `#materializePresetSwitch`
   * (que SÍ cambia cuál preset está activo, así que quita la entrada del
   * preset ANTERIOR de gameinfo.txt), acá el preset activo NO cambia — solo
   * su contenido — así que `previousGameInfoFolderName` es SIEMPRE `null`. Al
   * éxito, persiste `entries` en el preset activo con `updatePresetEntries`
   * (reemplaza al `LocalStore.saveManifest` DEPRECADO, ver `local-store.ts`).
   */
  async #materializeActivePreset(
    presetId: string,
    entries: readonly AddonManifestEntry[],
    orderedAddons: readonly ScannedAddon[],
    operationType: PendingOperation["type"],
  ): Promise<OperationResult> {
    const destFolder = joinWindowsPath(this.#paths.gameRoot, presetId);
    return this.#materialize(
      entries,
      orderedAddons,
      operationType,
      destFolder,
      presetId,
      null,
      () => this.#store.updatePresetEntries(presetId, [...entries]),
    );
  }

  /**
   * Materialización COMPARTIDA (usada por los 3 métodos públicos legados tras
   * pasar la elevación proactiva, por el resume de 18.2 que la saltea, y por
   * `switchActivePreset`/su resume (P-30, Pasos 3 y 3.5)):
   *   backup -> merge -> instalar -> gameinfo -> saveManifest. Crea y LIMPIA el
   *   workDir (finally, resuelve P-14).
   *
   * Recibe los `orderedAddons` YA resueltos (por `#resolveOrderedAddons`, invocado
   * por el llamador antes de la elevación). NO ejecuta el chequeo de `ProcessGuard`,
   * ni la elevación proactiva, ni el escaneo/resolución: eso es del camino público
   * (`#runPublic`), del resume (`resumePendingOperation`) o de `switchActivePreset`.
   *
   * `destFolder`/`gameInfoFolderName`/`previousGameInfoFolderName` (P-30, Paso
   * 3): generalizan lo que antes era SIEMPRE `this.#paths.modsvsFolder`/
   * `"modsvs"`/`null`. `switchActivePreset` pasa la carpeta técnica del
   * preset destino y, si corresponde, la del preset anterior para que
   * `GameInfoEditor.switchFolderEntry` la quite en la MISMA escritura (ver
   * DECISIÓN 7 en `game-info-editor.ts`).
   *
   * `persistOnSuccess` (P-30, Paso 4.5b): QUÉ persistir en LocalStore si TODO
   * salió bien, o `null` si no hay nada nuevo que guardar. Antes de este paso,
   * el Paso 8 SIEMPRE llamaba `LocalStore.saveManifest` (ahora DEPRECADO,
   * dato histórico de solo lectura — ver DECISIÓN en `local-store.ts`);
   * `#materializeActivePreset` (apply/add/remove, y su resume) pasa un
   * callback que llama `updatePresetEntries` sobre el preset activo;
   * `#materializePresetSwitch` pasa `null` (las `entries` del preset NO
   * cambiaron durante un switch, solo la carpeta activa — eso lo persiste
   * `setActivePresetId` DESPUÉS de que `#materialize` retorna). Parametrizarlo
   * evita bifurcar Paso 8/9 en cada caller: el step de progreso
   * `"saveManifest"` solo se emite si `persistOnSuccess` no es `null`.
   */
  async #materialize(
    entries: readonly AddonManifestEntry[],
    orderedAddons: readonly ScannedAddon[],
    operationType: PendingOperation["type"],
    destFolder: string,
    gameInfoFolderName: string,
    previousGameInfoFolderName: string | null,
    persistOnSuccess: (() => void) | null,
  ): Promise<OperationResult> {
    // La resolución de ScannedAddon (Paso 2, DECISIÓN 5) ya la hizo el llamador
    // (`#runPublic`/`resumePendingOperation`/`switchActivePreset`) vía
    // `#resolveOrderedAddons`, ANTES de la elevación proactiva. Acá se recibe
    // ya resuelta y ordenada.
    //
    // (P-30, Paso 3.5) `presetIdForResume`: el id a incluir en la
    // `PendingOperation` reactiva que arma `#writeStep`, SOLO si
    // `operationType === "switchActivePreset"` — en ese caso (y SOLO en ese
    // caso) `gameInfoFolderName` ES el id del preset destino, por construcción
    // de `switchActivePreset`/`resumePendingOperation` (ambos pasan
    // `presetId` en ese mismo parámetro vía `#materializePresetSwitch`). Se
    // deriva en vez de agregar un séptimo parámetro redundante que repetiría
    // el mismo valor.
    const presetIdForResume = operationType === "switchActivePreset" ? gameInfoFolderName : null;
    const workDir = joinWindowsPath(this.#workRoot, `merge-${Date.now()}-${this.#workSeq++}`);
    try {
      await this.#fs.ensureDir(workDir);

      // BUG-009 — Crear `destFolder` ANTES de backup/instalar (Cambio 1 del
      // design; generalizado en P-30 Paso 3 — antes esto era SIEMPRE `modsvs`).
      //
      // En una instalación fresca (o un preset nunca antes fusionado) `destFolder`
      // todavía no existe, y ni `BackupManager` (que por DECISIÓN 4 NO crea
      // directorios; su `BackupFileSystem` solo expone `exists` + `copyFile`) ni
      // `copyFile` (sobre `fs.copyFile`, que no crea el directorio padre) la
      // crean. Sin esta línea, el backup/instalar fallaría por `ENOENT` o
      // desviaría el `.vpk` fuera de `destFolder`. Va acá y NO en `BackupManager`
      // porque `#materialize` es el ÚNICO componente que coordina las TRES
      // escrituras del Game_Root (backup, instalar, gameinfo) y ya posee
      // `MergeOrchestratorFileSystem.ensureDir` (lo usa para el `workDir`): crear
      // la carpeta una sola vez acá garantiza que exista para los tres pasos
      // posteriores, sin violar el contrato mínimo de `BackupManager` ni
      // duplicar la responsabilidad. `ensureDir` es recursivo e idempotente: si
      // `destFolder` ya existe es un no-op y el caso ya funcional queda
      // inalterado (preserva 3.7).
      //
      // Va envuelto en `#writeStep` (igual que backup/instalar/gameinfo) porque es
      // una escritura en el Game_Root: un `EACCES`/`EPERM` al crear `destFolder` bajo
      // un directorio protegido debe disparar la elevación reactiva
      // (`handleWriteFailure`) en vez de abortar (coherente con 3.3). Se reutiliza
      // el emit "backup" —sin agregar un step nuevo a `MergeProgressEvent`— porque
      // esta creación es preparación del backup: es el paso más simple y coherente.
      this.#emit("backup");
      const destFolderResult = await this.#writeStep(entries, operationType, presetIdForResume, () =>
        this.#fs.ensureDir(destFolder),
      );
      if (destFolderResult.kind === "outcome") return destFolderResult.result;

      // Paso 4 — Backup (escritura en Game_Root -> reactivo).
      this.#emit("backup");
      const backupResult = await this.#writeStep(entries, operationType, presetIdForResume, () =>
        this.#backup.backupExisting(destFolder),
      );
      if (backupResult.kind === "outcome") return backupResult.result;

      // Paso 5 — Merge (opera en el workDir temporal, FUERA del Game_Root). Sus
      // errores (VpkToolError) NO son de permisos: se propagan como fallo
      // definitivo con el addonId que identifican (Req 6.12). NO va por #writeStep.
      let mergeReport;
      let mergedVpkPath: string;
      this.#emit("merge");
      try {
        const merged = await this.#merge.merge(orderedAddons, this.#paths, workDir);
        mergedVpkPath = merged.vpkPath;
        mergeReport = merged.report;
      } catch (err) {
        return this.#failureFromError(err);
      }

      // Paso 6 — Instalar: copiar el .vpk fusionado a destFolder (escritura en
      // Game_Root -> reactivo).
      const installTarget = joinWindowsPath(destFolder, INSTALLED_VPK_NAME);
      this.#emit("install");
      const installResult = await this.#writeStep(entries, operationType, presetIdForResume, () =>
        this.#fs.copyFile(mergedVpkPath, installTarget),
      );
      if (installResult.kind === "outcome") return installResult.result;

      // Paso 7 — GameInfo (escritura en Game_Root -> reactivo). UNA SOLA
      // escritura que, si corresponde, quita la entrada del preset ANTERIOR y
      // asegura la del NUEVO (ver DECISIÓN 7 en game-info-editor.ts: nunca dos
      // escrituras separadas, para que el archivo nunca quede sin ninguna
      // carpeta referenciada a mitad de camino). Un GameInfoEditError
      // (SearchPaths ausente/malformado) NO es de permisos: handleWriteFailure
      // lo devuelve como already-writable y se propaga como fallo definitivo.
      this.#emit("gameinfo");
      const gameInfoResult = await this.#writeStep(entries, operationType, presetIdForResume, () =>
        this.#gameInfo.switchFolderEntry(
          this.#paths.gameInfoFile,
          previousGameInfoFolderName,
          gameInfoFolderName,
        ),
      );
      if (gameInfoResult.kind === "outcome") return gameInfoResult.result;

      // Paso 8 — Persistir (base local, NO Game_Root: sin manejo reactivo),
      // SOLO si el llamador dio algo que persistir (P-30, Paso 4.5b).
      if (persistOnSuccess !== null) {
        this.#emit("saveManifest");
        persistOnSuccess();
      }

      // Paso 9 — Éxito. "done" se emite JUSTO ANTES de retornar el success.
      this.#emit("done");
      return {
        status: "success",
        report: mergeReport,
        installedManifest: [...entries],
      };
    } finally {
      // SIEMPRE (éxito, fallo o elevación): limpiar el workDir (resuelve P-14).
      await this.#fs.removeDir(workDir);
    }
  }

  /**
   * Envuelve una escritura real en el Game_Root con el manejo REACTIVO uniforme
   * (DECISIÓN 6). Devuelve:
   *   - `{ kind: "ok", value }` si la escritura tuvo éxito (el flujo continúa).
   *   - `{ kind: "outcome", result }` si hay que CORTAR el flujo con ese
   *     OperationResult (fallo definitivo o "elevating").
   *
   * Ante un error: lo pasa a `handleWriteFailure`. Si es `elevated-handoff`,
   * corta con `status: "elevating"`. Si es `denied`, corta con fallo por UAC
   * cancelado. Si es `already-writable` (no era de permisos), corta con el fallo
   * definitivo derivado del error original.
   *
   * `presetId` (P-30, Paso 3.5, cierra DECISIÓN 8): si no es `null`, se incluye
   * en la `PendingOperation` reactiva que se persiste ante un `elevated-handoff`
   * a MITAD de un `switchActivePreset` — sin esto, un fallo de permisos en
   * cualquiera de los 4 pasos de `#materialize` (crear destFolder, backup,
   * instalar, gameinfo) perdía el `presetId` y el resume caía, incorrectamente,
   * al camino legado hacia `modsvs` (el mismo bug que motivó este paso, pero
   * por la vía REACTIVA en vez de la proactiva).
   */
  async #writeStep<T>(
    entries: readonly AddonManifestEntry[],
    operationType: PendingOperation["type"],
    presetId: string | null,
    step: () => Promise<T>,
  ): Promise<{ kind: "ok"; value: T } | { kind: "outcome"; result: OperationResult }> {
    try {
      const value = await step();
      return { kind: "ok", value };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      const pending: PendingOperation =
        presetId !== null
          ? { type: operationType, resumeHandle: PENDING_SESSION_HANDLE, presetId }
          : { type: operationType, resumeHandle: PENDING_SESSION_HANDLE };
      const outcome: ElevationOutcome = await this.#elevation.handleWriteFailure(
        error,
        pending,
        entries,
      );
      if (outcome.kind === "elevated-handoff") {
        return { kind: "outcome", result: { status: "elevating" } };
      }
      if (outcome.kind === "denied") {
        return {
          kind: "outcome",
          result: this.#failure(
            `Se canceló la solicitud de permisos de administrador (UAC): ${outcome.reason}`,
          ),
        };
      }
      // already-writable: el error NO era de permisos. Fallo definitivo derivado
      // del error original (identifica el motivo; sin elevar).
      return { kind: "outcome", result: this.#failureFromError(error) };
    }
  }

  /**
   * Traduce un error capturado a un OperationResult de fallo definitivo, vía
   * `#failure` (emite `"failed"` — cubre tanto el catch de `VpkToolError` en
   * `#materialize` como la rama `already-writable` de `#writeStep`).
   */
  #failureFromError(err: unknown): OperationResult {
    if (err instanceof GameInfoEditError) {
      return this.#failure(`No se pudo editar gameinfo.txt (${err.reason}): ${err.message}`);
    }
    // VpkToolError lleva addonId; se propaga si está presente (Req 6.12).
    const e = err as { message?: string; addonId?: string };
    const message = typeof e.message === "string" ? e.message : String(err);
    if (typeof e.addonId === "string") {
      return this.#failure(message, e.addonId);
    }
    return this.#failure(message);
  }
}
