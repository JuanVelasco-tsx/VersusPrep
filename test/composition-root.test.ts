import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";

import {
  buildPathDependentDomain,
  buildPathIndependentDomain,
  createStartupProgressListener,
  parseResumeArgs,
  runStartupSequence,
} from "../src/main/app/composition-root.js";
import type {
  PathIndependentDomain,
  PathIndependentIo,
  StartupIo,
} from "../src/main/app/composition-root.js";
import {
  BackupManager,
  CollisionResolver,
  GameInfoEditor,
  PathDetector,
  ProcessGuard,
  AddonScanner,
  VScriptDetector,
} from "../src/main/domain/index.js";
import type {
  AddonManifestEntry,
  CommandResult,
  CommandRunner,
  GamePaths,
  MergeProgressEvent,
  MergeProgressListener,
  PathDetectionResult,
} from "../src/main/domain/index.js";

/**
 * Tests del bloque 5a de la Tarea 20.4 (composition-root). Dobles MANUALES sin
 * vi.fn() (mismo criterio de toda la sesion), Database(":memory:") real,
 * fakeRunner/dialog/spawnSyncFn falsos tipo los bloques 1/2/4.
 */

// ---------------------------------------------------------------------------
// Dobles manuales.
// ---------------------------------------------------------------------------

/** CommandRunner falso: devuelve exitCode 0 (o el configurado) sin tocar el SO. */
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

/** GamePaths de muestra COMPLETO (7 rutas) para que getPaths() no devuelva null. */
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

// ---------------------------------------------------------------------------
// parseResumeArgs
// ---------------------------------------------------------------------------

describe("parseResumeArgs", () => {
  for (const type of ["applyActiveSet", "addAddon", "removeAddon"] as const) {
    test(`caso valido con type=${type}`, () => {
      const argv = ["--l4d2-resume-type", type, "--l4d2-resume-handle", "H1"];
      expect(parseResumeArgs(argv)).toEqual({ type, resumeHandle: "H1" });
    });
  }

  test("flags ausentes -> null", () => {
    expect(parseResumeArgs(["--otra-cosa", "x"])).toBeNull();
    expect(parseResumeArgs([])).toBeNull();
  });

  test("valor faltante despues del flag -> null", () => {
    // --l4d2-resume-handle es el ultimo token: no hay valor despues.
    const argv = ["--l4d2-resume-type", "addAddon", "--l4d2-resume-handle"];
    expect(parseResumeArgs(argv)).toBeNull();
  });

  test("type invalido -> null", () => {
    const argv = ["--l4d2-resume-type", "borrarTodo", "--l4d2-resume-handle", "H1"];
    expect(parseResumeArgs(argv)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createStartupProgressListener
// ---------------------------------------------------------------------------

describe("createStartupProgressListener", () => {
  const evt: MergeProgressEvent = { step: "merge" };

  test("buffer null: el evento llega SOLO al broadcaster", () => {
    const received: MergeProgressEvent[] = [];
    const broadcaster: MergeProgressListener = (e) => received.push(e);
    const ref: { current: MergeProgressEvent[] | null } = { current: null };
    const listener = createStartupProgressListener(ref, broadcaster);

    listener(evt);

    expect(received).toEqual([evt]);
    expect(ref.current).toBeNull();
  });

  test("buffer activo ([]): el evento llega a AMBOS", () => {
    const received: MergeProgressEvent[] = [];
    const broadcaster: MergeProgressListener = (e) => received.push(e);
    const ref: { current: MergeProgressEvent[] | null } = { current: [] };
    const listener = createStartupProgressListener(ref, broadcaster);

    listener(evt);

    expect(ref.current).toEqual([evt]);
    expect(received).toEqual([evt]);
  });
});

// ---------------------------------------------------------------------------
// buildPathIndependentDomain
// ---------------------------------------------------------------------------

describe("buildPathIndependentDomain", () => {
  test("construye los componentes con instanceof / chequeo funcional", () => {
    const domain = buildPathIndependentDomain(makeIndependentIo());

    expect(domain.pathDetector).toBeInstanceOf(PathDetector);
    expect(domain.processGuard).toBeInstanceOf(ProcessGuard);
    expect(domain.collisionResolver).toBeInstanceOf(CollisionResolver);
    expect(domain.backupManager).toBeInstanceOf(BackupManager);
    expect(domain.gameInfoEditor).toBeInstanceOf(GameInfoEditor);
    // ElevationService/LocalStore se exponen por interfaz: chequeo funcional.
    expect(typeof domain.elevationService.needsElevation).toBe("function");
    expect(typeof domain.localStore.getPendingSession).toBe("function");
    // Los *FileSystem exponen sus metodos de contrato.
    expect(typeof domain.addonFileSystem.listEntries).toBe("function");
    expect(typeof domain.mergeFileSystem.ensureDir).toBe("function");
    expect(typeof domain.mergeOrchestratorFileSystem.ensureDir).toBe("function");
  });

  test("wiring cruzado REAL: elevationService y localStore son la MISMA instancia", async () => {
    const domain = buildPathIndependentDomain(makeIndependentIo());
    const entries: AddonManifestEntry[] = [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ];

    // relaunchElevated hace savePendingSession(entries) ANTES del relanzo (fakeRunner
    // exit 0 -> "launched"). Si el LocalStore devuelto es la misma instancia que usa
    // el ElevationServiceImpl, getPendingSession() reflejara esas entries.
    const outcome = await domain.elevationService.relaunchElevated(
      { type: "applyActiveSet", resumeHandle: "H1" },
      entries,
    );

    expect(outcome.kind).toBe("elevated-handoff");
    expect(domain.localStore.getPendingSession()).toEqual(entries);
  });
});

// ---------------------------------------------------------------------------
// buildPathDependentDomain
// ---------------------------------------------------------------------------

describe("buildPathDependentDomain", () => {
  test("instanceof de addonScanner/vscriptDetector y smoke de mergeOrchestrator", async () => {
    const base = buildPathIndependentDomain(makeIndependentIo());
    const dependent = buildPathDependentDomain(SAMPLE_PATHS, base, {
      commandRunner: makeFakeRunner(),
      tempDir: "C:\\tmp\\l4d2-temp",
      workRoot: "C:\\tmp\\l4d2-work",
      onProgress: () => {},
    });

    expect(dependent.addonScanner).toBeInstanceOf(AddonScanner);
    expect(dependent.vscriptDetector).toBeInstanceOf(VScriptDetector);
    // Sin sesion pendiente, resumePendingOperation resuelve null sin reventar.
    await expect(dependent.mergeOrchestrator.resumePendingOperation()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runStartupSequence
// ---------------------------------------------------------------------------

/** PathDetector falso que resuelve un PathDetectionResult fijo. */
function makeFakePathDetector(result: PathDetectionResult): PathDetector {
  return { async detect() { return result; } } as unknown as PathDetector;
}

/** Arma un PathIndependentDomain con un PathDetector falso y el resto real. */
function makeBaseWith(detector: PathDetector): PathIndependentDomain {
  const base = buildPathIndependentDomain(makeIndependentIo());
  return { ...base, pathDetector: detector };
}

function makeStartupIo(argv: readonly string[] = []): StartupIo {
  return {
    argv,
    commandRunner: makeFakeRunner(),
    tempDir: "C:\\tmp\\l4d2-temp",
    workRoot: "C:\\tmp\\l4d2-work",
    broadcaster: () => {},
  };
}

describe("runStartupSequence", () => {
  test("(a) detect ready + sin flags de resume -> ready, persiste rutas, resumeState null", async () => {
    const detector = makeFakePathDetector({
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
    });
    const base = makeBaseWith(detector);

    const outcome = await runStartupSequence(base, makeStartupIo([]));

    expect(outcome.kind).toBe("ready");
    expect(base.localStore.getPaths()).toEqual(SAMPLE_PATHS);
    if (outcome.kind === "ready") {
      expect(outcome.resumeState).toBeNull();
    }
  });

  test("(b) detect needs-manual -> fatal con reason, no persiste nada", async () => {
    const detector = makeFakePathDetector({
      kind: "needs-manual",
      reason: "steam-not-installed",
    });
    const base = makeBaseWith(detector);

    const outcome = await runStartupSequence(base, makeStartupIo([]));

    expect(outcome.kind).toBe("fatal");
    if (outcome.kind === "fatal") {
      expect(outcome.message).toContain("steam-not-installed");
    }
    expect(base.localStore.getPaths()).toBeNull();
  });
});