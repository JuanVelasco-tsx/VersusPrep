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
  OperationResult,
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
  for (const type of [
    "applyActiveSet",
    "addAddon",
    "removeAddon",
    "addAddons",
    "removeAddons",
  ] as const) {
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

  // ---------------------------------------------------------------------------
  // P-30, Paso 3.5 (cierra DECISIÓN 8 de merge-orchestrator.ts): el cuarto type
  // válido, "switchActivePreset", además EXIGE --l4d2-resume-preset-id.
  // ---------------------------------------------------------------------------

  test("switchActivePreset con --l4d2-resume-preset-id -> PendingOperation con presetId", () => {
    const argv = [
      "--l4d2-resume-type",
      "switchActivePreset",
      "--l4d2-resume-handle",
      "H1",
      "--l4d2-resume-preset-id",
      "preset-a1b2c3",
    ];
    expect(parseResumeArgs(argv)).toEqual({
      type: "switchActivePreset",
      resumeHandle: "H1",
      presetId: "preset-a1b2c3",
    });
  });

  test("switchActivePreset SIN --l4d2-resume-preset-id -> null (datos incompletos, no hay resume válido)", () => {
    const argv = ["--l4d2-resume-type", "switchActivePreset", "--l4d2-resume-handle", "H1"];
    expect(parseResumeArgs(argv)).toBeNull();
  });

  test("switchActivePreset con --l4d2-resume-preset-id como ULTIMO token (sin valor) -> null", () => {
    const argv = [
      "--l4d2-resume-type",
      "switchActivePreset",
      "--l4d2-resume-handle",
      "H1",
      "--l4d2-resume-preset-id",
    ];
    expect(parseResumeArgs(argv)).toBeNull();
  });

  test("applyActiveSet/addAddon/removeAddon con --l4d2-resume-preset-id presente lo IGNORAN (solo lo usa switchActivePreset)", () => {
    const argv = [
      "--l4d2-resume-type",
      "applyActiveSet",
      "--l4d2-resume-handle",
      "H1",
      "--l4d2-resume-preset-id",
      "preset-a1b2c3",
    ];
    // El resultado NO lleva presetId: no es un campo relevante para este type.
    expect(parseResumeArgs(argv)).toEqual({ type: "applyActiveSet", resumeHandle: "H1" });
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
      onScanProgress: () => {},
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
    scanProgressBroadcaster: () => {},
  };
}

describe("runStartupSequence", () => {
  test("(a) detect ready + sin flags de resume -> ready, persiste rutas, isResuming false", async () => {
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
      // (BUG-004, A1) Sin flags de resume: isResuming false, readResumeState null,
      // y runResume es un no-op que no toca el estado.
      expect(outcome.isResuming).toBe(false);
      expect(outcome.readResumeState()).toBeNull();
      await outcome.runResume();
      expect(outcome.readResumeState()).toBeNull();
    }
  });

  test("(c) detect ready + flags de resume + sesion pendiente -> isResuming true, resumeState en curso (result null) ANTES de runResume", async () => {
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
    // Sembrar una sesion pendiente en el LocalStore real (:memory:) para que
    // isResuming (parseResumeArgs + getPendingSession != null) de true.
    base.localStore.savePendingSession([{ addonId: "111", priorityOrder: 0 }]);

    const argv = ["--l4d2-resume-type", "applyActiveSet", "--l4d2-resume-handle", "H1"];
    const outcome = await runStartupSequence(base, makeStartupIo(argv));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") {
      // HECHO ESTATICO: arranco para resumir.
      expect(outcome.isResuming).toBe(true);
      // A1: el resume NO corrio en el startup; el estado esta "en curso"
      // (result null) hasta que main.ts dispare runResume tras crear la ventana.
      const state = outcome.readResumeState();
      expect(state).not.toBeNull();
      expect(state?.result).toBeNull();
    }
  });
  test("(d) BUG-004: si runResume lanza (scan de Workshop inexistente), readResumeState queda con result failure, NO null", async () => {
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
    // Sesion pendiente sembrada -> isResuming true. El AddonScanner real va a
    // intentar leer SAMPLE_PATHS.workshopFolder (ruta ficticia inexistente) y
    // LANZAR (ENOENT), ejercitando el catch de runResume.
    base.localStore.savePendingSession([{ addonId: "111", priorityOrder: 0 }]);

    const argv = ["--l4d2-resume-type", "applyActiveSet", "--l4d2-resume-handle", "H1"];
    const outcome = await runStartupSequence(base, makeStartupIo(argv));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") {
      expect(outcome.isResuming).toBe(true);
      // Antes de runResume: en curso (result null).
      expect(outcome.readResumeState()?.result).toBeNull();

      // runResume NO debe rechazar (el catch interno traga la excepcion).
      await expect(outcome.runResume()).resolves.toBeUndefined();

      // Tras runResume: resultado TERMINAL de fallo, NO null (el renderer puede
      // salir de "Restaurando..." con un error en vez de colgarse).
      const state = outcome.readResumeState();
      expect(state).not.toBeNull();
      expect(state?.result?.status).toBe("failure");
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

// ---------------------------------------------------------------------------
// BUG-007: pendingEntries en el ResumeState (unit tests CONCRETOS)
// ---------------------------------------------------------------------------
//
// Estos tests fijan ejemplos concretos (no property) del comportamiento de
// `pendingEntries` capturado por `runStartupSequence`/`runResume`, complementando
// el property test de la tarea 4.1. Reutilizan los helpers de este archivo
// (makeIndependentIo, makeFakePathDetector, makeBaseWith, makeStartupIo,
// SAMPLE_PATHS) para no duplicar el andamiaje.
//
// Casos cubiertos:
//  1. resumeState inicial incluye pendingEntries (candidato NO vacío), ordenado,
//     con result null (resume en curso) ANTES de runResume.
//  2. resumeState inicial con candidato VACÍO []: ResumeState no es null,
//     pendingEntries === [], result null (distinto de "sin resume").
//  3. Tras runResume en la rama de ÉXITO (mergeOrchestrator doble que devuelve un
//     OperationResult success): pendingEntries SIGUE siendo el candidato y
//     result.status === "success".
//  4. Tras runResume en la rama de CATCH (scan real sobre workshopFolder
//     inexistente lanza): result.status === "failure" y pendingEntries SIGUE
//     reflejando el candidato capturado.
//  5. Sin resume (sin args): readResumeState() === null (preservación) — se
//     omite como test dedicado por ser redundante con el caso (a) ya existente en
//     "runStartupSequence"; ver nota más abajo.

/** PathDetectionResult "ready" reutilizable para los casos de resume. */
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

/** argv de resume estándar usado en los casos de este bloque. */
const RESUME_ARGV = [
  "--l4d2-resume-type",
  "applyActiveSet",
  "--l4d2-resume-handle",
  "H1",
] as const;

describe("runStartupSequence — BUG-007 pendingEntries en ResumeState", () => {
  test("caso 1: resumeState INICIAL incluye pendingEntries (candidato no vacío, ordenado) con result null", async () => {
    const base = makeBaseWith(makeFakePathDetector(READY_DETECTION));
    // Candidato con dos entries; savePendingSession/getPendingSession garantizan
    // orden ascendente por priorityOrder (luego addonId).
    const candidato: AddonManifestEntry[] = [
      { addonId: "a", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 2 },
    ];
    base.localStore.savePendingSession(candidato);

    const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") {
      // ANTES de runResume: resume "en curso" (result null) pero con el candidato
      // ya capturado en pendingEntries.
      const state = outcome.readResumeState();
      expect(state).not.toBeNull();
      expect(state?.result).toBeNull();
      expect(state?.pendingEntries).toEqual(candidato);
    }
  });

  test("caso 2: resumeState INICIAL con candidato VACÍO [] -> ResumeState no null, pendingEntries [], result null", async () => {
    const base = makeBaseWith(makeFakePathDetector(READY_DETECTION));
    // Sesión activa con candidato intencionalmente vacío (active = 1, filas = 0).
    // getPendingSession() devuelve [] (no null), así que isResuming es true.
    base.localStore.savePendingSession([]);

    const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") {
      expect(outcome.isResuming).toBe(true);
      const state = outcome.readResumeState();
      // Distinto de "sin resume" (que sería null): el objeto existe con [] .
      expect(state).not.toBeNull();
      expect(state?.result).toBeNull();
      expect(state?.pendingEntries).toEqual([]);
    }
  });

  test("caso 3: tras runResume en la rama de ÉXITO -> pendingEntries SIGUE siendo el candidato y result.status success", async () => {
    const base = makeBaseWith(makeFakePathDetector(READY_DETECTION));
    const candidato: AddonManifestEntry[] = [
      { addonId: "a", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 2 },
    ];
    base.localStore.savePendingSession(candidato);

    const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") {
      // Para ejercitar la rama de ÉXITO real (sin que el AddonScanner sobre el
      // workshopFolder ficticio lance), se sustituye el mergeOrchestrator del
      // outcome por un doble simple cuyo resumePendingOperation resuelve un
      // OperationResult success. El closure runResume captura la MISMA referencia
      // `pathDependent` que expone `outcome.pathDependent`, así que mutar acá el
      // mergeOrchestrator hace que runResume use el doble.
      const successResult: OperationResult = {
        status: "success",
        installedManifest: candidato,
      };
      outcome.pathDependent.mergeOrchestrator = {
        async resumePendingOperation(): Promise<OperationResult | null> {
          return successResult;
        },
      } as unknown as (typeof outcome.pathDependent)["mergeOrchestrator"];

      await expect(outcome.runResume()).resolves.toBeUndefined();

      const state = outcome.readResumeState();
      expect(state).not.toBeNull();
      // El resultado terminal es el success del doble...
      expect(state?.result?.status).toBe("success");
      // ...y pendingEntries SIGUE reflejando el candidato capturado antes del clear.
      expect(state?.pendingEntries).toEqual(candidato);
    }
  });

  test("caso 4: tras runResume en la rama de CATCH (scan real lanza) -> result.status failure y pendingEntries SIGUE siendo el candidato", async () => {
    const base = makeBaseWith(makeFakePathDetector(READY_DETECTION));
    const candidato: AddonManifestEntry[] = [
      { addonId: "a", priorityOrder: 1 },
      { addonId: "b", priorityOrder: 2 },
    ];
    base.localStore.savePendingSession(candidato);

    const outcome = await runStartupSequence(base, makeStartupIo(RESUME_ARGV));

    expect(outcome.kind).toBe("ready");
    if (outcome.kind === "ready") {
      // Sin sustituir el mergeOrchestrator: el AddonScanner real intenta leer
      // SAMPLE_PATHS.workshopFolder (inexistente) y lanza (ENOENT), cayendo en el
      // catch de runResume. El catch NO debe propagar la excepción.
      await expect(outcome.runResume()).resolves.toBeUndefined();

      const state = outcome.readResumeState();
      expect(state).not.toBeNull();
      // Resultado TERMINAL de fallo (el renderer puede salir de "Restaurando...").
      expect(state?.result?.status).toBe("failure");
      // pendingEntries preservado también en la rama de catch.
      expect(state?.pendingEntries).toEqual(candidato);
    }
  });

  // Caso 5 (sin resume => readResumeState() null): OMITIDO como test dedicado por
  // ser redundante con el caso (a) del describe "runStartupSequence" de este mismo
  // archivo, que ya asevera `outcome.readResumeState()` === null cuando no hay args
  // de resume. Se documenta acá para dejar rastro de la decisión (tarea 6.1).
});
