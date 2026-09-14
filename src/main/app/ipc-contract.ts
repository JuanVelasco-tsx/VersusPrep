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
  Preset,
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
  // (P-31+P-22, Paso 1) Variantes en LOTE — ver MergeOrchestrator.addAddons/
  // removeAddons (DECISIÓN 9): UNA sola fusión para N addons, en vez de N
  // llamadas a addAddon/removeAddon.
  addAddons: "activeSet:addMany",
  removeAddons: "activeSet:removeMany",
  getResumeState: "activeSet:resumeState",
  mergeProgress: "merge:onProgress",
  willNeedElevation: "willNeedElevation",
  isResuming: "activeSet:isResuming",
  getTitles: "addons:titles",
  // (P-30, Paso 4) Gestión de presets — ver LocalStore.listPresets/getPreset/
  // createPreset/renamePreset/deletePreset/getActivePresetId/setActivePresetId
  // y MergeOrchestrator.switchActivePreset (Pasos 1-3.5, ya cerrados).
  listPresets: "presets:list",
  createPreset: "presets:create",
  renamePreset: "presets:rename",
  deletePreset: "presets:delete",
  switchActivePreset: "presets:switch",
  getActivePresetId: "presets:getActive",
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
  /**
   * Variante en LOTE de `addAddon` (P-31+P-22, Paso 1): agrega varios addons
   * al preset activo con UNA SOLA fusión final (ver DECISIÓN 9 en
   * `merge-orchestrator.ts`). El `priorityOrder` de cada uno lo asigna el
   * orquestador (no se recibe acá), mismo criterio de "lo agregado ahora gana"
   * que ya usa `addAddon` individual.
   */
  addAddons(addonIds: string[]): Promise<OperationResult>;
  /** Variante en LOTE de `removeAddon` (P-31+P-22, Paso 1); ver DECISIÓN 9 en `merge-orchestrator.ts`. */
  removeAddons(addonIds: string[]): Promise<OperationResult>;
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

  // ---------------------------------------------------------------------------
  // Presets (P-30, Paso 4). Capa de dominio completa desde los Pasos 1-3.5:
  // LocalStore.listPresets/getPreset/createPreset/renamePreset/deletePreset/
  // getActivePresetId/setActivePresetId, y MergeOrchestrator.switchActivePreset
  // (con manejo correcto de elevación UAC, ver DECISIÓN 8 en
  // merge-orchestrator.ts). Este paso SOLO expone esa capa vía IPC.
  // ---------------------------------------------------------------------------

  /** Todos los presets guardados, en orden de creación. */
  listPresets(): Promise<Preset[]>;
  /**
   * Crea un preset nuevo con el `name` dado. `entries` es OPCIONAL: si se omite,
   * el preset arranca VACÍO (P-30, Paso 4, DECISIÓN documentada en
   * `ipc-handlers.ts`) — es la opción que requiere MENOS cambios en el flujo
   * existente de Biblioteca/Activos; agregarle addons a un preset recién creado
   * quedó cableado en el Paso 5 (crear -> queda activo -> Biblioteca/Activos
   * agregan sobre él normalmente). `description` también es OPCIONAL (bug/
   * feature post Paso 5: modal real con nombre + descripción, ver
   * `PresetSwitcher.tsx`); ausente o vacía persiste `null`. Lanza si `name`
   * está vacío/solo espacios.
   */
  createPreset(name: string, entries?: AddonManifestEntry[], description?: string): Promise<Preset>;
  /** Renombra un preset existente (no-op si `id` no existe). Lanza si `newName` está vacío/solo espacios. */
  renamePreset(id: string, newName: string): Promise<void>;
  /**
   * Borra un preset (no-op si `id` no existe). Lanza si `id` es el preset
   * ACTIVO (P-30, Paso 4, DECISIÓN documentada en `ipc-handlers.ts`): se
   * bloquea en vez de permitirlo, porque hoy nada reescribe gameinfo.txt ni
   * limpia la carpeta técnica al borrar — permitirlo dejaría el juego
   * apuntando a una carpeta de un preset que ya no existe en la app.
   */
  deletePreset(id: string): Promise<void>;
  /**
   * Cambia el preset ACTIVO a `id` (fusiona sus addons hacia su carpeta técnica,
   * actualiza gameinfo.txt). Mismo canal de progreso `onProgress` y el mismo
   * manejo de elevación UAC que `applyActiveSet`/`addAddon`/`removeAddon` — NO
   * hay un canal de progreso separado para presets.
   */
  switchActivePreset(id: string): Promise<OperationResult>;
  /** Id del preset ACTIVO, o `null` si ninguno lo es todavía. */
  getActivePresetId(): Promise<string | null>;
}