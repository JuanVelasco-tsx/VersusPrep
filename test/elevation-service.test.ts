import { describe, expect, test } from "vitest";

import { ElevationServiceImpl, isPermissionError } from "../src/main/domain/index.js";
import type {
  ElevationOsProvider,
  RelaunchOutcome,
  LocalStore,
  AddonManifestEntry,
  GamePaths,
  PendingOperation,
  Preset,
} from "../src/main/domain/index.js";

/**
 * Unit tests de las Tareas 17.1 y 17.2 (ElevationService, Requirement 9.2).
 *
 * Ejemplos CONCRETOS que fijan el contrato documentado en `elevation-service.ts`
 * (NO reemplazan el property test de 17.3 / Property 15). Se inyecta un
 * {@link ElevationOsProvider} y un {@link LocalStore} MOCKEADOS en memoria, mismo
 * criterio que `test/process-guard.test.ts` con su `MockProcessListProvider`.
 * Cubren: `isProtectedPath` (bajo/fuera de Program Files), `needsElevation` (probe
 * write exitoso vs fallido), `ensureCanWrite` en sus 3 resultados, `relaunchElevated`
 * persistiendo con `savePendingSession` ANTES del relanzo, y la regla "una vez por
 * sesión" (segunda llamada con la instancia ya elevada no vuelve a relanzar).
 */

// ---------------------------------------------------------------------------
// Mocks en memoria.
// ---------------------------------------------------------------------------

/** Registro de invocaciones al proveedor de SO, configurable por test. */
class MockOsProvider implements ElevationOsProvider {
  elevated: boolean;
  /** Resultado de `probeWrite` (true = escritura de prueba OK). */
  probeResult: boolean;
  /** Resultado del relanzo `runas`. */
  relaunchResult: RelaunchOutcome;
  /** Contadores de invocación. */
  probeCalls = 0;
  relaunchCalls = 0;

  constructor(init?: {
    elevated?: boolean;
    probeResult?: boolean;
    relaunchResult?: RelaunchOutcome;
  }) {
    this.elevated = init?.elevated ?? false;
    this.probeResult = init?.probeResult ?? true;
    this.relaunchResult = init?.relaunchResult ?? "launched";
  }

  isElevated(): boolean {
    return this.elevated;
  }

  probeWrite(): Promise<boolean> {
    this.probeCalls += 1;
    return Promise.resolve(this.probeResult);
  }

  relaunchAsAdmin(): Promise<RelaunchOutcome> {
    this.relaunchCalls += 1;
    return Promise.resolve(this.relaunchResult);
  }
}

/** LocalStore mockeado que registra la persistencia de la sesión pendiente. */
class MockStore implements LocalStore {
  /** Orden de eventos observados, para verificar "persistir ANTES de relanzar". */
  readonly events: string[] = [];
  savedEntries: AddonManifestEntry[] | null = null;

  savePendingSession(entries: AddonManifestEntry[]): void {
    this.events.push("savePendingSession");
    this.savedEntries = entries;
  }
  getPendingSession(): AddonManifestEntry[] | null {
    return this.savedEntries;
  }
  clearPendingSession(): void {}
  savePaths(_paths: Partial<GamePaths>): void {}
  getPaths(): GamePaths | null {
    return null;
  }
  saveManifest(_entries: AddonManifestEntry[]): void {}
  getManifest(): AddonManifestEntry[] {
    return [];
  }
  // (P-30, Paso 1) Sin uso en estos tests: ElevationService no toca presets.
  listPresets(): Preset[] {
    return [];
  }
  getPreset(_id: string): Preset | null {
    return null;
  }
  createPreset(name: string, entries: AddonManifestEntry[]): Preset {
    return { id: "preset-fake", name, entries };
  }
  renamePreset(_id: string, _newName: string): void {}
  deletePreset(_id: string): void {}
  getActivePresetId(): string | null {
    return null;
  }
  setActivePresetId(_id: string): void {}
}

/** Proveedor de SO que registra el orden global de eventos (persistir vs relanzar). */
class OrderTrackingOsProvider implements ElevationOsProvider {
  constructor(
    private readonly store: MockStore,
    readonly relaunchResult: RelaunchOutcome = "launched",
  ) {}
  isElevated(): boolean {
    return false;
  }
  probeWrite(): Promise<boolean> {
    return Promise.resolve(true);
  }
  relaunchAsAdmin(): Promise<RelaunchOutcome> {
    this.store.events.push("relaunchAsAdmin");
    return Promise.resolve(this.relaunchResult);
  }
}

const ENTRIES: AddonManifestEntry[] = [
  { addonId: "111", priorityOrder: 0 },
  { addonId: "222", priorityOrder: 1 },
];

const PENDING: PendingOperation = { type: "applyActiveSet", resumeHandle: "h" };

// ---------------------------------------------------------------------------
// isProtectedPath (17.1)
// ---------------------------------------------------------------------------

describe("ElevationService.isProtectedPath", () => {
  const service = new ElevationServiceImpl(new MockOsProvider(), new MockStore());

  test("ruta bajo Program Files (x86) -> true", () => {
    expect(
      service.isProtectedPath(
        "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2",
      ),
    ).toBe(true);
  });

  test("ruta bajo Program Files -> true", () => {
    expect(service.isProtectedPath("C:\\Program Files\\Steam\\left4dead2")).toBe(true);
  });

  test("case-insensitive: c:\\program files (x86)\\... -> true", () => {
    expect(service.isProtectedPath("c:\\program files (x86)\\steam")).toBe(true);
  });

  test("separadores / normalizados a \\ -> true", () => {
    expect(service.isProtectedPath("C:/Program Files/Steam/left4dead2")).toBe(true);
  });

  test("biblioteca en otro disco (D:\\SteamLibrary) -> false", () => {
    // No es protegida por path; el fallo de permisos se cubre por el camino REACTIVO.
    expect(service.isProtectedPath("D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2")).toBe(
      false,
    );
  });

  test("ruta de usuario fuera de Program Files -> false", () => {
    expect(service.isProtectedPath("C:\\Games\\L4D2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// needsElevation (17.1): probe write exitoso vs fallido
// ---------------------------------------------------------------------------

describe("ElevationService.needsElevation", () => {
  test("ruta protegida -> true SIN hacer probe write (short-circuit)", async () => {
    const os = new MockOsProvider({ probeResult: true });
    const service = new ElevationServiceImpl(os, new MockStore());
    expect(await service.needsElevation("C:\\Program Files (x86)\\Steam")).toBe(true);
    expect(os.probeCalls).toBe(0);
  });

  test("ruta no protegida + probe write EXITOSO -> false", async () => {
    const os = new MockOsProvider({ probeResult: true });
    const service = new ElevationServiceImpl(os, new MockStore());
    expect(await service.needsElevation("D:\\SteamLibrary")).toBe(false);
    expect(os.probeCalls).toBe(1);
  });

  test("ruta no protegida + probe write FALLIDO (permisos) -> true", async () => {
    const os = new MockOsProvider({ probeResult: false });
    const service = new ElevationServiceImpl(os, new MockStore());
    expect(await service.needsElevation("D:\\SteamLibrary")).toBe(true);
    expect(os.probeCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ensureCanWrite (17.2): los 3 resultados posibles
// ---------------------------------------------------------------------------

describe("ElevationService.ensureCanWrite", () => {
  test("ya elevada -> already-writable sin relanzar ni probar (una vez por sesión)", async () => {
    const os = new MockOsProvider({ elevated: true });
    const store = new MockStore();
    const service = new ElevationServiceImpl(os, store);
    const outcome = await service.ensureCanWrite("C:\\Program Files (x86)\\Steam", ENTRIES, "applyActiveSet");
    expect(outcome).toEqual({ kind: "already-writable" });
    expect(os.probeCalls).toBe(0);
    expect(os.relaunchCalls).toBe(0);
    expect(store.events).toEqual([]);
  });

  test("no elevada + no necesita elevar -> already-writable sin relanzar", async () => {
    const os = new MockOsProvider({ elevated: false, probeResult: true });
    const store = new MockStore();
    const service = new ElevationServiceImpl(os, store);
    const outcome = await service.ensureCanWrite("D:\\SteamLibrary", ENTRIES, "applyActiveSet");
    expect(outcome).toEqual({ kind: "already-writable" });
    expect(os.relaunchCalls).toBe(0);
    expect(store.events).toEqual([]);
  });

  test("no elevada + necesita elevar + UAC aceptado -> elevated-handoff (persiste y relanza)", async () => {
    const os = new MockOsProvider({ elevated: false, relaunchResult: "launched" });
    const store = new MockStore();
    const service = new ElevationServiceImpl(os, store);
    const outcome = await service.ensureCanWrite("C:\\Program Files (x86)\\Steam", ENTRIES, "applyActiveSet");
    expect(outcome).toEqual({ kind: "elevated-handoff" });
    expect(os.relaunchCalls).toBe(1);
    expect(store.savedEntries).toEqual(ENTRIES);
  });

  test("no elevada + necesita elevar + UAC cancelado -> denied", async () => {
    const os = new MockOsProvider({ elevated: false, relaunchResult: "cancelled" });
    const store = new MockStore();
    const service = new ElevationServiceImpl(os, store);
    const outcome = await service.ensureCanWrite("C:\\Program Files (x86)\\Steam", ENTRIES, "applyActiveSet");
    expect(outcome.kind).toBe("denied");
    expect(os.relaunchCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// relaunchElevated (17.1): persiste ANTES de relanzar
// ---------------------------------------------------------------------------

describe("ElevationService.relaunchElevated", () => {
  test("persiste con savePendingSession ANTES de invocar el relanzo", async () => {
    const store = new MockStore();
    const os = new OrderTrackingOsProvider(store);
    const service = new ElevationServiceImpl(os, store);

    await service.relaunchElevated(PENDING, ENTRIES);

    // El orden de eventos prueba que la persistencia ocurre antes del relanzo.
    expect(store.events).toEqual(["savePendingSession", "relaunchAsAdmin"]);
    expect(store.savedEntries).toEqual(ENTRIES);
  });

  test("BUG-004: emite `restarting` por onProgress ANTES del relanzo (y tras persistir)", async () => {
    const store = new MockStore();
    const os = new OrderTrackingOsProvider(store);
    // El listener registra el evento en el MISMO log de orden que store/os, para
    // probar la secuencia relativa: persistir -> avisar restarting -> relanzar.
    const service = new ElevationServiceImpl(os, store, (event) => {
      store.events.push("progress:" + event.step);
    });

    await service.relaunchElevated(PENDING, ENTRIES);

    expect(store.events).toEqual([
      "savePendingSession",
      "progress:restarting",
      "relaunchAsAdmin",
    ]);
  });

  test("sin onProgress inyectado, relaunchElevated se comporta igual (no emite, no rompe)", async () => {
    const store = new MockStore();
    const os = new OrderTrackingOsProvider(store);
    const service = new ElevationServiceImpl(os, store); // sin 3er arg

    const outcome = await service.relaunchElevated(PENDING, ENTRIES);

    expect(outcome).toEqual({ kind: "elevated-handoff" });
    expect(store.events).toEqual(["savePendingSession", "relaunchAsAdmin"]);
  });

  test("persiste incluso con entries vacío (candidato intencionalmente vacío)", async () => {
    const store = new MockStore();
    const os = new MockOsProvider({ relaunchResult: "launched" });
    const service = new ElevationServiceImpl(os, store);

    const outcome = await service.relaunchElevated(PENDING, []);
    expect(outcome).toEqual({ kind: "elevated-handoff" });
    expect(store.savedEntries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleWriteFailure (17.2) + isPermissionError
// ---------------------------------------------------------------------------

function errno(code: string | undefined): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`simulado ${code}`);
  if (code !== undefined) e.code = code;
  return e;
}

describe("ElevationService.handleWriteFailure", () => {
  test("error no-permisos (ENOENT) -> already-writable, no eleva", async () => {
    const os = new MockOsProvider({ elevated: false });
    const store = new MockStore();
    const service = new ElevationServiceImpl(os, store);
    const outcome = await service.handleWriteFailure(errno("ENOENT"), PENDING, ENTRIES);
    expect(outcome).toEqual({ kind: "already-writable" });
    expect(os.relaunchCalls).toBe(0);
    expect(store.events).toEqual([]);
  });

  test("EACCES + ya elevada -> already-writable, NO relanza (fallo no es por privilegios)", async () => {
    const os = new MockOsProvider({ elevated: true });
    const store = new MockStore();
    const service = new ElevationServiceImpl(os, store);
    const outcome = await service.handleWriteFailure(errno("EACCES"), PENDING, ENTRIES);
    expect(outcome).toEqual({ kind: "already-writable" });
    expect(os.relaunchCalls).toBe(0);
  });

  test("EPERM + NO elevada -> intenta elevar (relanza y persiste)", async () => {
    const os = new MockOsProvider({ elevated: false, relaunchResult: "launched" });
    const store = new MockStore();
    const service = new ElevationServiceImpl(os, store);
    const outcome = await service.handleWriteFailure(errno("EPERM"), PENDING, ENTRIES);
    expect(outcome).toEqual({ kind: "elevated-handoff" });
    expect(os.relaunchCalls).toBe(1);
    expect(store.savedEntries).toEqual(ENTRIES);
  });
});

describe("isPermissionError", () => {
  test("EACCES/EPERM -> true; ENOENT/undefined -> false", () => {
    expect(isPermissionError(errno("EACCES"))).toBe(true);
    expect(isPermissionError(errno("EPERM"))).toBe(true);
    expect(isPermissionError(errno("ENOENT"))).toBe(false);
    expect(isPermissionError(errno(undefined))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regla "una vez por sesión": tras elevar, la 2ª operación no vuelve a relanzar.
// ---------------------------------------------------------------------------

describe("ElevationService — elevación una vez por sesión", () => {
  test("2ª ensureCanWrite con instancia ya elevada NO vuelve a relanzar", async () => {
    // 1ª operación: instancia NO elevada -> relanza (handoff).
    const store = new MockStore();
    const os1 = new MockOsProvider({ elevated: false, relaunchResult: "launched" });
    const service1 = new ElevationServiceImpl(os1, store);
    const first = await service1.ensureCanWrite("C:\\Program Files (x86)\\Steam", ENTRIES, "applyActiveSet");
    expect(first).toEqual({ kind: "elevated-handoff" });
    expect(os1.relaunchCalls).toBe(1);

    // 2ª operación: ya en la instancia elevada -> escribe directo, NO relanza.
    const os2 = new MockOsProvider({ elevated: true });
    const service2 = new ElevationServiceImpl(os2, store);
    const second = await service2.ensureCanWrite("C:\\Program Files (x86)\\Steam", ENTRIES, "applyActiveSet");
    expect(second).toEqual({ kind: "already-writable" });
    expect(os2.relaunchCalls).toBe(0);
    expect(os2.probeCalls).toBe(0);
  });

  test("2ª handleWriteFailure con instancia ya elevada NO vuelve a relanzar", async () => {
    const os = new MockOsProvider({ elevated: true });
    const store = new MockStore();
    const service = new ElevationServiceImpl(os, store);
    const outcome = await service.handleWriteFailure(errno("EACCES"), PENDING, ENTRIES);
    expect(outcome).toEqual({ kind: "already-writable" });
    expect(os.relaunchCalls).toBe(0);
  });
});
