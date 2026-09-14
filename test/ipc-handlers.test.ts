import { describe, expect, test } from "vitest";

import {
  createProgressBroadcaster,
  registerIpcHandlers,
} from "../src/main/app/ipc-handlers.js";
import { IPC_CHANNELS } from "../src/main/app/ipc-contract.js";
import { TitleCache } from "../src/main/domain/index.js";
import type { IpcMain } from "electron";
import type { IpcHandlersDeps } from "../src/main/app/ipc-handlers.js";
import type { ResumeState, SetManualPathResult } from "../src/main/app/ipc-contract.js";
import type {
  AddonManifestEntry,
  GamePaths,
  ManualPathRequest,
  MergeProgressEvent,
  OperationResult,
  PathDetectionResult,
  PathVerification,
  Preset,
  ScannedAddon,
  VScriptClassification,
} from "../src/main/domain/index.js";

/**
 * Unit tests de la capa IPC (Tarea 20.3): ruteo canal->componente y las cuatro
 * decisiones de diseno (D1, D3, D4, D5) de registerIpcHandlers, mas el
 * broadcaster de progreso, todos con dominio MOCKEADO por dobles en memoria.
 *
 * No se toca el runtime de Electron: fakeIpcMain (ARNES central de todos los
 * casos) implementa solo Pick<IpcMain, "handle">, captura cada callback en un
 * Map por canal y lo reinvoca via invoke(channel, ...args). Los handlers
 * ignoran su primer parametro _event, asi que el arnes le pasa un dummy.
 */

// Mensaje EXACTO que emite guardedWrite al rechazar una escritura concurrente.
// Se replica aca a proposito para atar los tests de D4 a la causa correcta (no
// a cualquier "failure"); si el handler cambia el texto, estos tests deben verlo.
const GUARD_ERROR =
  "Ya hay una operación de fusión en curso. Esperá a que termine antes de iniciar otra.";

// ---------------------------------------------------------------------------
// ARNES central: fake de ipcMain que captura los handlers registrados.
// ---------------------------------------------------------------------------

// Tipo del listener EXACTO que espera IpcMain.handle (deriva de electron para no
// acoplarse a la importacion directa de IpcMainInvokeEvent, y para que la firma
// del fake sea asignable a Pick<IpcMain, "handle"> bajo strictFunctionTypes).
type IpcHandleListener = Parameters<IpcMain["handle"]>[1];
type IpcInvokeEvent = Parameters<IpcHandleListener>[0];

interface FakeIpcMain {
  handle(channel: string, listener: IpcHandleListener): void;
  /** Reinvoca el handler capturado para el canal, con un _event dummy (se ignora). */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function createFakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, IpcHandleListener>();
  // Los handlers de ipc-handlers.ts nunca leen el _event; basta un dummy casteado.
  const dummyEvent = {} as IpcInvokeEvent;
  return {
    handle(channel, listener): void {
      handlers.set(channel, listener);
    },
    invoke(channel, ...args): Promise<unknown> {
      const handler = handlers.get(channel);
      if (handler === undefined) {
        throw new Error("No hay handler registrado para el canal " + channel);
      }
      // (P-30, Paso 4) Un handler NO-async que hace `throw` directo (p. ej.
      // los de validación de presets:create/rename/delete) lanza de forma
      // SÍNCRONA al evaluarse acá; sin este try/catch ese throw escapaba de
      // `invoke()` como excepción real en vez de como promesa rechazada,
      // rompiendo `expect(ipc.invoke(...)).rejects.toThrow(...)`. El
      // Electron real SÍ convierte un throw síncrono del listener en un
      // rechazo de la promesa de `ipcRenderer.invoke` — este try/catch
      // replica ese comportamiento para que el arnés sea fiel a la API real.
      try {
        return Promise.resolve(handler(dummyEvent, ...args));
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Dobles minimos de dominio: solo los metodos que ipc-handlers.ts invoca.
// Cada doble registra sus llamadas para verificar invocacion / no-invocacion.
// ---------------------------------------------------------------------------

const PATHS: GamePaths = {
  steamPath: "C:/Steam",
  gameRoot: "C:/Steam/steamapps/common/Left 4 Dead 2",
  left4dead2Dir: "C:/Steam/steamapps/common/Left 4 Dead 2/left4dead2",
  workshopFolder: "C:/Steam/steamapps/common/Left 4 Dead 2/left4dead2/addons/workshop",
  vpkToolPath: "C:/Steam/steamapps/common/Left 4 Dead 2/bin/vpk.exe",
  gameInfoFile: "C:/Steam/steamapps/common/Left 4 Dead 2/left4dead2/gameinfo.txt",
  modsvsFolder: "C:/Steam/steamapps/common/Left 4 Dead 2/left4dead2/modsvs",
};

function scanned(id: string): ScannedAddon {
  return { id, vpkPath: id + ".vpk", coverPath: null, info: null };
}

function classification(id: string): VScriptClassification {
  return { addonId: id, isVScriptAddon: false, reason: "clean" };
}

/** Promesa cuya resolucion se dispara manualmente desde el test (para D4). */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface Doubles {
  deps: IpcHandlersDeps;
  detectResult: { value: PathDetectionResult };
  savePathsCalls: Array<Partial<GamePaths>>;
  getPathsValue: { value: GamePaths | null };
  /** Peticiones que recibió el `ManualPathProvider` vía `pathDetector.resolveManualPath`. */
  resolveManualPathCalls: ManualPathRequest[];
  /** Ruta que devuelve `resolveManualPath` (o `null` para simular cancelación). */
  resolveManualPathValue: { value: string | null };
  manifestValue: { value: AddonManifestEntry[] };
  scanCalls: string[];
  classifyOrder: string[];
  applyCalls: AddonManifestEntry[][];
  addCalls: Array<{ addonId: string; priorityOrder: number }>;
  removeCalls: string[];
  resumeValue: { value: ResumeState | null };
  /** Cuenta las invocaciones de onElevatedHandoff (fix del cierre de la instancia sin privilegios). */
  handoffCalls: { count: number };
  willNeedElevationValue: { value: boolean };
  isResumingValue: { value: boolean };
  titleCache: TitleCache;
  /** Si esta seteado, applyActiveSet devuelve ESTA promesa (para D4). */
  applyGate: { promise: Promise<OperationResult> } | null;
  /** Doble de classify configurable: por defecto resuelve sincrono. */
  classifyImpl: { fn: (addon: ScannedAddon) => Promise<VScriptClassification> };
  // --- Presets (P-30, Paso 4) ---
  presetsValue: { value: Preset[] };
  createPresetCalls: Array<{ name: string; entries: AddonManifestEntry[] }>;
  renamePresetCalls: Array<{ id: string; newName: string }>;
  deletePresetCalls: string[];
  activePresetIdValue: { value: string | null };
  switchActivePresetCalls: string[];
  /** Resultado que devuelve mergeOrchestrator.switchActivePreset; configurable por test. */
  switchActivePresetResult: { value: OperationResult };
}

function buildDoubles(): Doubles {
  const d: Doubles = {
    deps: undefined as unknown as IpcHandlersDeps,
    detectResult: { value: { kind: "needs-manual", reason: "steam-not-installed" } },
    savePathsCalls: [],
    getPathsValue: { value: PATHS },
    resolveManualPathCalls: [],
    resolveManualPathValue: { value: null },
    manifestValue: { value: [] },
    scanCalls: [],
    classifyOrder: [],
    applyCalls: [],
    addCalls: [],
    removeCalls: [],
    resumeValue: { value: null },
    handoffCalls: { count: 0 },
    willNeedElevationValue: { value: false },
    isResumingValue: { value: false },
    titleCache: new TitleCache(),
    applyGate: null,
    classifyImpl: {
      fn: (addon) => Promise.resolve(classification(addon.id)),
    },
    presetsValue: { value: [] },
    createPresetCalls: [],
    renamePresetCalls: [],
    deletePresetCalls: [],
    activePresetIdValue: { value: null },
    switchActivePresetCalls: [],
    switchActivePresetResult: { value: { status: "success" } },
  };

  d.deps = {
    pathDetector: {
      detect: () => Promise.resolve(d.detectResult.value),
      resolveManualPath: (request: ManualPathRequest) => {
        d.resolveManualPathCalls.push(request);
        return Promise.resolve(d.resolveManualPathValue.value);
      },
    } as IpcHandlersDeps["pathDetector"],
    addonScanner: {
      scan: (workshopFolder: string) => {
        d.scanCalls.push(workshopFolder);
        return Promise.resolve([scanned("111"), scanned("222")]);
      },
    } as IpcHandlersDeps["addonScanner"],
    vscriptDetector: {
      classify: (addon: ScannedAddon) => {
        d.classifyOrder.push(addon.id);
        return d.classifyImpl.fn(addon);
      },
    } as IpcHandlersDeps["vscriptDetector"],
    localStore: {
      savePaths: (paths: Partial<GamePaths>) => {
        d.savePathsCalls.push(paths);
      },
      getPaths: () => d.getPathsValue.value,
      getManifest: () => d.manifestValue.value,
      listPresets: () => d.presetsValue.value,
      createPreset: (name: string, entries: AddonManifestEntry[]) => {
        d.createPresetCalls.push({ name, entries: [...entries] });
        const preset: Preset = { id: `preset-fake-${d.createPresetCalls.length}`, name, entries };
        d.presetsValue.value = [...d.presetsValue.value, preset];
        return preset;
      },
      renamePreset: (id: string, newName: string) => {
        d.renamePresetCalls.push({ id, newName });
      },
      deletePreset: (id: string) => {
        d.deletePresetCalls.push(id);
      },
      getActivePresetId: () => d.activePresetIdValue.value,
    } as IpcHandlersDeps["localStore"],
    mergeOrchestrator: {
      applyActiveSet: (entries: readonly AddonManifestEntry[]) => {
        d.applyCalls.push([...entries]);
        if (d.applyGate !== null) return d.applyGate.promise;
        return Promise.resolve<OperationResult>({ status: "success" });
      },
      addAddon: (addonId: string, priorityOrder: number) => {
        d.addCalls.push({ addonId, priorityOrder });
        return Promise.resolve<OperationResult>({ status: "success" });
      },
      removeAddon: (addonId: string) => {
        d.removeCalls.push(addonId);
        return Promise.resolve<OperationResult>({ status: "success" });
      },
      switchActivePreset: (id: string) => {
        d.switchActivePresetCalls.push(id);
        return Promise.resolve(d.switchActivePresetResult.value);
      },
    } as IpcHandlersDeps["mergeOrchestrator"],
    getResumeState: () => d.resumeValue.value,
    getWillNeedElevation: () => d.willNeedElevationValue.value,
    getIsResuming: () => d.isResumingValue.value,
    titleCache: d.titleCache,
    onElevatedHandoff: () => {
      d.handoffCalls.count++;
    },
  };

  return d;
}

/** Registra los handlers del doble sobre un fakeIpcMain listo para invocar. */
function setup(): { ipc: FakeIpcMain; d: Doubles } {
  const d = buildDoubles();
  const ipc = createFakeIpcMain();
  registerIpcHandlers(ipc, d.deps);
  return { ipc, d };
}

const READY_VERIFICATION: PathVerification = {
  present: {
    gameRoot: true,
    workshopFolder: true,
    vpkToolPath: true,
    gameInfoFile: true,
    modsvsFolder: true,
  },
  missing: [],
  allPresent: true,
};

function readyResult(source: "auto" | "manual"): PathDetectionResult {
  return { kind: "ready", paths: PATHS, verification: READY_VERIFICATION, source };
}

// ---------------------------------------------------------------------------
// Ruteo canal -> componente (los OCHO canales invoke, uno por uno).
// ---------------------------------------------------------------------------

describe("IPC — ruteo canal->componente (catorce canales)", () => {
  test("paths:detect llama detect() y devuelve exactamente su resultado (ready)", async () => {
    const { ipc, d } = setup();
    const ready = readyResult("auto");
    d.detectResult.value = ready;
    const res = await ipc.invoke(IPC_CHANNELS.detectPaths);
    expect(res).toBe(ready);
  });

  test("paths:detect devuelve exactamente su resultado (needs-manual)", async () => {
    const { ipc, d } = setup();
    const needsManual: PathDetectionResult = { kind: "needs-manual", reason: "l4d2-not-in-libraries" };
    d.detectResult.value = needsManual;
    const res = await ipc.invoke(IPC_CHANNELS.detectPaths);
    expect(res).toBe(needsManual);
  });

  test("paths:get devuelve localStore.getPaths() tal cual (P-37, sin detección ni diálogos)", async () => {
    const { ipc, d } = setup();
    d.getPathsValue.value = PATHS;
    expect(await ipc.invoke(IPC_CHANNELS.getPaths)).toBe(PATHS);
    // Lectura pura: no dispara resolveManualPath ni detect.
    expect(d.resolveManualPathCalls).toEqual([]);
  });

  test("paths:get devuelve null si todavia no hay un GamePaths completo", async () => {
    const { ipc, d } = setup();
    d.getPathsValue.value = null;
    expect(await ipc.invoke(IPC_CHANNELS.getPaths)).toBeNull();
  });

  test("paths:setManual (steamPath) pide kind steam-path y persiste+devuelve el snapshot actualizado (P-37)", async () => {
    const { ipc, d } = setup();
    d.resolveManualPathValue.value = "D:\\OtroSteam";
    d.getPathsValue.value = { ...PATHS, steamPath: "D:\\OtroSteam" };

    const res = (await ipc.invoke(IPC_CHANNELS.setManualPath, "steamPath")) as SetManualPathResult;

    expect(d.resolveManualPathCalls).toEqual([{ kind: "steam-path" }]);
    expect(d.savePathsCalls).toEqual([{ steamPath: "D:\\OtroSteam" }]);
    expect(res).toEqual({ kind: "selected", paths: d.getPathsValue.value });
  });

  test("paths:setManual (un RequiredPathKey) pide kind required-path con el pathKey correcto (P-37)", async () => {
    const { ipc, d } = setup();
    d.resolveManualPathValue.value = "D:\\OtraWorkshop";

    await ipc.invoke(IPC_CHANNELS.setManualPath, "workshopFolder");

    expect(d.resolveManualPathCalls).toEqual([
      { kind: "required-path", pathKey: "workshopFolder" },
    ]);
    expect(d.savePathsCalls).toEqual([{ workshopFolder: "D:\\OtraWorkshop" }]);
  });

  test("paths:setManual devuelve cancelled y NO persiste nada si el usuario cancela el diálogo (P-37)", async () => {
    const { ipc, d } = setup();
    d.resolveManualPathValue.value = null;

    const res = (await ipc.invoke(IPC_CHANNELS.setManualPath, "vpkToolPath")) as SetManualPathResult;

    expect(res).toEqual({ kind: "cancelled" });
    expect(d.savePathsCalls).toEqual([]);
  });

  test("addons:scan llama scan(paths.workshopFolder) con el workshopFolder correcto", async () => {
    const { ipc, d } = setup();
    await ipc.invoke(IPC_CHANNELS.scanAddons);
    expect(d.scanCalls).toEqual([PATHS.workshopFolder]);
  });

  test("addons:classifyVScript llama classify por cada addon pasado", async () => {
    const { ipc, d } = setup();
    const addons = [scanned("a"), scanned("b"), scanned("c")];
    const res = (await ipc.invoke(IPC_CHANNELS.classifyVScript, addons)) as VScriptClassification[];
    expect(d.classifyOrder.slice().sort()).toEqual(["a", "b", "c"]);
    expect(res.map((r) => r.addonId)).toEqual(["a", "b", "c"]);
  });

  test("activeSet:get llama getManifest() y devuelve su resultado", async () => {
    const { ipc, d } = setup();
    const manifest: AddonManifestEntry[] = [{ addonId: "111", priorityOrder: 0 }];
    d.manifestValue.value = manifest;
    const res = await ipc.invoke(IPC_CHANNELS.getActiveSet);
    expect(res).toBe(manifest);
  });

  test("activeSet:apply llama applyActiveSet(entries) con los entries exactos", async () => {
    const { ipc, d } = setup();
    const entries: AddonManifestEntry[] = [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ];
    await ipc.invoke(IPC_CHANNELS.applyActiveSet, entries);
    expect(d.applyCalls).toEqual([entries]);
  });

  test("activeSet:add llama addAddon(addonId, priorityOrder) con ambos argumentos", async () => {
    const { ipc, d } = setup();
    await ipc.invoke(IPC_CHANNELS.addAddon, "555", 7);
    expect(d.addCalls).toEqual([{ addonId: "555", priorityOrder: 7 }]);
  });

  test("activeSet:remove llama removeAddon(addonId)", async () => {
    const { ipc, d } = setup();
    await ipc.invoke(IPC_CHANNELS.removeAddon, "555");
    expect(d.removeCalls).toEqual(["555"]);
  });

  test("activeSet:resumeState llama getResumeState() y devuelve su resultado (incluido null)", async () => {
    const { ipc, d } = setup();
    // null (caso por defecto).
    expect(await ipc.invoke(IPC_CHANNELS.getResumeState)).toBeNull();
    // valor no nulo. (BUG-007) El ResumeState pasa a incluir `pendingEntries`
    // como campo OBLIGATORIO cuando el objeto no es null; acá se refleja `[]`
    // (candidato vacío intencional) para que el objeto compile con la nueva forma.
    const state: ResumeState = { bufferedEvents: [], result: null, pendingEntries: [] };
    d.resumeValue.value = state;
    expect(await ipc.invoke(IPC_CHANNELS.getResumeState)).toBe(state);
  });

  // (BUG-007, req 3.6) El handler `activeSet:resumeState` es un pasamanos puro:
  // devuelve el ResumeState EXTENDIDO tal cual lo entrega `deps.getResumeState()`,
  // SIN filtrar ni recomponer `pendingEntries`. Esto es lo que permite que el
  // renderer, con el MISMO canal que ya consume (P-25), obtenga el batch candidato
  // para repintar la selección tras el UAC. No hay canal IPC nuevo.
  test("activeSet:resumeState devuelve el ResumeState EXTENDIDO con pendingEntries intacto (BUG-007)", async () => {
    const { ipc, d } = setup();
    const pendingEntries: AddonManifestEntry[] = [
      { addonId: "a", priorityOrder: 0 },
      { addonId: "b", priorityOrder: 1 },
    ];
    const state: ResumeState = {
      bufferedEvents: [],
      result: { status: "success" },
      pendingEntries,
    };
    d.resumeValue.value = state;

    const returned = (await ipc.invoke(IPC_CHANNELS.getResumeState)) as ResumeState;

    // Se devuelve el MISMO objeto (identidad de referencia): el handler no clona
    // ni transforma nada.
    expect(returned).toBe(state);
    // Y el batch candidato viaja intacto por el canal existente.
    expect(returned.pendingEntries).toBe(pendingEntries);
    expect(returned.pendingEntries).toEqual([
      { addonId: "a", priorityOrder: 0 },
      { addonId: "b", priorityOrder: 1 },
    ]);
  });

  test("willNeedElevation llama getWillNeedElevation() y devuelve su resultado", async () => {
    const { ipc, d } = setup();
    // false (caso por defecto).
    expect(await ipc.invoke(IPC_CHANNELS.willNeedElevation)).toBe(false);
    // true.
    d.willNeedElevationValue.value = true;
    expect(await ipc.invoke(IPC_CHANNELS.willNeedElevation)).toBe(true);
  });

  test("activeSet:isResuming llama getIsResuming() y devuelve su resultado", async () => {
    const { ipc, d } = setup();
    // false (caso por defecto).
    expect(await ipc.invoke(IPC_CHANNELS.isResuming)).toBe(false);
    // true.
    d.isResumingValue.value = true;
    expect(await ipc.invoke(IPC_CHANNELS.isResuming)).toBe(true);
  });

  test("addons:scan puebla el TitleCache; addons:titles devuelve el snapshot (BUG-001)", async () => {
    const { ipc, d } = setup();
    // Scanner que devuelve addons CON título (el `scanned()` por defecto trae
    // info:null, que no cachearía nada).
    d.deps.addonScanner.scan = () =>
      Promise.resolve([
        { id: "111", vpkPath: "111.vpk", coverPath: null, info: { title: "Mapa Cool" } },
        { id: "222", vpkPath: "222.vpk", coverPath: null, info: { title: "Skin Nice" } },
        { id: "333", vpkPath: "333.vpk", coverPath: null, info: null }, // sin título -> no se cachea
      ]);

    // Antes de escanear: cache vacío.
    expect(await ipc.invoke(IPC_CHANNELS.getTitles)).toEqual({});

    await ipc.invoke(IPC_CHANNELS.scanAddons);

    // Tras escanear: solo los que tenían título; 333 (sin título) NO aparece
    // (el consumidor cae al fallback de id crudo).
    expect(await ipc.invoke(IPC_CHANNELS.getTitles)).toEqual({
      "111": "Mapa Cool",
      "222": "Skin Nice",
    });
  });
});

// ---------------------------------------------------------------------------
// D1 — persistencia de GamePaths en detectPaths.
// ---------------------------------------------------------------------------

describe("IPC — D1: detectPaths persiste segun kind", () => {
  test("ready (auto) -> savePaths llamado con result.paths", async () => {
    const { ipc, d } = setup();
    d.detectResult.value = readyResult("auto");
    await ipc.invoke(IPC_CHANNELS.detectPaths);
    expect(d.savePathsCalls).toEqual([PATHS]);
  });

  test("ready (manual) -> savePaths llamado igual", async () => {
    const { ipc, d } = setup();
    d.detectResult.value = readyResult("manual");
    await ipc.invoke(IPC_CHANNELS.detectPaths);
    expect(d.savePathsCalls).toEqual([PATHS]);
  });

  test("needs-manual -> savePaths NO llamado", async () => {
    const { ipc, d } = setup();
    d.detectResult.value = { kind: "needs-manual", reason: "steam-not-installed" };
    await ipc.invoke(IPC_CHANNELS.detectPaths);
    expect(d.savePathsCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D3 — orden posicional en classifyVScript bajo concurrencia acotada.
// ---------------------------------------------------------------------------

describe("IPC — D3: classifyVScript preserva orden posicional", () => {
  test("10 addons, pool de 4, resolucion en orden INVERSO -> resultado en orden de entrada", async () => {
    const { ipc, d } = setup();
    const addons = Array.from({ length: 10 }, (_v, i) => scanned("addon-" + i));

    // classify resuelve encadenando microtareas: cuantas MENOS para los indices
    // altos, antes resuelven (orden inverso al de entrada). Sin timers reales.
    d.classifyImpl.fn = (addon) => {
      const index = Number(addon.id.split("-")[1]);
      const hops = 10 - index; // index 9 -> 1 hop (resuelve primero); index 0 -> 10 hops.
      let p: Promise<void> = Promise.resolve();
      for (let i = 0; i < hops; i++) p = p.then(() => undefined);
      return p.then(() => classification(addon.id));
    };

    const res = (await ipc.invoke(IPC_CHANNELS.classifyVScript, addons)) as VScriptClassification[];
    // El resultado sigue el orden POSICIONAL de la entrada, no el de finalizacion.
    expect(res.map((r) => r.addonId)).toEqual(addons.map((a) => a.id));
  });
});

// ---------------------------------------------------------------------------
// D4 — guard de escritura concurrente compartido entre los tres canales.
// ---------------------------------------------------------------------------

describe("IPC — D4: guard de escritura concurrente", () => {
  test("segundo apply antes de resolver el primero -> failure con mensaje del guard, sin segunda llamada", async () => {
    const { ipc, d } = setup();
    const gate = deferred<OperationResult>();
    d.applyGate = { promise: gate.promise };
    const entries: AddonManifestEntry[] = [{ addonId: "111", priorityOrder: 0 }];

    const first = ipc.invoke(IPC_CHANNELS.applyActiveSet, entries); // queda en vuelo
    const second = (await ipc.invoke(IPC_CHANNELS.applyActiveSet, entries)) as OperationResult;

    expect(second.status).toBe("failure");
    if (second.status === "failure") expect(second.error).toBe(GUARD_ERROR);
    // El orquestador se llamo UNA sola vez (la segunda ni lo toco).
    expect(d.applyCalls.length).toBe(1);

    gate.resolve({ status: "success" });
    await first;
  });

  test("CRUZADO: apply en vuelo + add -> add rechazado con el mismo mensaje, sin llamar addAddon", async () => {
    const { ipc, d } = setup();
    const gate = deferred<OperationResult>();
    d.applyGate = { promise: gate.promise };

    const first = ipc.invoke(IPC_CHANNELS.applyActiveSet, [{ addonId: "111", priorityOrder: 0 }]);
    const add = (await ipc.invoke(IPC_CHANNELS.addAddon, "222", 1)) as OperationResult;

    expect(add.status).toBe("failure");
    if (add.status === "failure") expect(add.error).toBe(GUARD_ERROR);
    expect(d.addCalls.length).toBe(0);

    gate.resolve({ status: "success" });
    await first;
  });

  test("CRUZADO: apply en vuelo + remove -> remove rechazado, sin llamar removeAddon", async () => {
    const { ipc, d } = setup();
    const gate = deferred<OperationResult>();
    d.applyGate = { promise: gate.promise };

    const first = ipc.invoke(IPC_CHANNELS.applyActiveSet, [{ addonId: "111", priorityOrder: 0 }]);
    const remove = (await ipc.invoke(IPC_CHANNELS.removeAddon, "222")) as OperationResult;

    expect(remove.status).toBe("failure");
    if (remove.status === "failure") expect(remove.error).toBe(GUARD_ERROR);
    expect(d.removeCalls.length).toBe(0);

    gate.resolve({ status: "success" });
    await first;
  });

  test("tras resolver el primero, una tercera invocacion SI pasa el guard", async () => {
    const { ipc, d } = setup();
    const gate = deferred<OperationResult>();
    d.applyGate = { promise: gate.promise };
    const entries: AddonManifestEntry[] = [{ addonId: "111", priorityOrder: 0 }];

    const first = ipc.invoke(IPC_CHANNELS.applyActiveSet, entries);
    await ipc.invoke(IPC_CHANNELS.applyActiveSet, entries); // rechazada
    gate.resolve({ status: "success" });
    await first; // primera resuelta -> flag liberado

    // La tercera ya no debe ser bloqueada por el guard. Desgateamos para que resuelva.
    d.applyGate = null;
    const third = (await ipc.invoke(IPC_CHANNELS.applyActiveSet, entries)) as OperationResult;
    expect(third.status).toBe("success");
    // applyActiveSet fue llamado por la 1ra y la 3ra (la 2da fue bloqueada).
    expect(d.applyCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// D5 — precondicion de orden de uso en addons:scan.
// ---------------------------------------------------------------------------

describe("IPC — handoff de elevacion (cierre de la instancia sin privilegios)", () => {
  // Helper: espera un turno de macrotask para que corra el setImmediate del handoff.
  const flushImmediate = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  test("apply que resuelve status:elevating dispara onElevatedHandoff (una vez)", async () => {
    const { ipc, d } = setup();
    d.applyGate = { promise: Promise.resolve<OperationResult>({ status: "elevating" }) };

    const res = (await ipc.invoke(
      IPC_CHANNELS.applyActiveSet,
      [{ addonId: "111", priorityOrder: 0 }],
    )) as OperationResult;

    // El valor de retorno viaja PRIMERO; el handoff esta diferido con setImmediate.
    expect(res.status).toBe("elevating");
    expect(d.handoffCalls.count).toBe(0);

    await flushImmediate();
    expect(d.handoffCalls.count).toBe(1);
  });

  test("apply exitoso NO dispara el handoff", async () => {
    const { ipc, d } = setup();
    // applyActiveSet por defecto resuelve { status: "success" }.
    await ipc.invoke(IPC_CHANNELS.applyActiveSet, [{ addonId: "111", priorityOrder: 0 }]);
    await flushImmediate();
    expect(d.handoffCalls.count).toBe(0);
  });

  test("add que resuelve status:elevating tambien dispara el handoff", async () => {
    const { ipc, d } = setup();
    d.deps.mergeOrchestrator.addAddon = () =>
      Promise.resolve<OperationResult>({ status: "elevating" });

    await ipc.invoke(IPC_CHANNELS.addAddon, "555", 7);
    await flushImmediate();
    expect(d.handoffCalls.count).toBe(1);
  });
});
describe("IPC — D5: scanAddons exige paths detectadas", () => {
  test("getPaths() == null -> rechaza y NO llama a scan", async () => {
    const { ipc, d } = setup();
    d.getPathsValue.value = null;
    await expect(ipc.invoke(IPC_CHANNELS.scanAddons)).rejects.toThrow(/paths:detect/);
    expect(d.scanCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createProgressBroadcaster (aislado, sin registerIpcHandlers).
// ---------------------------------------------------------------------------

describe("IPC — createProgressBroadcaster", () => {
  const EVENT: MergeProgressEvent = { step: "merge" };

  test("getWebContents() devuelve un objeto -> send(canal, evento)", () => {
    const sendCalls: Array<{ channel: string; event: MergeProgressEvent }> = [];
    const wc = {
      send: (channel: string, event: MergeProgressEvent) => {
        sendCalls.push({ channel, event });
      },
    };
    const listener = createProgressBroadcaster(() => wc);
    listener(EVENT);
    expect(sendCalls).toEqual([{ channel: IPC_CHANNELS.mergeProgress, event: EVENT }]);
  });

  test("getWebContents() devuelve undefined -> no-op (no explota)", () => {
    const listener = createProgressBroadcaster(() => undefined);
    expect(() => listener(EVENT)).not.toThrow();
  });

  test("getWebContents() devuelve null -> no-op (igual que undefined)", () => {
    const listener = createProgressBroadcaster(() => null);
    expect(() => listener(EVENT)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Presets (P-30, Paso 4): los seis canales presets:*.
// ---------------------------------------------------------------------------

describe("IPC — presets:list", () => {
  test("caso feliz: devuelve exactamente lo que listPresets() del store trae", async () => {
    const { ipc, d } = setup();
    const preset: Preset = { id: "preset-1", name: "Armas", entries: [] };
    d.presetsValue.value = [preset];

    const res = await ipc.invoke(IPC_CHANNELS.listPresets);

    expect(res).toEqual([preset]);
  });

  test("caso vacío: sin presets guardados -> []", async () => {
    const { ipc, d } = setup();
    d.presetsValue.value = [];

    expect(await ipc.invoke(IPC_CHANNELS.listPresets)).toEqual([]);
  });
});

describe("IPC — presets:create", () => {
  test("caso feliz: crea con el nombre recortado y las entries dadas", async () => {
    const { ipc, d } = setup();
    const entries: AddonManifestEntry[] = [{ addonId: "111", priorityOrder: 0 }];

    const res = (await ipc.invoke(IPC_CHANNELS.createPreset, "  Armas  ", entries)) as Preset;

    expect(d.createPresetCalls).toEqual([{ name: "Armas", entries }]);
    expect(res.name).toBe("Armas");
    expect(res.entries).toEqual(entries);
  });

  test("entries omitido -> arranca vacío (P-30, Paso 4, DECISIÓN: menos cambio al flujo existente)", async () => {
    const { ipc, d } = setup();

    await ipc.invoke(IPC_CHANNELS.createPreset, "Skins");

    expect(d.createPresetCalls).toEqual([{ name: "Skins", entries: [] }]);
  });

  test("caso de error: nombre vacío/solo espacios -> rechaza, NO llama a createPreset", async () => {
    const { ipc, d } = setup();

    await expect(ipc.invoke(IPC_CHANNELS.createPreset, "   ")).rejects.toThrow(
      /nombre.*vacío/i,
    );
    expect(d.createPresetCalls).toEqual([]);
  });
});

describe("IPC — presets:rename", () => {
  test("caso feliz: renombra con el nombre recortado", async () => {
    const { ipc, d } = setup();

    await ipc.invoke(IPC_CHANNELS.renamePreset, "preset-1", "  Armas v2  ");

    expect(d.renamePresetCalls).toEqual([{ id: "preset-1", newName: "Armas v2" }]);
  });

  test("caso de error: nombre nuevo vacío/solo espacios -> rechaza, NO llama a renamePreset", async () => {
    const { ipc, d } = setup();

    await expect(ipc.invoke(IPC_CHANNELS.renamePreset, "preset-1", "  ")).rejects.toThrow(
      /nombre.*vacío/i,
    );
    expect(d.renamePresetCalls).toEqual([]);
  });

  test("id inexistente: pasa tal cual a LocalStore (no-op silencioso, mismo criterio que local-store.ts)", async () => {
    const { ipc, d } = setup();

    await ipc.invoke(IPC_CHANNELS.renamePreset, "preset-no-existe", "Nuevo nombre");

    expect(d.renamePresetCalls).toEqual([{ id: "preset-no-existe", newName: "Nuevo nombre" }]);
  });
});

describe("IPC — presets:delete", () => {
  test("caso feliz: borra un preset que NO es el activo", async () => {
    const { ipc, d } = setup();
    d.activePresetIdValue.value = "preset-activo";

    await ipc.invoke(IPC_CHANNELS.deletePreset, "preset-otro");

    expect(d.deletePresetCalls).toEqual(["preset-otro"]);
  });

  test("caso de error: borrar el preset ACTIVO se bloquea, NO llama a deletePreset (P-30, Paso 4, DECISIÓN)", async () => {
    const { ipc, d } = setup();
    d.activePresetIdValue.value = "preset-activo";

    await expect(ipc.invoke(IPC_CHANNELS.deletePreset, "preset-activo")).rejects.toThrow(
      /preset activo/i,
    );
    expect(d.deletePresetCalls).toEqual([]);
  });
});

describe("IPC — presets:switch", () => {
  test("caso feliz: delega en mergeOrchestrator.switchActivePreset y devuelve su resultado tal cual", async () => {
    const { ipc, d } = setup();
    const success: OperationResult = { status: "success", installedManifest: [] };
    d.switchActivePresetResult.value = success;

    const res = await ipc.invoke(IPC_CHANNELS.switchActivePreset, "preset-1");

    expect(d.switchActivePresetCalls).toEqual(["preset-1"]);
    expect(res).toBe(success);
  });

  test("caso de error: presetId inexistente -> el failure de switchActivePreset pasa tal cual (sin excepción IPC)", async () => {
    const { ipc, d } = setup();
    const failure: OperationResult = {
      status: "failure",
      error: "El preset preset-no-existe no existe.",
    };
    d.switchActivePresetResult.value = failure;

    const res = await ipc.invoke(IPC_CHANNELS.switchActivePreset, "preset-no-existe");

    expect(res).toEqual(failure);
  });

  test("respeta guardedWrite: una segunda invocación mientras la primera está en curso devuelve el fallo de concurrencia (D4)", async () => {
    const { ipc, d } = setup();
    const gate = deferred<OperationResult>();
    d.deps.mergeOrchestrator.switchActivePreset = () => gate.promise;

    const first = ipc.invoke(IPC_CHANNELS.switchActivePreset, "preset-1");
    const second = await ipc.invoke(IPC_CHANNELS.switchActivePreset, "preset-2");

    expect(second).toEqual({ status: "failure", error: GUARD_ERROR });
    gate.resolve({ status: "success" });
    await first;
  });
});

describe("IPC — presets:getActive", () => {
  test("caso feliz: devuelve el id activo tal cual", async () => {
    const { ipc, d } = setup();
    d.activePresetIdValue.value = "preset-1";

    expect(await ipc.invoke(IPC_CHANNELS.getActivePresetId)).toBe("preset-1");
  });

  test("sin preset activo -> null", async () => {
    const { ipc, d } = setup();
    d.activePresetIdValue.value = null;

    expect(await ipc.invoke(IPC_CHANNELS.getActivePresetId)).toBeNull();
  });
});
