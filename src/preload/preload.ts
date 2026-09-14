import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../main/app/ipc-contract.js";
import type { L4d2Api, ResumeState, SetManualPathResult, SettablePathField } from "../main/app/ipc-contract.js";
import type {
  ActiveSetPreview,
  AddonManifestEntry,
  GamePaths,
  MergeProgressEvent,
  OperationResult,
  PathDetectionResult,
  Preset,
  ScannedAddon,
  VScriptClassification,
} from "../main/domain/index.js";

const api: L4d2Api = {
  detectPaths: () =>
    ipcRenderer.invoke(IPC_CHANNELS.detectPaths) as Promise<PathDetectionResult>,
  getPaths: () => ipcRenderer.invoke(IPC_CHANNELS.getPaths) as Promise<GamePaths | null>,
  setManualPath: (field: SettablePathField) =>
    ipcRenderer.invoke(IPC_CHANNELS.setManualPath, field) as Promise<SetManualPathResult>,
  scanAddons: () =>
    ipcRenderer.invoke(IPC_CHANNELS.scanAddons) as Promise<ScannedAddon[]>,
  classifyVScript: (addons) =>
    ipcRenderer.invoke(IPC_CHANNELS.classifyVScript, addons) as Promise<
      VScriptClassification[]
    >,
  getActiveSet: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getActiveSet) as Promise<AddonManifestEntry[]>,
  previewActiveSet: (entries) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewActiveSet, entries) as Promise<ActiveSetPreview>,
  applyActiveSet: (entries) =>
    ipcRenderer.invoke(IPC_CHANNELS.applyActiveSet, entries) as Promise<OperationResult>,
  addAddon: (addonId, priorityOrder) =>
    ipcRenderer.invoke(IPC_CHANNELS.addAddon, addonId, priorityOrder) as Promise<
      OperationResult
    >,
  removeAddon: (addonId) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeAddon, addonId) as Promise<OperationResult>,
  addAddons: (addonIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.addAddons, addonIds) as Promise<OperationResult>,
  removeAddons: (addonIds) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeAddons, addonIds) as Promise<OperationResult>,
  getResumeState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getResumeState) as Promise<ResumeState | null>,
  willNeedElevation: () =>
    ipcRenderer.invoke(IPC_CHANNELS.willNeedElevation) as Promise<boolean>,
  isResuming: () =>
    ipcRenderer.invoke(IPC_CHANNELS.isResuming) as Promise<boolean>,
  getTitles: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getTitles) as Promise<Record<string, string>>,
  onProgress: (listener) => {
    const handler = (_event: unknown, payload: MergeProgressEvent): void =>
      listener(payload);
    ipcRenderer.on(IPC_CHANNELS.mergeProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.mergeProgress, handler);
  },
  listPresets: () => ipcRenderer.invoke(IPC_CHANNELS.listPresets) as Promise<Preset[]>,
  createPreset: (name, entries, description) =>
    ipcRenderer.invoke(IPC_CHANNELS.createPreset, name, entries, description) as Promise<Preset>,
  renamePreset: (id, newName) =>
    ipcRenderer.invoke(IPC_CHANNELS.renamePreset, id, newName) as Promise<void>,
  deletePreset: (id) => ipcRenderer.invoke(IPC_CHANNELS.deletePreset, id) as Promise<void>,
  switchActivePreset: (id) =>
    ipcRenderer.invoke(IPC_CHANNELS.switchActivePreset, id) as Promise<OperationResult>,
  getActivePresetId: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getActivePresetId) as Promise<string | null>,
};

contextBridge.exposeInMainWorld("l4d2Api", api);