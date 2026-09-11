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
  MergeProgressEvent,
  OperationResult,
  PathDetectionResult,
  ScannedAddon,
  VScriptClassification,
} from "../domain/index.js";

export const IPC_CHANNELS = {
  detectPaths: "paths:detect",
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
}

/** API tipada que el preload expone en `window.l4d2Api`. */
export interface L4d2Api {
  detectPaths(): Promise<PathDetectionResult>;
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
  /** Se suscribe al progreso; devuelve la función de desuscripción. */
  onProgress(listener: (event: MergeProgressEvent) => void): () => void;
}