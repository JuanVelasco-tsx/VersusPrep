/**
 * Handlers ipcMain.handle de la capa IPC (Tarea 20.2).
 *
 * Cada canal delega en una instancia de dominio recibida por INYECCIÓN (mismo
 * patrón que todo el dominio: este módulo no construye PathDetector/AddonScanner/
 * VScriptDetector/LocalStore/MergeOrchestrator, los recibe ya ensamblados desde
 * el composition root, Tarea 20.4). Por eso `ipcMain` y `WebContents` se importan
 * SOLO como tipo: el módulo no depende del runtime de Electron y es testeable con
 * dobles simples (Tarea 20.3).
 */
import type { IpcMain, WebContents } from "electron";

import { IPC_CHANNELS } from "./ipc-contract.js";
import type { ResumeState, SettablePathField } from "./ipc-contract.js";
import { DEFAULT_VPK_CONCURRENCY } from "../domain/index.js";
import type {
  AddonManifestEntry,
  AddonScanner,
  GamePaths,
  LocalStore,
  ManualPathRequest,
  MergeOrchestrator,
  MergeProgressListener,
  PathDetector,
  ScannedAddon,
  TitleCache,
  VScriptClassification,
  VScriptDetector,
} from "../domain/index.js";

/** Dependencias inyectadas por el composition root (Tarea 20.4). */
export interface IpcHandlersDeps {
  pathDetector: PathDetector;
  addonScanner: AddonScanner;
  vscriptDetector: VScriptDetector;
  localStore: LocalStore;
  /** Instancia YA construida, con `onProgress` ya cableado por la 20.4. */
  mergeOrchestrator: MergeOrchestrator;
  /**
   * Accesor al estado de resume bufferizado (Decisión D2a-i). El buffer y su
   * ciclo de vida son responsabilidad del composition root; acá solo se lee.
   */
  getResumeState: () => ResumeState | null;
  /**
   * Accesor al booleano calculado UNA SOLA VEZ en el arranque (ver
   * `StartupOutcome.willNeedElevation`, composition-root.ts). Fijo para toda
   * la sesión: el composition root (main.ts) lo cierra sobre el `outcome` ya
   * resuelto, no lo recalcula por invocación.
   */
  getWillNeedElevation: () => boolean;
  /**
   * (BUG-004) Accesor al HECHO ESTÁTICO `isResuming` calculado en el arranque
   * (ver `StartupOutcome.isResuming`, composition-root.ts): `true` si este
   * proceso arrancó para resumir una sesión pendiente. Fijo para toda la vida
   * del proceso; el composition root lo cierra sobre el `outcome`.
   */
  getIsResuming: () => boolean;
  /**
   * (BUG-001) Cache en memoria de títulos id->título. Lo POBLA el handler
   * `addons:scan` cuando escanea (setMany), y el handler `addons:titles` lo LEE
   * (snapshot). Compartido por el composition root entre ambos.
   */
  titleCache: TitleCache;
  /**
   * Handoff de elevación: se invoca cuando una operación de escritura resuelve
   * `status: "elevating"` (se relanzó una instancia elevada vía UAC). El
   * composition root (main.ts) la implementa con `app.quit()` para CERRAR esta
   * instancia sin privilegios, cumpliendo el "reemplazo total, no coexisten" del
   * diseño (ElevationService, Decisión 1 del ciclo de vida; tarea 17.1). Este
   * módulo NO conoce `app` (sigue importando electron solo como tipo); recibe la
   * acción de cierre inyectada, igual que el resto de sus dependencias.
   */
  onElevatedHandoff: () => void;
}

/**
 * Clasifica una lista de addons con concurrencia ACOTADA (pool de workers),
 * preservando el orden posicional de `addons` en el resultado (escribe por
 * índice, no por orden de finalización). Evita lanzar N `vpk.exe` en paralelo
 * sin límite para Workshops grandes. Usa `DEFAULT_VPK_CONCURRENCY`
 * (`vpk-tool.ts`), compartida con `MergeEngine.preview` (Sección 21.2,
 * hallazgo de `/code-review ultra`) para que ambos límites no puedan
 * desincronizarse.
 */
async function classifyWithBoundedConcurrency(
  vscriptDetector: VScriptDetector,
  addons: readonly ScannedAddon[],
): Promise<VScriptClassification[]> {
  const results: VScriptClassification[] = new Array(addons.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      const addon = addons[index];
      // noUncheckedIndexedAccess: addon es ScannedAddon | undefined; el
      // undefined solo ocurre cuando index salio de rango -> fin del worker.
      if (addon === undefined) return;
      results[index] = await vscriptDetector.classify(addon);
    }
  }
  const poolSize = Math.min(DEFAULT_VPK_CONCURRENCY, addons.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

/**
 * Traduce un `SettablePathField` (pantalla de Configuración, P-37) al
 * `ManualPathRequest` que ya entiende `PathDetector`/`ManualPathProvider`: NO
 * duplica el mapeo campo->diálogo (eso sigue siendo exclusivo de
 * `manual-path-provider.ts#toRequiredPathOptions`), solo decide qué `kind` de
 * request corresponde a cada campo. `steamPath` es el único caso especial
 * (`kind: "steam-path"`); el resto de `SettablePathField` ES un
 * `RequiredPathKey`, así que cae directo en `kind: "required-path"`.
 */
function toManualPathRequest(field: SettablePathField): ManualPathRequest {
  if (field === "steamPath") {
    return { kind: "steam-path" };
  }
  return { kind: "required-path", pathKey: field };
}

/**
 * Traduce eventos de progreso del MergeOrchestrator a `webContents.send`
 * (Decisión previa de la sesión 20: el broadcaster vive acá para que la 20.3
 * lo pueda testear sin un MergeOrchestrator real). La 20.4 la usa al construir
 * `MergeOrchestratorDeps.onProgress`. `getWebContents` puede devolver
 * `undefined`/`null` (p. ej. la ventana aún no existe durante un resume
 * temprano); en ese caso el evento simplemente no se envía por acá — el
 * buffer de resume (D2a-i) es responsabilidad separada del composition root.
 */
export function createProgressBroadcaster(
  getWebContents: () => Pick<WebContents, "send"> | undefined | null,
): MergeProgressListener {
  return (event) => {
    getWebContents()?.send(IPC_CHANNELS.mergeProgress, event);
  };
}

/**
 * Registra los veinte canales `invoke` sobre el `ipcMain` inyectado (conteo ya
 * desactualizado antes de P-37/P-30, que sumaron `paths:get`/`paths:setManual`
 * para la pantalla de Configuración y los seis canales `presets:*`). NO incluye
 * `merge:onProgress`: ese es un canal push (`webContents.send`), sin `handle`
 * asociado; ver `createProgressBroadcaster`.
 *
 * `activeSet:preview` es el ÚNICO canal que NO pasa por `guardedWrite`:
 * `MergeOrchestrator.previewActiveSet` es de solo lectura (ver DECISIÓN 7 en
 * `merge-orchestrator.ts`) y no compite por `operationInFlight` con
 * apply/add/remove.
 */
export function registerIpcHandlers(
  ipcMain: Pick<IpcMain, "handle">,
  deps: IpcHandlersDeps,
): void {
  // Bloqueo de escrituras concurrentes (apply/add/remove nunca solapadas).
  // Closure de esta llamada, NO estado de módulo: cada registro (p. ej. cada
  // test) tiene su propio flag independiente.
  let operationInFlight = false;
  async function guardedWrite(
    run: () => ReturnType<MergeOrchestrator["applyActiveSet"]>,
  ): ReturnType<MergeOrchestrator["applyActiveSet"]> {
    if (operationInFlight) {
      return {
        status: "failure",
        error:
          "Ya hay una operación de fusión en curso. Esperá a que termine antes de iniciar otra.",
      };
    }
    operationInFlight = true;
    try {
      const result = await run();
      // CUIDADO DE SECUENCIA (DECISIÓN): el handoff de elevación se programa
      // recién DESPUÉS de tener el `result` listo, y se difiere con
      // `setImmediate` para que este handler RETORNE primero — el valor de
      // retorno es lo que `ipcMain.handle` serializa y envía al renderer por
      // IPC. Si `app.quit()` (que dispara `onElevatedHandoff`) arrancara ANTES
      // del return, se arriesga a que el reply nunca viaje. `app.quit()` no
      // mata el proceso de inmediato (corre `before-quit`, que cierra la DB),
      // pero igual se difiere para NO depender de ese timing implícito: el
      // return sale en este tick, el quit arranca en el próximo.
      if (result.status === "elevating") {
        setImmediate(() => deps.onElevatedHandoff());
      }
      return result;
    } finally {
      // RIESGO ACEPTADO: `operationInFlight` vuelve a `false` acá (síncrono, en
      // este tick) ANTES de que corra el `setImmediate` del handoff (macrotask,
      // próximo tick). En esa ventana de microsegundos, un segundo invoke de
      // escritura podría colarse y disparar un segundo relanzamiento elevado
      // antes de que `app.quit()` cierre esta instancia. Es irrealizable para un
      // click humano (la ventana es del orden de microsegundos y la app ya está
      // cerrándose), así que NO se bloquea: dejar `operationInFlight` en `true`
      // hasta el quit real complicaría el flujo normal por un caso que no puede
      // ganar una interacción humana. Se documenta como riesgo consciente.
      operationInFlight = false;
    }
  }

  ipcMain.handle(IPC_CHANNELS.detectPaths, async () => {
    const result = await deps.pathDetector.detect();
    // Decisión D1: persistir SIEMPRE que el resultado esté ready, sin
    // importar el `source` (auto o manual) — ambos ya pasaron verificación
    // en disco (invariante de pathsReady/PathDetectionResult).
    if (result.kind === "ready") {
      deps.localStore.savePaths(result.paths);
    }
    return result;
  });

  // (P-37) LECTURA PURA de las rutas persistidas: a diferencia de
  // `paths:detect`, no dispara ningún diálogo nativo ni re-detección. La
  // pantalla de Configuración la usa para pintar el estado ACTUAL al montar.
  ipcMain.handle(IPC_CHANNELS.getPaths, () => deps.localStore.getPaths());

  // (P-37) Selección manual de UN campo puntual desde la pantalla de
  // Configuración. Reusa `PathDetector.resolveManualPath` (mismo diálogo +
  // misma re-verificación en disco que ya usa `detect()` internamente) y, si
  // el usuario elige una ruta, la persiste con el MISMO `savePaths` que usa
  // el flujo de detección inicial (decisión D1 de arriba).
  ipcMain.handle(IPC_CHANNELS.setManualPath, async (_event, field: SettablePathField) => {
    const chosen = await deps.pathDetector.resolveManualPath(toManualPathRequest(field));
    if (chosen === null) {
      return { kind: "cancelled" };
    }
    deps.localStore.savePaths({ [field]: chosen } as Partial<GamePaths>);
    return { kind: "selected", paths: deps.localStore.getPaths() };
  });

  ipcMain.handle(IPC_CHANNELS.scanAddons, async () => {
    const paths = deps.localStore.getPaths();
    if (paths === null) {
      // Decisión D5: precondición de orden de uso, no un modo de fallo de
      // dominio — no hay unión de error tipada en `Promise<ScannedAddon[]>`.
      throw new Error(
        "Rutas no detectadas: invocá 'paths:detect' antes de escanear addons.",
      );
    }
    const scanned = await deps.addonScanner.scan(paths.workshopFolder);
    // (BUG-001) Poblar el cache de títulos con este escaneo, para que el panel
    // "Activos"/preview resuelvan id->título SIN re-escanear la Workshop.
    deps.titleCache.setMany(scanned);
    return scanned;
  });

  ipcMain.handle(
    IPC_CHANNELS.classifyVScript,
    async (_event, addons: ScannedAddon[]) =>
      classifyWithBoundedConcurrency(deps.vscriptDetector, addons),
  );

  // (P-30, Paso 4.5b) Ya NO lee `LocalStore.getManifest()` (DEPRECADO, dato
  // histórico de solo lectura — ver `local-store.ts`): devuelve las entries
  // del preset ACTUALMENTE activo, mismo criterio que ahora usa
  // `MergeOrchestrator.addAddon`/`removeAddon`/`applyActiveSet`
  // (`#currentPresetEntries`). `[]` en el edge case sin ningún preset activo
  // (no debería ocurrir en una instalación normal).
  ipcMain.handle(IPC_CHANNELS.getActiveSet, () => {
    const activePresetId = deps.localStore.getActivePresetId();
    if (activePresetId === null) return [];
    return deps.localStore.getPreset(activePresetId)?.entries ?? [];
  });

  ipcMain.handle(
    IPC_CHANNELS.previewActiveSet,
    async (_event, entries: AddonManifestEntry[]) =>
      deps.mergeOrchestrator.previewActiveSet(entries),
  );

  ipcMain.handle(
    IPC_CHANNELS.applyActiveSet,
    async (_event, entries: AddonManifestEntry[]) =>
      guardedWrite(() => deps.mergeOrchestrator.applyActiveSet(entries)),
  );

  ipcMain.handle(
    IPC_CHANNELS.addAddon,
    async (_event, addonId: string, priorityOrder: number) =>
      guardedWrite(() => deps.mergeOrchestrator.addAddon(addonId, priorityOrder)),
  );

  ipcMain.handle(IPC_CHANNELS.removeAddon, async (_event, addonId: string) =>
    guardedWrite(() => deps.mergeOrchestrator.removeAddon(addonId)),
  );

  // (P-31+P-22, Paso 1) Variantes en lote — mismo guardedWrite que las
  // singulares (una operación de escritura a la vez, ver DECISIÓN 9 en
  // merge-orchestrator.ts).
  ipcMain.handle(IPC_CHANNELS.addAddons, async (_event, addonIds: string[]) =>
    guardedWrite(() => deps.mergeOrchestrator.addAddons(addonIds)),
  );

  ipcMain.handle(IPC_CHANNELS.removeAddons, async (_event, addonIds: string[]) =>
    guardedWrite(() => deps.mergeOrchestrator.removeAddons(addonIds)),
  );

  ipcMain.handle(IPC_CHANNELS.getResumeState, () => deps.getResumeState());

  ipcMain.handle(IPC_CHANNELS.willNeedElevation, () => deps.getWillNeedElevation());

  ipcMain.handle(IPC_CHANNELS.isResuming, () => deps.getIsResuming());

  ipcMain.handle(IPC_CHANNELS.getTitles, () => deps.titleCache.snapshot());

  // ---------------------------------------------------------------------------
  // Presets (P-30, Paso 4). La capa de dominio (LocalStore/MergeOrchestrator) ya
  // está completa desde los Pasos 1-3.5; estos seis handlers SOLO la exponen.
  // ---------------------------------------------------------------------------

  ipcMain.handle(IPC_CHANNELS.listPresets, () => deps.localStore.listPresets());

  // DECISIÓN (P-30, Paso 4, punto 3 del pedido) — `entries` es OPCIONAL, con
  // default `[]`: un preset se puede crear VACÍO y (una vez que el resto del
  // sistema sepa editar el preset activo — ver el hallazgo de alcance
  // reportado en este mismo paso) completarse después vía el flujo normal de
  // Biblioteca/Activos. Se eligió esta opción, en vez de exigir `entries`
  // completo al crear, porque es la que MENOS cambia el flujo existente: no
  // hace falta ningún selector nuevo de addons ANTES de poder crear un
  // preset. `name` se valida no-vacío (mismo criterio que `renamePreset`
  // abajo): un preset sin nombre es un error de UI evidente, no un estado
  // válido a persistir.
  ipcMain.handle(
    IPC_CHANNELS.createPreset,
    (_event, name: string, entries?: AddonManifestEntry[], description?: string) => {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        throw new Error("El nombre del preset no puede estar vacío.");
      }
      // `description` OPCIONAL (bug/feature post Paso 5): se recorta y una
      // cadena vacía tras el trim persiste como `null` (mismo criterio que
      // "sin descripción"), no como `""` — evita dos representaciones
      // distintas para el mismo estado "no hay descripción".
      const trimmedDescription = description?.trim();
      return deps.localStore.createPreset(
        trimmedName,
        entries ?? [],
        trimmedDescription !== undefined && trimmedDescription.length > 0
          ? trimmedDescription
          : null,
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.renamePreset, (_event, id: string, newName: string) => {
    const trimmedName = newName.trim();
    if (trimmedName.length === 0) {
      throw new Error("El nombre del preset no puede estar vacío.");
    }
    deps.localStore.renamePreset(id, trimmedName);
  });

  // DECISIÓN (P-30, Paso 4, punto 5 del pedido) — SE BLOQUEA borrar el preset
  // ACTIVO, en vez de permitirlo y dejar "sin preset activo". Es la opción
  // más segura: `LocalStore.deletePreset` (Paso 1) solo toca la fila de la
  // base — NO reescribe gameinfo.txt ni borra la carpeta técnica del preset
  // en disco. Si se permitiera borrar el activo, gameinfo.txt (y el juego)
  // seguirían apuntando a una carpeta que la app ya no reconoce como ningún
  // preset — un estado inconsistente sin forma de corregirlo desde la UI
  // hasta que existiera esa limpieza física (fuera del alcance de este
  // paso). Bloquear con un error claro obliga a cambiar de preset activo
  // PRIMERO (`presets:switch`, que sí actualiza gameinfo.txt correctamente),
  // momento en el que borrar el que quedó atrás ya es seguro.
  ipcMain.handle(IPC_CHANNELS.deletePreset, (_event, id: string) => {
    if (deps.localStore.getActivePresetId() === id) {
      throw new Error(
        "No se puede borrar el preset activo. Cambiá a otro preset primero.",
      );
    }
    deps.localStore.deletePreset(id);
  });

  // Mismo guardedWrite que apply/add/remove (DECISIÓN, punto 6 del pedido):
  // switchActivePreset también escribe en el Game_Root y puede disparar
  // elevación UAC, compitiendo por el ÚNICO slot de sesión pendiente del
  // LocalStore — nunca debe solaparse con apply/add/remove ni con otro
  // switch. El progreso viaja por el MISMO merge:onProgress (el
  // MergeOrchestrator ya inyectado emite por ahí, sin canal nuevo).
  ipcMain.handle(IPC_CHANNELS.switchActivePreset, async (_event, id: string) =>
    guardedWrite(() => deps.mergeOrchestrator.switchActivePreset(id)),
  );

  ipcMain.handle(IPC_CHANNELS.getActivePresetId, () => deps.localStore.getActivePresetId());
}
