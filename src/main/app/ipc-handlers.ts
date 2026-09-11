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
import type { ResumeState } from "./ipc-contract.js";
import { DEFAULT_VPK_CONCURRENCY } from "../domain/index.js";
import type {
  AddonManifestEntry,
  AddonScanner,
  LocalStore,
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
 * Registra los nueve canales `invoke` sobre el `ipcMain` inyectado. NO incluye
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

  ipcMain.handle(IPC_CHANNELS.getActiveSet, () => deps.localStore.getManifest());

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

  ipcMain.handle(IPC_CHANNELS.getResumeState, () => deps.getResumeState());

  ipcMain.handle(IPC_CHANNELS.willNeedElevation, () => deps.getWillNeedElevation());

  ipcMain.handle(IPC_CHANNELS.isResuming, () => deps.getIsResuming());

  ipcMain.handle(IPC_CHANNELS.getTitles, () => deps.titleCache.snapshot());
}