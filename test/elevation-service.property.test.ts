import fc from "fast-check";

import { ElevationServiceImpl } from "../src/main/domain/index.js";
import type {
  ElevationOsProvider,
  RelaunchOutcome,
  LocalStore,
  AddonManifestEntry,
  PendingOperation,
} from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * Property test del intento de elevación ante fallo de permisos (Tarea 17.3).
 *
 * Feature: l4d2-versus-addon-manager, Property 15: Todo fallo de escritura por
 * permisos intenta elevar antes de fallar definitivamente
 * **Validates: Requirements 9.2**
 *
 * Invariante (camino REACTIVO, `handleWriteFailure`), para CUALQUIER combinación
 * de (código del error, si la instancia ya está elevada, resultado del intento de
 * elevación, éxito de la escritura reintentada):
 *
 *   (a) Ante un error de permisos (`EACCES`/`EPERM`) con la instancia NO elevada,
 *       `handleWriteFailure` SIEMPRE invoca el mecanismo de elevación
 *       (`relaunchAsAdmin` del proveedor) antes de que la operación pueda
 *       resultar en un fallo definitivo: NUNCA propaga el error de permisos sin
 *       haber intentado elevar primero. Además persiste la sesión pendiente
 *       (`savePendingSession`) ANTES de relanzar (tarea 17.1).
 *   (b) Ante un error que NO es de permisos (p. ej. `ENOENT`), NUNCA dispara
 *       elevación (`relaunchAsAdmin` no se llama) y resuelve `already-writable`
 *       (el orquestador propaga el error original tal cual).
 *   (c) Ante un error de permisos con la instancia YA elevada, NUNCA relanza (el
 *       fallo no es por falta de privilegios) y resuelve `already-writable`.
 *
 * ---------------------------------------------------------------------------
 * QUÉ UNIDAD REAL SE PRUEBA vs. QUÉ MODELA EL TEST
 *
 * La ÚNICA unidad de producción bajo prueba es `ElevationServiceImpl.handleWriteFailure`.
 * El `ElevationOsProvider` (isElevated / probeWrite / relaunchAsAdmin) y el
 * `LocalStore` (savePendingSession / ...) están MOCKEADOS en memoria e inyectados,
 * y registran si fueron invocados, para poder observar el invariante "intentó
 * elevar" sin efectos reales de SO. El "éxito de la escritura reintentada" y el
 * "resultado del intento de elevación" se VARÍAN como parte del modelo de la
 * propiedad: la reescritura la haría el orquestador (tarea 18), no este servicio;
 * aquí solo se comprueba que la DECISIÓN de elevar (o no) es la correcta y que el
 * mecanismo de elevación se invoca cuando —y solo cuando— corresponde.
 * ---------------------------------------------------------------------------
 */

/** Proveedor de SO mockeado que registra las invocaciones de relanzo. */
class SpyOsProvider implements ElevationOsProvider {
  #elevated: boolean;
  #relaunchResult: RelaunchOutcome;
  /** Cuántas veces se invocó `relaunchAsAdmin` (mecanismo de elevación). */
  relaunchCalls = 0;

  constructor(elevated: boolean, relaunchResult: RelaunchOutcome) {
    this.#elevated = elevated;
    this.#relaunchResult = relaunchResult;
  }

  isElevated(): boolean {
    return this.#elevated;
  }

  probeWrite(): Promise<boolean> {
    // No participa del camino reactivo; se define por completitud del contrato.
    return Promise.resolve(true);
  }

  relaunchAsAdmin(): Promise<RelaunchOutcome> {
    this.relaunchCalls += 1;
    return Promise.resolve(this.#relaunchResult);
  }
}

/** LocalStore mockeado: solo registra si `savePendingSession` fue invocado. */
class SpyStore implements LocalStore {
  savePendingSessionCalls = 0;
  lastSavedEntries: AddonManifestEntry[] | null = null;

  // --- Métodos consumidos por ElevationService ---
  savePendingSession(entries: AddonManifestEntry[]): void {
    this.savePendingSessionCalls += 1;
    this.lastSavedEntries = entries;
  }

  // --- Resto del contrato LocalStore: no se usan aquí (stubs) ---
  getPendingSession(): AddonManifestEntry[] | null {
    return null;
  }
  clearPendingSession(): void {}
  savePaths(): void {}
  getPaths(): null {
    return null;
  }
  saveManifest(): void {}
  getManifest(): AddonManifestEntry[] {
    return [];
  }
}

/** Un error de Node con `code` opcional, como los que arroja `fs`. */
function errnoWithCode(code: string | undefined): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(`error simulado (${code ?? "sin code"})`);
  if (code !== undefined) err.code = code;
  return err;
}

/**
 * Códigos a variar: dos de permisos (deben elevar si no está elevada) y varios
 * no-permisos (nunca elevan). Se incluye `undefined` (error sin `code`).
 */
const errorCodeArb: fc.Arbitrary<string | undefined> = fc.constantFrom(
  "EACCES",
  "EPERM",
  "ENOENT",
  "EBUSY",
  "EEXIST",
  undefined,
);

const PERMISSION_CODES = new Set(["EACCES", "EPERM"]);

/** Entradas del Active_Set candidato (puede ser [] intencionalmente). */
const entriesArb: fc.Arbitrary<AddonManifestEntry[]> = fc.array(
  fc.record({
    addonId: fc.string({ minLength: 1, maxLength: 8 }),
    priorityOrder: fc.integer({ min: 0, max: 32 }),
  }),
  { maxLength: 6 },
);

const pendingArb: fc.Arbitrary<PendingOperation> = fc.record({
  type: fc.constantFrom<PendingOperation["type"]>("applyActiveSet", "addAddon", "removeAddon"),
  resumeHandle: fc.string({ minLength: 1, maxLength: 12 }),
});

interface Scenario {
  code: string | undefined;
  alreadyElevated: boolean;
  /** Resultado del intento de elevación (aceptado / cancelado por el usuario). */
  relaunchResult: RelaunchOutcome;
  pending: PendingOperation;
  entries: AddonManifestEntry[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  code: errorCodeArb,
  alreadyElevated: fc.boolean(),
  relaunchResult: fc.constantFrom<RelaunchOutcome>("launched", "cancelled"),
  pending: pendingArb,
  entries: entriesArb,
});

propertyTest(
  15,
  "Todo fallo de escritura por permisos intenta elevar antes de fallar definitivamente",
  fc.asyncProperty(scenarioArb, async (s) => {
    const os = new SpyOsProvider(s.alreadyElevated, s.relaunchResult);
    const store = new SpyStore();
    const service = new ElevationServiceImpl(os, store);

    const error = errnoWithCode(s.code);
    const outcome = await service.handleWriteFailure(error, s.pending, s.entries);

    const isPermission = s.code !== undefined && PERMISSION_CODES.has(s.code);

    if (!isPermission) {
      // (b) No-permisos: NUNCA eleva, NUNCA persiste, resuelve already-writable.
      if (os.relaunchCalls !== 0) return false;
      if (store.savePendingSessionCalls !== 0) return false;
      return outcome.kind === "already-writable";
    }

    if (s.alreadyElevated) {
      // (c) Permisos + ya elevada: NUNCA relanza, resuelve already-writable.
      if (os.relaunchCalls !== 0) return false;
      if (store.savePendingSessionCalls !== 0) return false;
      return outcome.kind === "already-writable";
    }

    // (a) Permisos + NO elevada: SIEMPRE intentó elevar (relanzó) y persistió
    // ANTES; nunca resolvió sin intentar. El outcome refleja el resultado del
    // intento de elevación (launched -> elevated-handoff; cancelled -> denied),
    // nunca already-writable (que sería "no intenté elevar").
    if (os.relaunchCalls !== 1) return false;
    if (store.savePendingSessionCalls !== 1) return false;
    if (outcome.kind === "already-writable") return false;
    return s.relaunchResult === "launched"
      ? outcome.kind === "elevated-handoff"
      : outcome.kind === "denied";
  }),
);
