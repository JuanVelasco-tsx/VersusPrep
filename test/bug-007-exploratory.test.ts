import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";

import {
  buildPathIndependentDomain,
  runStartupSequence,
} from "../src/main/app/composition-root.js";
import type {
  PathIndependentDomain,
  PathIndependentIo,
  StartupIo,
} from "../src/main/app/composition-root.js";
import type { ResumeState } from "../src/main/app/ipc-contract.js";
import { PathDetector } from "../src/main/domain/index.js";
import type {
  AddonManifestEntry,
  CommandResult,
  CommandRunner,
  GamePaths,
  PathDetectionResult,
} from "../src/main/domain/index.js";

/**
 * FASE EXPLORATORIA de BUG-007 (metodología bug condition, Tarea 1).
 *
 * OBJETIVO: reproducir la Bug Condition sobre el código ACTUAL SIN FIX. Estos
 * tests DEBEN FALLAR — la falla confirma la causa raíz: el `ResumeState` que
 * `readResumeState()` / `getResumeState()` expone hoy es `{ bufferedEvents,
 * result }` y NO incluye las entries candidatas del batch (el Active_Set que se
 * está restaurando), así que el renderer de la instancia elevada no tiene de
 * dónde repintar la selección tras el UAC.
 *
 * Los asertos codifican el comportamiento ESPERADO/correcto (el campo
 * `pendingEntries`), por eso fallan ahora y pasarán tras el fix (Tarea 4.2).
 *
 * NOTA sobre tipos: el tipo `ResumeState` todavía NO tiene `pendingEntries` (eso
 * es la Tarea 3.1). Para que el test COMPILE en esta fase sin tocar producción,
 * se castea el resultado a un tipo local `ResumeStateWithCandidate` que agrega
 * `pendingEntries?: AddonManifestEntry[]`. Así el typecheck pasa y el test FALLA
 * EN RUNTIME porque el valor es `undefined` sobre el código sin fix.
 *
 * Dobles MANUALES sin vi.fn() (mismo criterio de composition-root.test.ts),
 * `Database(":memory:")` real, `runStartupSequence` con argv de resume.
 */

// ---------------------------------------------------------------------------
// Tipo local para el aserto exploratorio (NO se toca ipc-contract.ts acá).
// ---------------------------------------------------------------------------

/**
 * `ResumeState` extendido SOLO para este test: agrega el campo `pendingEntries`
 * que el fix (Tarea 3.1) sumará al contrato real. Permite compilar el test hoy
 * y aseverar el comportamiento esperado, que en runtime falla (undefined).
 */
type ResumeStateWithCandidate = ResumeState & {
  pendingEntries?: AddonManifestEntry[];
};

// ---------------------------------------------------------------------------
// Dobles manuales (replicados de composition-root.test.ts para aislar la fase).
// ---------------------------------------------------------------------------

/** CommandRunner falso: exitCode 0 sin tocar el SO. */
function makeFakeRunner(exitCode = 0): CommandRunner {
  return {
    async run(): Promise<CommandResult> {
      return { exitCode, stdout: "", stderr: "" };
    },
  };
}

/** dialog falso: cancela siempre (no se ejercita en estos tests). */
const fakeDialog = {
  async showOpenDialog() {
    return { canceled: true, filePaths: [] as string[] };
  },
};

/** spawnSync falso: status configurable (1 = no elevado, fallo seguro). */
function makeFakeSpawnSync(status: number) {
  return {
    spawnSync() {
      return { status } as ReturnType<typeof import("node:child_process").spawnSync>;
    },
  } as Pick<typeof import("node:child_process"), "spawnSync">;
}

/** GamePaths de muestra COMPLETO para que getPaths() no devuelva null. */
const SAMPLE_PATHS: GamePaths = {
  steamPath: "C:\\Steam",
  gameRoot: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2",
  left4dead2Dir: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2",
  workshopFolder:
    "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\addons\\workshop",
  vpkToolPath: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\bin\\vpk.exe",
  gameInfoFile:
    "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\gameinfo.txt",
  modsvsFolder:
    "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\modsvs",
};

function makeIndependentIo(overrides: Partial<PathIndependentIo> = {}): PathIndependentIo {
  return {
    commandRunner: makeFakeRunner(),
    dialog: fakeDialog,
    spawnSyncFn: makeFakeSpawnSync(1),
    db: new Database(":memory:"),
    ...overrides,
  };
}

/** PathDetector falso que resuelve un PathDetectionResult "ready" fijo. */
function makeFakePathDetector(result: PathDetectionResult): PathDetector {
  return { async detect() { return result; } } as unknown as PathDetector;
}

/** PathDetectionResult "ready" con SAMPLE_PATHS (todas las rutas presentes). */
const READY_DETECTION: PathDetectionResult = {
  kind: "ready",
  paths: SAMPLE_PATHS,
  verification: {
    present: {
      gameRoot: true,
      workshopFolder: true,
      vpkToolPath: true,
      gameInfoFile: true,
      modsvsFolder: true,
    },
    missing: [],
    allPresent: true,
  },
  source: "auto",
};

/** Arma un PathIndependentDomain con un PathDetector falso "ready" y el resto real. */
function makeReadyBase(): PathIndependentDomain {
  const base = buildPathIndependentDomain(makeIndependentIo());
  return { ...base, pathDetector: makeFakePathDetector(READY_DETECTION) };
}

/** StartupIo con argv configurable (resume o vacío). */
function makeStartupIo(argv: readonly string[] = []): StartupIo {
  return {
    argv,
    commandRunner: makeFakeRunner(),
    tempDir: "C:\\tmp\\l4d2-temp",
    workRoot: "C:\\tmp\\l4d2-work",
    broadcaster: () => {},
  };
}

/** argv de resume estándar (applyActiveSet + handle). */
const RESUME_ARGV = [
  "--l4d2-resume-type",
  "applyActiveSet",
  "--l4d2-resume-handle",
  "H1",
];

// ---------------------------------------------------------------------------
// Fase exploratoria: reproducir la Bug Condition (estos tests FALLAN sin fix).
// ---------------------------------------------------------------------------

describe("BUG-007 (exploratorio) — el ResumeState NO expone el batch candidato", () => {
  test("Caso 1 — candidato NO vacío: readResumeState().pendingEntries contiene las 3 entries en Priority_Order ascendente", async () => {
    const base = makeReadyBase();
    // Sembrar un candidato con priorityOrder dispares/desordenados. getPendingSession()
    // ya garantiza orden ascendente por (priorityOrder, addonId), así que la salida
    // esperada es [{a,1},{b,3},{c,5}].
    base.localStore.savePendingSession([
      { addonId: "c", priorityOrder: 5 },
      { addonId: "a", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 3 },
    ]);

    const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.isResuming).toBe(true);

    const state = outcome.readResumeState() as ResumeStateWithCandidate | null;
    expect(state).not.toBeNull();
    // COMPORTAMIENTO ESPERADO (falla sin el fix: pendingEntries es undefined):
    // el ResumeState expone las entries candidatas en Priority_Order ascendente.
    expect(state?.pendingEntries).toEqual([
      { addonId: "a", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 3 },
      { addonId: "c", priorityOrder: 5 },
    ]);
  });

  test("Caso 2 — candidato vacío intencional ([]): readResumeState() NO es null y pendingEntries es []", async () => {
    const base = makeReadyBase();
    // Sesión activa con candidato vacío (p. ej. se quitó el último addon). El flag
    // de estado marca active = 1, así que getPendingSession() devuelve [] (no null).
    base.localStore.savePendingSession([]);

    const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.isResuming).toBe(true);

    const state = outcome.readResumeState() as ResumeStateWithCandidate | null;
    // El ResumeState existe (hay resume), distinto de "sin resume" (null).
    expect(state).not.toBeNull();
    // COMPORTAMIENTO ESPERADO (falla sin el fix: pendingEntries es undefined):
    // candidato vacío intencional => [] (que el renderer muestre selección vacía,
    // NO "sin resume").
    expect(state?.pendingEntries).toEqual([]);
  });

  test("Caso 3 — captura antes del clear: tras runResume() (que limpia el pending), pendingEntries SIGUE reflejando el candidato", async () => {
    const base = makeReadyBase();
    const candidate: AddonManifestEntry[] = [
      { addonId: "c", priorityOrder: 5 },
      { addonId: "a", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 3 },
    ];
    base.localStore.savePendingSession(candidate);

    const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.isResuming).toBe(true);

    // Disparar el resume. El AddonScanner real intentará leer SAMPLE_PATHS.workshopFolder
    // (ruta ficticia inexistente) y el resume terminará en failure, pero runResume NO
    // rechaza (traga la excepción en su catch). resumePendingOperation limpia el pending
    // con clearPendingSession() en su finally.
    await expect(outcome.runResume()).resolves.toBeUndefined();

    // El pending ya se limpió en el store...
    expect(base.localStore.getPendingSession()).toBeNull();

    const state = outcome.readResumeState() as ResumeStateWithCandidate | null;
    expect(state).not.toBeNull();
    // COMPORTAMIENTO ESPERADO (falla sin el fix: pendingEntries es undefined):
    // las entries se capturaron ANTES del clear y siguen disponibles en el
    // ResumeState aunque el resume ya terminó y limpió el pending.
    expect(state?.pendingEntries).toEqual([
      { addonId: "a", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 3 },
      { addonId: "c", priorityOrder: 5 },
    ]);
  });
});
