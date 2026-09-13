/**
 * Contrato de canales IPC entre el proceso main y el renderer (Tarea 20.1).
 *
 * Única fuente de verdad de los NOMBRES de canal y las firmas de request/response.
 * Lo consumen tanto el preload (src/preload/preload.ts, expone la API tipada) como
 * los handlers ipcMain.handle (Tarea 20.2, src/main/app/ipc-handlers.ts).
 *
 * Import type-only del dominio: no arrastra runtime, solo tipos.
 */
import type {
  ActiveSetPreview,
  AddonManifestEntry,
  GamePaths,
  MergeProgressEvent,
  OperationResult,
  PathDetectionResult,
  RequiredPathKey,
  ScannedAddon,
  VScriptClassification,
} from "../domain/index.js";

/**
 * Campos de `GamePaths` que tienen un diálogo nativo de selección manual
 * asociado (pantalla de Configuración, P-37): los cinco `RequiredPathKey`
 * (`toRequiredPathOptions`, `manual-path-provider.ts`) más `steamPath`
 * (`ManualPathRequest.kind: "steam-path"`). `left4dead2Dir` queda AFUERA a
 * propósito: es un valor puramente DERIVADO (`<gameRoot>\left4dead2`,
 * `path-detector.ts#derivePaths`), nunca una ruta que el flujo existente
 * (arranque o esta pantalla) pida seleccionar de forma independiente — no hay
 * ningún `ManualPathRequest.kind` para pedirla sin inventar uno nuevo, que es
 * justo lo que esta tarea evita ("no dupliques esa lógica, reusala").
 */
export type SettablePathField = "steamPath" | RequiredPathKey;

/** Resultado de `paths:setManual` (pantalla de Configuración, P-37). */
export type SetManualPathResult =
  | {
      kind: "selected";
      /**
       * Snapshot de `LocalStore.getPaths()` INMEDIATAMENTE después de
       * persistir la ruta elegida (mismo mecanismo que ya usa el flujo de
       * detección inicial, `LocalStore.savePaths`). Puede seguir siendo
       * `null` en el caso extremo de que otras rutas requeridas todavía no
       * estén completas (ver DECISIÓN 4 en `local-store.ts`).
       */
      paths: GamePaths | null;
    }
  | { kind: "cancelled" };

export const IPC_CHANNELS = {
  detectPaths: "paths:detect",
  getPaths: "paths:get",
  setManualPath: "paths:setManual",
  scanAddons: "addons:scan",
  classifyVScript: "addons:classifyVScript",
  getActiveSet: "activeSet:get",
  previewActiveSet: "activeSet:preview",
  applyActiveSet: "activeSet:apply",
  addAddon: "activeSet:add",
  removeAddon: "activeSet:remove",
  getResumeState: "activeSet:resumeState",
  mergeProgress: "merge:onProgress",
  willNeedElevation: "willNeedElevation",
  isResuming: "activeSet:isResuming",
  getTitles: "addons:titles",
} as const;

/**
 * Respuesta de `activeSet:resumeState` (Decisión D2a-i, buffer + replay).
 * `null` si esta instancia NO arrancó por un relanzo elevado con sesión pendiente.
 * Si `result` es `null` pero el objeto no es `null`, la operación de resume sigue
 * en curso; los eventos siguientes llegan en vivo por `merge:onProgress`.
 */
export interface ResumeState {
  bufferedEvents: MergeProgressEvent[];
  result: OperationResult | null;
  /**
   * (BUG-007) Active_Set CANDIDATO que se está restaurando en este resume: la
   * selección + Priority_Order que el usuario tenía preparada antes del relanzo
   * elevado. Capturado del `getPendingSession()` del LocalStore ANTES de que
   * `resumePendingOperation()` limpie el pending, de modo que el renderer pueda
   * repintar la selección aunque el resume ya haya terminado.
   *
   * Semántica (espeja `getPendingSession()`, ver local-store.ts DECISIÓN 5):
   *  - lista con entradas: el candidato tal cual se persistió (en Priority_Order
   *    ascendente). El renderer repinta esa selección.
   *  - `[]`: sesión activa con candidato intencionalmente vacío (p. ej. se quitó
   *    el último addon). El renderer muestra una selección vacía, NO "sin resume".
   *
   * INVARIANTE: si el objeto `ResumeState` existe (no es `null`), `pendingEntries`
   * SIEMPRE está presente (nunca `undefined`). El caso "no hay resume" se
   * representa con el `ResumeState` entero en `null`, igual que hoy.
   *
   * DISPONIBILIDAD EN EL CICLO DE VIDA: `pendingEntries` está poblado desde el
   * PRIMER `getResumeState()` que el renderer haga tras montar (se captura al
   * construir el `resumeState` inicial en `runStartupSequence`, antes de que
   * `runResume()` limpie el pending). Está disponible tanto mientras `result` es
   * `null` (resume en curso) como después (resume terminado).
   */
  pendingEntries: AddonManifestEntry[];
}

/** API tipada que el preload expone en `window.l4d2Api`. */
export interface L4d2Api {
  detectPaths(): Promise<PathDetectionResult>;
  /**
   * Rutas actualmente persistidas (pantalla de Configuración, P-37), o `null`
   * si todavía no hay un `GamePaths` completo guardado. LECTURA PURA: a
   * diferencia de `detectPaths()`, NO dispara ningún diálogo nativo ni
   * re-detección — solo lee lo que `LocalStore.getPaths()` ya tiene.
   */
  getPaths(): Promise<GamePaths | null>;
  /**
   * Abre el diálogo nativo de selección manual para UN campo puntual de
   * `GamePaths` (pantalla de Configuración, P-37) y, si el usuario elige una
   * ruta existente, la persiste con `LocalStore.savePaths` (mismo mecanismo
   * que ya usa la detección inicial). `{ kind: "cancelled" }` si el usuario
   * cierra el diálogo sin elegir nada.
   */
  setManualPath(field: SettablePathField): Promise<SetManualPathResult>;
  scanAddons(): Promise<ScannedAddon[]>;
  classifyVScript(addons: ScannedAddon[]): Promise<VScriptClassification[]>;
  getActiveSet(): Promise<AddonManifestEntry[]>;
  /**
   * Calcula un preview de SOLO LECTURA de `entries` (colisiones, archivos a
   * empaquetar): no escribe nada en disco ni dispara elevación UAC (Sección
   * 21.2, capacidad agregada — ver `Context/04-historial-decisiones.md`).
   */
  previewActiveSet(entries: AddonManifestEntry[]): Promise<ActiveSetPreview>;
  applyActiveSet(entries: AddonManifestEntry[]): Promise<OperationResult>;
  addAddon(addonId: string, priorityOrder: number): Promise<OperationResult>;
  removeAddon(addonId: string): Promise<OperationResult>;
  getResumeState(): Promise<ResumeState | null>;
  /**
   * `true` si esta sesión va a necesitar elevación UAC en la primera escritura
   * protegida (calculado una sola vez al arranque, ver `StartupOutcome` en
   * composition-root.ts). Fijo para toda la sesión: `gameRoot` no cambia
   * mientras la app corre.
   */
  willNeedElevation(): Promise<boolean>;
  /**
   * (BUG-004) `true` si este proceso arrancó para RESUMIR una sesión pendiente
   * tras un relanzo elevado. HECHO ESTÁTICO fijo para toda la vida del proceso
   * (derivado de los argumentos de arranque, no de un estado mutable), así que
   * el renderer puede consultarlo una vez al montar sin ventana de carrera. Si
   * es `true`, el renderer muestra "Restaurando tu selección..." y escucha el
   * progreso en vivo por `onProgress`; el resultado terminal llega por
   * `getResumeState().result`.
   */
  isResuming(): Promise<boolean>;
  /**
   * (BUG-001) Títulos legibles conocidos por `addonId`, del cache en memoria
   * poblado por el último `scanAddons()` completo de la sesión. El panel
   * "Activos" lo consulta para mostrar títulos SIN re-escanear la Workshop; un
   * `addonId` ausente del mapa se muestra crudo como fallback temporal (nunca se
   * dispara una extracción de addoninfo en el camino caliente). `{}` si todavía
   * no corrió ningún escaneo en la sesión.
   */
  getTitles(): Promise<Record<string, string>>;
  /** Se suscribe al progreso; devuelve la función de desuscripción. */
  onProgress(listener: (event: MergeProgressEvent) => void): () => void;
}