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
import { IPC_CHANNELS } from "../src/main/app/ipc-contract.js";
import { PathDetector, SqliteLocalStore } from "../src/main/domain/index.js";
import type {
  CommandResult,
  CommandRunner,
  GamePaths,
  PathDetectionResult,
} from "../src/main/domain/index.js";

/**
 * FASE DE PRESERVACIÓN de BUG-007 (metodología bug condition, Tarea 2).
 *
 * OBJETIVO: capturar el BASELINE del comportamiento existente que el fix NO debe
 * romper (Property 2 — Preservation). A diferencia de los exploratorios, estos
 * tests DEBEN PASAR sobre el código ACTUAL SIN FIX: confirman lo que se preserva.
 *
 * Metodología observación-primero: se corre el código sin fix, se observa el
 * output REAL y se asevera sobre eso (no sobre el comportamiento deseado del fix).
 * Por eso NO se usa el campo `pendingEntries` acá (eso pertenece al fix); estos
 * tests son sobre lo que NO cambia.
 *
 * Cubre los requisitos de regresión del bugfix:
 *  - 3.4: arranque sin resume => readResumeState() devuelve null.
 *  - 3.2: resume idempotente + limpieza (clearPendingSession en el finally).
 *  - 3.3: getPendingSession() distingue null (sin sesión) de [] (sesión activa
 *         con candidato vacío), vía el flag de estado, no por cantidad de filas.
 *  - 3.6: resultado terminal sin canal IPC nuevo (IPC_CHANNELS sin "pendingOperation").
 *  - 3.1: elevación una sola vez por sesión — cubierto por los tests existentes de
 *         elevation-service (ver nota en el caso correspondiente); no se fuerza
 *         un test frágil acá.
 *
 * Dobles MANUALES sin vi.fn() (mismo criterio de composition-root.test.ts),
 * `Database(":memory:")` real.
 */

// ---------------------------------------------------------------------------
// Dobles manuales (replicados de composition-root.test.ts / bug-007-exploratory).
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
// Preservación (estos tests PASAN sobre el código SIN fix — son el baseline).
// ---------------------------------------------------------------------------

describe("BUG-007 (preservación) — baseline que el fix NO debe romper", () => {
  // Caso 1 — bugfix 3.4: arranque SIN resume => readResumeState() devuelve null.
  test("Caso 1 (3.4) — arranque sin args de resume ni sesión pendiente: readResumeState() es null", async () => {
    const base = makeReadyBase();
    // Sin savePendingSession y sin argv de resume => isResuming false.
    const outcome = await runStartupSequence(base, makeStartupIo([]));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.isResuming).toBe(false);
    // No hay resume => el ResumeState entero es null (inalterado por el fix).
    expect(outcome.readResumeState()).toBeNull();
  });

  // Caso 2 — bugfix 3.2: resume idempotente + limpieza en el finally.
  test("Caso 2 (3.2) — tras runResume(), getPendingSession() del store es null (se limpió en el finally)", async () => {
    const base = makeReadyBase();
    // Sembrar un candidato + argv de resume => isResuming true.
    base.localStore.savePendingSession([
      { addonId: "a", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 2 },
    ]);

    const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.isResuming).toBe(true);
    // Antes de runResume el pending sigue presente.
    expect(base.localStore.getPendingSession()).not.toBeNull();

    // runResume() termina (el scan de una Workshop inexistente falla, pero runResume
    // traga la excepción en su catch). resumePendingOperation limpia el pending con
    // clearPendingSession() en su finally, en cualquier desenlace.
    await expect(outcome.runResume()).resolves.toBeUndefined();

    // Tras el resume: pending limpio (null). Idempotente: un segundo runResume no
    // reencuentra sesión pendiente y no revienta.
    expect(base.localStore.getPendingSession()).toBeNull();
    await expect(outcome.runResume()).resolves.toBeUndefined();
    expect(base.localStore.getPendingSession()).toBeNull();
  });

  // Caso 3 — bugfix 3.3: distinción null vs [] en el LocalStore real.
  test("Caso 3 (3.3) — SqliteLocalStore distingue null (sin sesión) de [] (sesión activa con candidato vacío)", () => {
    const store = new SqliteLocalStore(new Database(":memory:"));

    // Sin savePendingSession: no hay sesión activa => null (flag active = 0).
    expect(store.getPendingSession()).toBeNull();

    // savePendingSession([]) marca la sesión ACTIVA con candidato vacío => [] (no null).
    store.savePendingSession([]);
    expect(store.getPendingSession()).toEqual([]);
    // La distinción NO es por cantidad de filas (ambos casos tienen 0 filas), sino
    // por el flag de estado: acá active = 1, por eso devuelve [] y no null.

    // clearPendingSession() marca INACTIVA => null de nuevo.
    store.clearPendingSession();
    expect(store.getPendingSession()).toBeNull();
  });

  // Caso 4 — bugfix 3.6: resultado terminal sin canal IPC nuevo.
  test("Caso 4 (3.6) — IPC_CHANNELS es el set ACTUAL, sin ningún canal de pendingOperation/getPendingOperation", () => {
    // El conjunto de claves de IPC_CHANNELS ACTUAL. Esta GUARDIA es especifica del
    // fix de BUG-007 (P-25/3.6): verifica que ESE fix en particular no haya
    // introducido un canal de pendingOperation/getPendingOperation (ver el chequeo
    // explicito mas abajo). No es una prohibicion general de agregar canales para
    // features NUEVAS y no relacionadas (P-37 sumo getPaths/setManualPath para la
    // pantalla de Configuracion) - esta lista se actualiza cuando eso pasa.
    const expectedKeys = [
      "detectPaths",
      "getPaths",
      "setManualPath",
      "scanAddons",
      "classifyVScript",
      "getActiveSet",
      "previewActiveSet",
      "applyActiveSet",
      "addAddon",
      "removeAddon",
      "getResumeState",
      "mergeProgress",
      "willNeedElevation",
      "isResuming",
      "getTitles",
    ].sort();

    expect(Object.keys(IPC_CHANNELS).sort()).toEqual(expectedKeys);

    // Guardia explícita: no existe una clave nueva de "pendingOperation".
    expect(IPC_CHANNELS).not.toHaveProperty("getPendingOperation");
    expect(IPC_CHANNELS).not.toHaveProperty("pendingOperation");
    // El resultado terminal sigue viajando por el canal existente getResumeState.
    expect(IPC_CHANNELS.getResumeState).toBe("activeSet:resumeState");
  });

  // Caso 5 — bugfix 3.1 (elevación una vez por sesión): NO se ejercita acá.
  //
  // Ejercitar "elevación una sola vez por sesión" requeriría un provider ya
  // ELEVADO (isElevated() === true) para verificar que ensureCanWrite/
  // handleWriteFailure no relanzan `runas`. Montar ese estado en este archivo de
  // composición sería frágil y duplicaría lo ya cubierto. La preservación de 3.1
  // se cubre en los tests existentes de elevation-service (ver
  // test/elevation-service*.test.ts). No se fuerza un test frágil acá.
});
