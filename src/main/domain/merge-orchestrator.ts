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
 *   6. Instalar en modsvs/               -> copiar el .vpk a modsvs/pak01_dir.vpk (Req 6.9).
 *   7. GameInfoEditor.ensureModsvsFirst()-> (Req 6.10).
 *   8. LocalStore.saveManifest()         -> (Req 8.1, 8.6).
 *   9. Notificar resultado (Req 6.11) — vía el OperationResult devuelto.
 *
 * Los pasos 4, 6 y 7 son las ÚNICAS escrituras reales en el Game_Root; van
 * envueltas en un manejo REACTIVO uniforme (ver `#writeStep`) que, ante
 * `EACCES`/`EPERM`, invoca `ElevationService.handleWriteFailure` para elevar y
 * reintentar en la instancia elevada en vez de abortar. El paso 5 (MergeEngine)
 * opera en el workDir temporal FUERA del Game_Root: sus errores (`VpkToolError`)
 * NO son de permisos y se propagan directo como fallo definitivo. El paso 8
 * (saveManifest) escribe en la base local del Manager, no en el Game_Root, así
 * que tampoco va envuelto.
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
 *  - `addAddon(addonId, priorityOrder)`: UPSERT sobre `LocalStore.getManifest()`
 *    (el Active_Set instalado). Si `addonId` ya está, se ACTUALIZA su
 *    `priorityOrder`; si no, se AGREGA. Motivo: "agregar" un addon ya presente es,
 *    naturalmente, reubicarlo en el Priority_Order; duplicarlo produciría un
 *    manifest inconsistente (el manifest usa `addonId` como clave única, ver
 *    `local-store.ts` DECISIÓN 3).
 *  - `removeAddon(addonId)`: FILTRA ese `addonId` de `LocalStore.getManifest()`.
 *    Es NO-OP (sin error) si el addon no estaba presente. Motivo: quitar algo que
 *    no está es un no-op idempotente, no un error; el resultado deseado (ese addon
 *    ausente del Active_Set) ya se cumple.
 *  - Ambas derivan el candidato del manifest INSTALADO y luego materializan una
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
  AddonManifestEntry,
  ElevationOutcome,
  GamePaths,
  OperationResult,
  PendingOperation,
  ScannedAddon,
} from "./types.js";

/** Separador de path de Windows, coherente con el resto del dominio. */
const DISK_SEPARATOR = "\\";

/** Nombre canónico del Merged_Package instalado en modsvs/. */
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
  }

  /**
   * Aplica un Active_Set candidato completo tal cual lo recibe (fusión completa
   * desde cero). Chequea el juego, resuelve elevación proactiva y materializa.
   */
  async applyActiveSet(entries: readonly AddonManifestEntry[]): Promise<OperationResult> {
    return this.#runPublic([...entries], "applyActiveSet");
  }

  /**
   * Agrega un addon al Active_Set instalado (UPSERT por `priorityOrder`, DECISIÓN
   * 4) y materializa la fusión completa del conjunto resultante.
   */
  async addAddon(addonId: string, priorityOrder: number): Promise<OperationResult> {
    const current = this.#store.getManifest();
    const next = current.filter((e) => e.addonId !== addonId);
    next.push({ addonId, priorityOrder });
    return this.#runPublic(next, "addAddon");
  }

  /**
   * Quita un addon del Active_Set instalado (filtra; no-op si ausente, DECISIÓN 4)
   * y materializa la fusión completa del conjunto resultante.
   */
  async removeAddon(addonId: string): Promise<OperationResult> {
    const current = this.#store.getManifest();
    const next = current.filter((e) => e.addonId !== addonId);
    return this.#runPublic(next, "removeAddon");
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
   */
  async resumePendingOperation(): Promise<OperationResult | null> {
    const pending = this.#store.getPendingSession();
    if (pending === null) return null; // no hay nada que resumir

    // Al resumir NO se re-chequea la elevación proactiva: la instancia ya está
    // elevada. El operationType de resume es "applyActiveSet" (la instancia
    // elevada rehidrata el Active_Set candidato y lo aplica como fusión completa).
    try {
      return await this.#materialize(pending, "applyActiveSet");
    } finally {
      // El resume no debería producir "elevating" (se salteó el chequeo); en
      // cualquier desenlace (éxito o fallo) se limpia el estado de sesión.
      this.#store.clearPendingSession();
    }
  }

  /**
   * Camino común de los 3 métodos públicos (18.1): chequea el juego, dispara la
   * elevación PROACTIVA y, si procede, materializa. Devuelve el OperationResult.
   */
  async #runPublic(
    entries: AddonManifestEntry[],
    operationType: PendingOperation["type"],
  ): Promise<OperationResult> {
    // Paso 1 — Precondición: el juego no puede estar corriendo (Req 4.1, 4.2).
    if (await this.#processGuard.isGameRunning()) {
      return {
        status: "failure",
        error: "El juego (left4dead2.exe) está en ejecución. Cerralo antes de aplicar cambios.",
      };
    }

    // Paso 3 — Elevación PROACTIVA (antes de cualquier escritura). Solo acá; el
    // resume (18.2) la saltea. Pasa el operationType REAL (P-15 resuelto).
    const proactive = await this.#elevation.ensureCanWrite(
      this.#paths.gameRoot,
      entries,
      operationType,
    );
    if (proactive.kind === "elevated-handoff") {
      return { status: "elevating" };
    }
    if (proactive.kind === "denied") {
      return {
        status: "failure",
        error: `Se canceló la solicitud de permisos de administrador (UAC): ${proactive.reason}`,
      };
    }

    // proactive.kind === "already-writable" -> se puede escribir; materializar.
    return this.#materialize(entries, operationType);
  }

  /**
   * Materialización COMPARTIDA (usada por los 3 métodos públicos tras pasar la
   * elevación proactiva, y por el resume de 18.2 que la saltea):
   *   escanear -> resolver ScannedAddon -> backup -> merge -> instalar -> gameinfo
   *   -> saveManifest. Crea y LIMPIA el workDir (finally, resuelve P-14).
   *
   * NO ejecuta el chequeo de `ProcessGuard` ni la elevación proactiva: eso es del
   * camino público (`#runPublic`). El resume entra directo acá.
   */
  async #materialize(
    entries: readonly AddonManifestEntry[],
    operationType: PendingOperation["type"],
  ): Promise<OperationResult> {
    // Paso 2 — Resolver los ScannedAddon del Active_Set candidato, en
    // Priority_Order ASCENDENTE. Un addon ausente del escaneo = fallo (DECISIÓN 5).
    const scanned = await this.#scanner.scan(this.#paths.workshopFolder);
    const byId = new Map<string, ScannedAddon>(scanned.map((a) => [a.id, a]));
    const ordered = [...entries].sort((a, b) => a.priorityOrder - b.priorityOrder);
    const orderedAddons: ScannedAddon[] = [];
    for (const entry of ordered) {
      const addon = byId.get(entry.addonId);
      if (addon === undefined) {
        return {
          status: "failure",
          error: `El addon ${entry.addonId} no está en la Workshop (¿desuscrito o borrado?). No se puede fusionar.`,
          addonId: entry.addonId,
        };
      }
      orderedAddons.push(addon);
    }

    const workDir = joinWindowsPath(this.#workRoot, `merge-${Date.now()}-${this.#workSeq++}`);
    try {
      await this.#fs.ensureDir(workDir);

      // Paso 4 — Backup (escritura en Game_Root -> reactivo).
      const backupResult = await this.#writeStep(entries, operationType, () =>
        this.#backup.backupExisting(this.#paths.modsvsFolder),
      );
      if (backupResult.kind === "outcome") return backupResult.result;

      // Paso 5 — Merge (opera en el workDir temporal, FUERA del Game_Root). Sus
      // errores (VpkToolError) NO son de permisos: se propagan como fallo
      // definitivo con el addonId que identifican (Req 6.12). NO va por #writeStep.
      let mergeReport;
      let mergedVpkPath: string;
      try {
        const merged = await this.#merge.merge(orderedAddons, this.#paths, workDir);
        mergedVpkPath = merged.vpkPath;
        mergeReport = merged.report;
      } catch (err) {
        return this.#failureFromError(err);
      }

      // Paso 6 — Instalar: copiar el .vpk fusionado a modsvs/ (escritura en
      // Game_Root -> reactivo).
      const installTarget = joinWindowsPath(this.#paths.modsvsFolder, INSTALLED_VPK_NAME);
      const installResult = await this.#writeStep(entries, operationType, () =>
        this.#fs.copyFile(mergedVpkPath, installTarget),
      );
      if (installResult.kind === "outcome") return installResult.result;

      // Paso 7 — GameInfo (escritura en Game_Root -> reactivo). Un GameInfoEditError
      // (SearchPaths ausente/malformado) NO es de permisos: handleWriteFailure lo
      // devuelve como already-writable y se propaga como fallo definitivo.
      const gameInfoResult = await this.#writeStep(entries, operationType, () =>
        this.#gameInfo.ensureModsvsFirst(this.#paths.gameInfoFile),
      );
      if (gameInfoResult.kind === "outcome") return gameInfoResult.result;

      // Paso 8 — Persistir el manifest instalado (base local, NO Game_Root: sin
      // manejo reactivo). El Active_Set candidato pasa a ser el instalado.
      this.#store.saveManifest([...entries]);

      // Paso 9 — Éxito.
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
   */
  async #writeStep<T>(
    entries: readonly AddonManifestEntry[],
    operationType: PendingOperation["type"],
    step: () => Promise<T>,
  ): Promise<{ kind: "ok"; value: T } | { kind: "outcome"; result: OperationResult }> {
    try {
      const value = await step();
      return { kind: "ok", value };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      const pending: PendingOperation = {
        type: operationType,
        resumeHandle: PENDING_SESSION_HANDLE,
      };
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
          result: {
            status: "failure",
            error: `Se canceló la solicitud de permisos de administrador (UAC): ${outcome.reason}`,
          },
        };
      }
      // already-writable: el error NO era de permisos. Fallo definitivo derivado
      // del error original (identifica el motivo; sin elevar).
      return { kind: "outcome", result: this.#failureFromError(error) };
    }
  }

  /** Traduce un error capturado a un OperationResult de fallo definitivo. */
  #failureFromError(err: unknown): OperationResult {
    if (err instanceof GameInfoEditError) {
      return {
        status: "failure",
        error: `No se pudo editar gameinfo.txt (${err.reason}): ${err.message}`,
      };
    }
    // VpkToolError lleva addonId; se propaga si está presente (Req 6.12).
    const e = err as { message?: string; addonId?: string };
    const message = typeof e.message === "string" ? e.message : String(err);
    if (typeof e.addonId === "string") {
      return { status: "failure", error: message, addonId: e.addonId };
    }
    return { status: "failure", error: message };
  }
}
