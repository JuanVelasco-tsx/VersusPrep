import Database from "better-sqlite3";
import { expect, test } from "vitest";
import fc from "fast-check";

import {
  buildPathIndependentDomain,
  runStartupSequence,
} from "../src/main/app/composition-root.js";
import type {
  PathIndependentDomain,
  PathIndependentIo,
  StartupIo,
} from "../src/main/app/composition-root.js";
import { PathDetector } from "../src/main/domain/index.js";
import type {
  AddonManifestEntry,
  CommandResult,
  CommandRunner,
  GamePaths,
  PathDetectionResult,
} from "../src/main/domain/index.js";

/**
 * FIX-CHECK de BUG-007 (Tarea 4.1) — property test con fast-check.
 *
 * Property 1 (Expected Behavior): para CUALQUIER Active_Set candidato persistido
 * (lista de `{ addonId, priorityOrder }`, incluida la lista vacía `[]`, con
 * `priorityOrder` repetidos/desordenados), el `ResumeState` que expone
 * `readResumeState()` contiene EXACTAMENTE esas entries en Priority_Order
 * ascendente (luego `addonId`), coincidiendo con el orden que
 * `SqliteLocalStore.getPendingSession()` garantiza. Esto vale para TODO camino de
 * resume: ANTES de `runResume()` (estado inicial) y DESPUÉS de `await runResume()`
 * (tras el clear del pending, gracias a la captura previa al clear).
 *
 * El ESPERADO se computa de forma INDEPENDIENTE: se ordena el candidato generado
 * por (priorityOrder ASC, addonId ASC) sin llamar a getPendingSession().
 *
 * Patrón: dobles MANUALES (mismo criterio de composition-root.test.ts y
 * bug-007-exploratory.test.ts), `Database(":memory:")` real, `runStartupSequence`
 * con argv de resume. Mínimo 100 iteraciones (numRuns: 100).
 *
 * Validates: Requirements 2.1, 2.2, 2.3
 */

// ---------------------------------------------------------------------------
// Dobles manuales (replicados de bug-007-exploratory.test.ts).
// ---------------------------------------------------------------------------

/** CommandRunner falso: exitCode 0 sin tocar el SO. */
function makeFakeRunner(exitCode = 0): CommandRunner {
  return {
    async run(): Promise<CommandResult> {
      return { exitCode, stdout: "", stderr: "" };
    },
  };
}

/** dialog falso: cancela siempre (no se ejercita acá). */
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

/**
 * Arma un PathIndependentDomain con un PathDetector falso "ready" y el resto
 * real. Cada llamada crea una BD `:memory:` fresca (aislamiento por iteración).
 */
function makeBaseWith(detector: PathDetector): PathIndependentDomain {
  const base = buildPathIndependentDomain(makeIndependentIo());
  return { ...base, pathDetector: detector };
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
// Arbitrary: Active_Set candidato.
// ---------------------------------------------------------------------------

/**
 * Genera un Active_Set candidato arbitrario:
 *  - `addonId` ÚNICOS (fc.uniqueArray por addonId).
 *  - tamaño 0..8, INCLUYE la lista vacía [].
 *  - `priorityOrder` puede REPETIRSE y estar DESORDENADO (rango 0..50).
 */
const candidateArbitrary: fc.Arbitrary<AddonManifestEntry[]> = fc.uniqueArray(
  fc.record({
    addonId: fc.string({ minLength: 1, maxLength: 12 }),
    priorityOrder: fc.integer({ min: 0, max: 50 }),
  }),
  { minLength: 0, maxLength: 8, selector: (entry) => entry.addonId },
);

/**
 * Orden ESPERADO (fuente independiente): ordena por (priorityOrder ASC,
 * addonId ASC), igual que SqliteLocalStore.getPendingSession(). NO llama a
 * getPendingSession para computar el esperado.
 */
function expectedOrder(candidate: AddonManifestEntry[]): AddonManifestEntry[] {
  return [...candidate].sort((a, b) => {
    if (a.priorityOrder !== b.priorityOrder) {
      return a.priorityOrder - b.priorityOrder;
    }
    if (a.addonId < b.addonId) return -1;
    if (a.addonId > b.addonId) return 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Property 1 (fix-check).
// ---------------------------------------------------------------------------

test(
  "BUG-007 Property 1: para todo Active_Set candidato persistido, readResumeState().pendingEntries coincide con el candidato en Priority_Order ascendente (antes y después de runResume)",
  async () => {
    await fc.assert(
      fc.asyncProperty(candidateArbitrary, async (candidate) => {
        const expected = expectedOrder(candidate);

        // 1. Sembrar el candidato en un SqliteLocalStore :memory: fresco.
        const base = makeBaseWith(makeFakePathDetector(READY_DETECTION));
        base.localStore.savePendingSession(candidate);

        // 2. Construir el outcome con argv de resume.
        const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

        expect(outcome.kind).toBe("ready");
        if (outcome.kind !== "ready") return;
        // Sesión pendiente activa (incluso [] => active, no null) => isResuming.
        expect(outcome.isResuming).toBe(true);

        // 3. ANTES de runResume: el ResumeState expone el candidato ordenado.
        const before = outcome.readResumeState();
        expect(before).not.toBeNull();
        expect(before?.pendingEntries).toEqual(expected);

        // 4. DESPUÉS de runResume (que limpia el pending; el resume termina en
        //    failure por workshopFolder inexistente, pero runResume no rechaza):
        //    el candidato capturado antes del clear SIGUE expuesto.
        await outcome.runResume();
        expect(base.localStore.getPendingSession()).toBeNull();

        const after = outcome.readResumeState();
        expect(after).not.toBeNull();
        expect(after?.pendingEntries).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  },
  // Cada iteración corre runStartupSequence + runResume con I/O real de
  // filesystem (probeWrite); 100 runs superan el timeout por defecto de 5s de
  // vitest. Se amplía el límite para este property test I/O-bound.
  30_000,
);
