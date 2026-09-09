import { describe, expect, test } from "vitest";

import {
  createProgressBroadcaster,
  registerIpcHandlers,
} from "../src/main/app/ipc-handlers.js";
import { IPC_CHANNELS } from "../src/main/app/ipc-contract.js";
import type { IpcMain } from "electron";
import type { IpcHandlersDeps } from "../src/main/app/ipc-handlers.js";
import type { ResumeState } from "../src/main/app/ipc-contract.js";
import type {
  AddonManifestEntry,
  GamePaths,
  MergeProgressEvent,
  OperationResult,
  PathDetectionResult,
  PathVerification,
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
      return Promise.resolve(handler(dummyEvent, ...args));
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
  savePathsCalls: GamePaths[];
  getPathsValue: { value: GamePaths | null };
  manifestValue: { value: AddonManifestEntry[] };
  scanCalls: string[];
  classifyOrder: string[];
  applyCalls: AddonManifestEntry[][];
  addCalls: Array<{ addonId: string; priorityOrder: number }>;
  removeCalls: string[];
  resumeValue: { value: ResumeState | null };
  /** Si esta seteado, applyActiveSet devuelve ESTA promesa (para D4). */
  applyGate: { promise: Promise<OperationResult> } | null;
  /** Doble de classify configurable: por defecto resuelve sincrono. */
  classifyImpl: { fn: (addon: ScannedAddon) => Promise<VScriptClassification> };
}

function buildDoubles(): Doubles {
  const d: Doubles = {
    deps: undefined as unknown as IpcHandlersDeps,
    detectResult: { value: { kind: "needs-manual", reason: "steam-not-installed" } },
    savePathsCalls: [],
    getPathsValue: { value: PATHS },
    manifestValue: { value: [] },
    scanCalls: [],
    classifyOrder: [],
    applyCalls: [],
    addCalls: [],
    removeCalls: [],
    resumeValue: { value: null },
    applyGate: null,
    classifyImpl: {
      fn: (addon) => Promise.resolve(classification(addon.id)),
    },
  };

  d.deps = {
    pathDetector: {
      detect: () => Promise.resolve(d.detectResult.value),
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
      savePaths: (paths: GamePaths) => {
        d.savePathsCalls.push(paths);
      },
      getPaths: () => d.getPathsValue.value,
      getManifest: () => d.manifestValue.value,
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
    } as IpcHandlersDeps["mergeOrchestrator"],
    getResumeState: () => d.resumeValue.value,
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

describe("IPC — ruteo canal->componente (ocho canales)", () => {
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
    // valor no nulo.
    const state: ResumeState = { bufferedEvents: [], result: null };
    d.resumeValue.value = state;
    expect(await ipc.invoke(IPC_CHANNELS.getResumeState)).toBe(state);
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
