import { describe, expect, test } from "vitest";

import {
  L4D2_APP_ID,
  PathDetector,
  STEAM_REGISTRY_HIVE,
  STEAM_REGISTRY_KEY,
  STEAM_REGISTRY_VALUE,
  findGameLibrary,
  parseLibraryFolders,
  pathsReady,
} from "../src/main/domain/index.js";
import type {
  FileReadResult,
  FileSystemProbe,
  GamePaths,
  ManualPathProvider,
  ManualPathRequest,
  ManualPathResponse,
  PathVerification,
  RegistryReader,
} from "../src/main/domain/index.js";

/**
 * Tests unitarios mínimos de la Tarea 5.1 (parseo de `libraryfolders.vdf` y
 * `findGameLibrary`, AC 1.3 / AC 1.5 / AC 1.6).
 *
 * NOTA: esto NO es el property test de la tarea 5.2 (Property 1). Son ejemplos
 * representativos que fijan el comportamiento del parser KeyValues y la política
 * de selección "primera biblioteca con 550 en orden de aparición".
 */

// ---------------------------------------------------------------------------
// parseLibraryFolders — parser KeyValues de Valve
// ---------------------------------------------------------------------------

describe("parseLibraryFolders: parseo KeyValues (AC 1.3)", () => {
  test("estructura real confirmada: extrae path y AppIDs en orden", () => {
    const vdf = `
"libraryfolders"
{
    "0"
    {
        "path"    "C:\\\\Program Files (x86)\\\\Steam"
        "apps"
        {
            "228980"  "123456"
            "550"     "789012"
        }
    }
    "1"
    {
        "path"    "D:\\\\SteamLibrary"
        "apps"
        {
            "620"  "111"
        }
    }
}
`;
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([
      { path: "C:\\Program Files (x86)\\Steam", apps: ["228980", "550"] },
      { path: "D:\\SteamLibrary", apps: ["620"] },
    ]);
  });

  test("tolera indentación/espacios/tabs arbitrarios y `apps` inline", () => {
    const vdf =
      '"libraryfolders"{ "0" {\t"path"\t"E:\\\\Lib"   "apps"  { "550" "1" "222" "2" } } }';
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "E:\\Lib", apps: ["550", "222"] }]);
  });

  test("soporta saltos de línea \\r\\n (Windows)", () => {
    const vdf =
      '"libraryfolders"\r\n{\r\n\t"0"\r\n\t{\r\n\t\t"path"\t"F:\\\\S"\r\n\t\t"apps"\r\n\t\t{\r\n\t\t\t"550"\t"9"\r\n\t\t}\r\n\t}\r\n}\r\n';
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "F:\\S", apps: ["550"] }]);
  });

  test("descarta comentarios `//` fuera de comillas (decisión 1)", () => {
    const vdf = `
"libraryfolders"
{
    // esta es la biblioteca principal
    "0"
    {
        "path"    "C:\\\\Steam"   // ruta de instalacion
        "apps"
        {
            "550"  "1" // L4D2
        }
    }
}
`;
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "C:\\Steam", apps: ["550"] }]);
  });

  test("un `//` dentro de comillas NO inicia comentario", () => {
    const vdf = '"libraryfolders" { "0" { "path" "http://x//y" "apps" { } } }';
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "http://x//y", apps: [] }]);
  });

  test("contenido vacío o sin bibliotecas produce []", () => {
    expect(parseLibraryFolders("")).toEqual([]);
    expect(parseLibraryFolders('"libraryfolders" { }')).toEqual([]);
  });

  test("biblioteca sin `apps` produce apps=[] (decisión 6)", () => {
    const vdf = '"libraryfolders" { "0" { "path" "C:\\\\Steam" } }';
    const entries = parseLibraryFolders(vdf);
    expect(entries).toEqual([{ path: "C:\\Steam", apps: [] }]);
  });
});

// ---------------------------------------------------------------------------
// findGameLibrary — primera biblioteca con 550 en orden de aparición
// ---------------------------------------------------------------------------

describe("findGameLibrary: primera lib con 550 en orden (AC 1.5, 1.6)", () => {
  test("caso: 0 bibliotecas con 550 devuelve null (AC 1.6)", () => {
    const entries = parseLibraryFolders(`
"libraryfolders"
{
    "0" { "path" "C:\\\\Steam" "apps" { "228980" "1" } }
    "1" { "path" "D:\\\\Lib"   "apps" { "620" "2" "570" "3" } }
}
`);
    expect(findGameLibrary(entries)).toBeNull();
  });

  test("caso: varias con 550, gana la primera en orden de aparición (AC 1.5)", () => {
    const entries = parseLibraryFolders(`
"libraryfolders"
{
    "0" { "path" "C:\\\\Steam"      "apps" { "228980" "1" } }
    "1" { "path" "D:\\\\SteamLib"   "apps" { "550" "2" } }
    "2" { "path" "E:\\\\OtherLib"   "apps" { "550" "3" } }
}
`);
    // Gana "D:\SteamLib" (primera con 550), no "E:\OtherLib".
    expect(findGameLibrary(entries)).toBe("D:\\SteamLib");
  });

  test("caso: L4D2 en biblioteca de otro disco (AC 1.7) — devuelve ese path", () => {
    const entries = parseLibraryFolders(`
"libraryfolders"
{
    "0" { "path" "C:\\\\Program Files (x86)\\\\Steam" "apps" { "440" "1" } }
    "1" { "path" "G:\\\\Games\\\\SteamLibrary"        "apps" { "550" "2" } }
}
`);
    expect(findGameLibrary(entries)).toBe("G:\\Games\\SteamLibrary");
  });

  test("caso: única biblioteca con 550 devuelve su path", () => {
    const entries = parseLibraryFolders(
      '"libraryfolders" { "0" { "path" "C:\\\\Steam" "apps" { "550" "1" } } }',
    );
    expect(findGameLibrary(entries)).toBe("C:\\Steam");
  });

  test("lista vacía de entradas devuelve null", () => {
    expect(findGameLibrary([])).toBeNull();
  });

  test("L4D2_APP_ID es el literal '550'", () => {
    expect(L4D2_APP_ID).toBe("550");
  });
});

// ===========================================================================
// Tarea 5.3 — readSteamPath / derivePaths / verifyPathsOnDisk / detect
// ---------------------------------------------------------------------------
// Tests unitarios con dependencias MOCKEADAS en memoria (registro, FS y
// selección manual), al estilo del mock de `CommandRunner` de vpk-tool.test.ts.
// NO es el property test 5.4 (Property 2): son ejemplos representativos que
// fijan el comportamiento del flujo y sus caminos de fallo (AC 1.1–1.12).
// ===========================================================================

/** RegistryReader mockeado: devuelve un valor fijo (o null) para SteamPath. */
class MockRegistry implements RegistryReader {
  #value: string | null;
  readonly calls: Array<{ hive: string; key: string; value: string }> = [];

  constructor(value: string | null) {
    this.#value = value;
  }

  async readValue(hive: string, key: string, value: string): Promise<string | null> {
    this.calls.push({ hive, key, value });
    return this.#value;
  }
}

/**
 * FileSystemProbe mockeado en memoria: un conjunto de rutas EXISTENTES y un
 * contenido opcional para `readTextFile` (el VDF). Cualquier ruta fuera del set
 * "no existe"; el archivo de texto se devuelve solo si se configuró.
 */
class MockFs implements FileSystemProbe {
  #existing: Set<string>;
  #files: Map<string, string>;
  readonly existsCalls: string[] = [];

  constructor(existing: Iterable<string> = [], files: Iterable<[string, string]> = []) {
    this.#existing = new Set(existing);
    this.#files = new Map(files);
  }

  addExisting(...paths: string[]): this {
    for (const p of paths) this.#existing.add(p);
    return this;
  }

  async readTextFile(path: string): Promise<FileReadResult> {
    const content = this.#files.get(path);
    if (content === undefined) {
      return { ok: false };
    }
    return { ok: true, content };
  }

  async exists(path: string): Promise<boolean> {
    this.existsCalls.push(path);
    return this.#existing.has(path);
  }
}

/**
 * ManualPathProvider mockeado: responde con una COLA de respuestas por tipo de
 * request. Cada `requestPath` consume la siguiente respuesta programada para ese
 * `kind` (`steam-path`/`game-root`/`required-path`). Si se agota, cancela.
 */
class MockManual implements ManualPathProvider {
  #steamPath: ManualPathResponse[] = [];
  #gameRoot: ManualPathResponse[] = [];
  #requiredByKey = new Map<string, ManualPathResponse[]>();
  readonly requests: ManualPathRequest[] = [];

  onSteamPath(...responses: ManualPathResponse[]): this {
    this.#steamPath.push(...responses);
    return this;
  }

  onGameRoot(...responses: ManualPathResponse[]): this {
    this.#gameRoot.push(...responses);
    return this;
  }

  onRequiredPath(pathKey: string, ...responses: ManualPathResponse[]): this {
    const list = this.#requiredByKey.get(pathKey) ?? [];
    list.push(...responses);
    this.#requiredByKey.set(pathKey, list);
    return this;
  }

  async requestPath(request: ManualPathRequest): Promise<ManualPathResponse> {
    this.requests.push(request);
    if (request.kind === "steam-path") {
      return this.#steamPath.shift() ?? { kind: "cancelled" };
    }
    if (request.kind === "game-root") {
      return this.#gameRoot.shift() ?? { kind: "cancelled" };
    }
    const list = this.#requiredByKey.get(request.pathKey) ?? [];
    return list.shift() ?? { kind: "cancelled" };
  }
}

const selected = (path: string): ManualPathResponse => ({ kind: "selected", path });
const cancelled: ManualPathResponse = { kind: "cancelled" };

/** Construye un PathDetector con las dependencias dadas (o mocks vacíos). */
function makeDetector(opts: {
  registry?: RegistryReader;
  fs?: FileSystemProbe;
  manual?: ManualPathProvider;
}): PathDetector {
  return new PathDetector({
    registry: opts.registry ?? new MockRegistry(null),
    fs: opts.fs ?? new MockFs(),
    manual: opts.manual ?? new MockManual(),
  });
}

// Rutas de referencia usadas en varios tests (Game_Library en disco D:).
const STEAM = "C:\\Program Files (x86)\\Steam";
const LIB = "D:\\SteamLibrary";
const GAME_ROOT = "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2";
const L4D2_DIR = `${GAME_ROOT}\\left4dead2`;
const WORKSHOP = `${L4D2_DIR}\\addons\\workshop`;
const VPK_TOOL = `${GAME_ROOT}\\bin\\vpk.exe`;
const GAMEINFO = `${L4D2_DIR}\\gameinfo.txt`;
const MODSVS = `${GAME_ROOT}\\modsvs`;
const VDF_PATH = `${STEAM}\\steamapps\\libraryfolders.vdf`;

/** VDF cuyo bloque 550 vive en la biblioteca D: (otro disco que Steam en C:). */
function vdfWithL4D2OnD(): string {
  return `
"libraryfolders"
{
    "0" { "path" "${STEAM.replace(/\\/g, "\\\\")}" "apps" { "440" "1" } }
    "1" { "path" "${LIB.replace(/\\/g, "\\\\")}" "apps" { "550" "2" } }
}
`;
}

/** Todas las rutas requeridas para que la detección "feliz" termine en ready. */
const ALL_REQUIRED = [GAME_ROOT, WORKSHOP, VPK_TOOL, GAMEINFO, MODSVS];

describe("readSteamPath (AC 1.1, 1.2)", () => {
  test("devuelve null cuando la clave/valor no existe", async () => {
    const registry = new MockRegistry(null);
    const detector = makeDetector({ registry });
    expect(await detector.readSteamPath()).toBeNull();
    // Leyó el hive/key/value correctos.
    expect(registry.calls).toEqual([
      { hive: STEAM_REGISTRY_HIVE, key: STEAM_REGISTRY_KEY, value: STEAM_REGISTRY_VALUE },
    ]);
  });

  test("devuelve el path cuando existe", async () => {
    const detector = makeDetector({ registry: new MockRegistry(STEAM) });
    expect(await detector.readSteamPath()).toBe(STEAM);
  });

  test("una cadena vacía se trata como ausente (null)", async () => {
    const detector = makeDetector({ registry: new MockRegistry("   ") });
    expect(await detector.readSteamPath()).toBeNull();
  });
});

describe("derivePaths (AC 1.7, 1.8)", () => {
  test("deriva todas las rutas desde la Game_Library (no del steamPath)", () => {
    const detector = makeDetector({});
    const paths = detector.derivePaths(LIB, STEAM);
    expect(paths).toEqual({
      steamPath: STEAM,
      gameRoot: GAME_ROOT,
      left4dead2Dir: L4D2_DIR,
      workshopFolder: WORKSHOP,
      vpkToolPath: VPK_TOOL,
      gameInfoFile: GAMEINFO,
      modsvsFolder: MODSVS,
    });
  });

  test("usa el disco de la lib aun si difiere del disco del steamPath (AC 1.7)", () => {
    const detector = makeDetector({});
    // steamPath en C:, biblioteca en G: → todo cuelga de G:, no de C:.
    const paths = detector.derivePaths("G:\\Games\\SteamLibrary", "C:\\Steam");
    expect(paths.gameRoot).toBe("G:\\Games\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2");
    expect(paths.vpkToolPath.startsWith("G:\\")).toBe(true);
    expect(paths.steamPath).toBe("C:\\Steam"); // steamPath solo informativo
  });
});

describe("verifyPathsOnDisk (AC 1.9)", () => {
  test("marca faltantes: algunas presentes, otras no; allPresent=false", async () => {
    // Solo existen gameRoot y workshop; faltan vpkTool y gameinfo.
    // NOTA (BUG-009): `modsvsFolder` ya NO está en REQUIRED_PATH_KEYS (la app la
    // crea), así que `verifyPathsOnDisk` ya no la incluye en `present` ni en
    // `missing`. Solo se verifican las 4 rutas que sí deben preexistir.
    const fs = new MockFs([GAME_ROOT, WORKSHOP]);
    const detector = makeDetector({ fs });
    const paths = detector.derivePaths(LIB, STEAM);
    const v = await detector.verifyPathsOnDisk(paths);
    expect(v.present).toEqual({
      gameRoot: true,
      workshopFolder: true,
      vpkToolPath: false,
      gameInfoFile: false,
    });
    expect(v.missing).toEqual(["vpkToolPath", "gameInfoFile"]);
    expect(v.allPresent).toBe(false);
  });

  test("allPresent=true solo cuando TODAS las requeridas existen", async () => {
    const fs = new MockFs(ALL_REQUIRED);
    const detector = makeDetector({ fs });
    const paths = detector.derivePaths(LIB, STEAM);
    const v = await detector.verifyPathsOnDisk(paths);
    expect(v.allPresent).toBe(true);
    expect(v.missing).toEqual([]);
  });
});

describe("pathsReady: invariante verificación-antes-de-persistir (Property 2)", () => {
  const paths: GamePaths = {
    steamPath: STEAM,
    gameRoot: GAME_ROOT,
    left4dead2Dir: L4D2_DIR,
    workshopFolder: WORKSHOP,
    vpkToolPath: VPK_TOOL,
    gameInfoFile: GAMEINFO,
    modsvsFolder: MODSVS,
  };

  test("con allPresent=true produce 'ready'", () => {
    const verification: PathVerification = {
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
    const result = pathsReady(paths, verification, "auto");
    expect(result.kind).toBe("ready");
  });

  test("con allPresent=false NUNCA produce 'ready' (cae a needs-manual)", () => {
    const verification: PathVerification = {
      present: {
        gameRoot: true,
        workshopFolder: false,
        vpkToolPath: true,
        gameInfoFile: true,
        modsvsFolder: true,
      },
      missing: ["workshopFolder"],
      allPresent: false,
    };
    const result = pathsReady(paths, verification, "auto");
    expect(result.kind).toBe("needs-manual");
    if (result.kind === "needs-manual") {
      expect(result.reason).toBe("required-path-missing");
    }
  });
});

describe("detect: flujo completo (AC 1.1–1.12)", () => {
  test("camino feliz: todo existe → 'ready' con verificación presente (source auto)", async () => {
    const registry = new MockRegistry(STEAM);
    const fs = new MockFs(ALL_REQUIRED, [[VDF_PATH, vdfWithL4D2OnD()]]);
    const detector = makeDetector({ registry, fs });

    const result = await detector.detect();
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.source).toBe("auto");
      expect(result.verification.allPresent).toBe(true);
      expect(result.paths.gameRoot).toBe(GAME_ROOT); // derivado del disco D: (AC 1.7)
    }
  });

  test("Steam ausente y usuario cancela → needs-manual steam-not-installed (AC 1.2)", async () => {
    const registry = new MockRegistry(null);
    const manual = new MockManual().onSteamPath(cancelled);
    const detector = makeDetector({ registry, manual });

    const result = await detector.detect();
    expect(result).toEqual({ kind: "needs-manual", reason: "steam-not-installed" });
    expect(manual.requests[0]).toEqual({ kind: "steam-path" });
  });

  test("Steam ausente pero selección manual válida continúa el flujo (AC 1.2, 1.11)", async () => {
    // El registro no da SteamPath; el usuario elige uno EXISTENTE que además
    // contiene el VDF con L4D2 y todas las rutas existen → ready (source manual).
    const registry = new MockRegistry(null);
    const fs = new MockFs([STEAM, ...ALL_REQUIRED], [[VDF_PATH, vdfWithL4D2OnD()]]);
    const manual = new MockManual().onSteamPath(selected(STEAM));
    const detector = makeDetector({ registry, fs, manual });

    const result = await detector.detect();
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.source).toBe("manual");
    }
  });

  test("libraryfolders.vdf ausente → selección manual del Game_Root (AC 1.4)", async () => {
    const registry = new MockRegistry(STEAM);
    // FS sin el VDF (readTextFile → ok:false). El usuario da el Game_Root y todo existe.
    const fs = new MockFs(ALL_REQUIRED);
    const manual = new MockManual().onGameRoot(selected(GAME_ROOT));
    const detector = makeDetector({ registry, fs, manual });

    const result = await detector.detect();
    expect(result.kind).toBe("ready");
    // Se pidió el Game_Root (no una required-path directamente).
    expect(manual.requests.some((r) => r.kind === "game-root")).toBe(true);
    if (result.kind === "ready") {
      expect(result.source).toBe("manual");
    }
  });

  test("ninguna lib con 550 → selección manual del Game_Root (AC 1.6)", async () => {
    const registry = new MockRegistry(STEAM);
    const vdfNo550 = `"libraryfolders" { "0" { "path" "${LIB.replace(
      /\\/g,
      "\\\\",
    )}" "apps" { "440" "1" } } }`;
    const fs = new MockFs(ALL_REQUIRED, [[VDF_PATH, vdfNo550]]);
    const manual = new MockManual().onGameRoot(selected(GAME_ROOT));
    const detector = makeDetector({ registry, fs, manual });

    const result = await detector.detect();
    expect(result.kind).toBe("ready");
    expect(manual.requests.some((r) => r.kind === "game-root")).toBe(true);
  });

  test("una ruta derivada falta → selección manual de ESA ruta + re-verificación (AC 1.10, 1.11)", async () => {
    const registry = new MockRegistry(STEAM);
    // NOTA (BUG-009): `modsvsFolder` ya NO se verifica ni se pide manualmente.
    // Se usa `vpkToolPath` (que SIGUE en REQUIRED_PATH_KEYS) como la ruta faltante
    // que se pide manualmente. Falta vpkTool; el resto existe. El usuario da un
    // vpk.exe alternativo que SÍ existe.
    const altVpk = "E:\\alt\\vpk.exe";
    const fs = new MockFs(
      [GAME_ROOT, WORKSHOP, GAMEINFO, altVpk],
      [[VDF_PATH, vdfWithL4D2OnD()]],
    );
    const manual = new MockManual().onRequiredPath("vpkToolPath", selected(altVpk));
    const detector = makeDetector({ registry, fs, manual });

    const result = await detector.detect();
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.source).toBe("manual");
      expect(result.paths.vpkToolPath).toBe(altVpk);
      expect(result.verification.allPresent).toBe(true);
    }
    // Se pidió específicamente la ruta vpkToolPath.
    expect(
      manual.requests.some(
        (r) => r.kind === "required-path" && r.pathKey === "vpkToolPath",
      ),
    ).toBe(true);
  });

  test("primera ruta manual NO existe, segunda SÍ → reintento (AC 1.12)", async () => {
    const registry = new MockRegistry(STEAM);
    // NOTA (BUG-009): se usa `gameInfoFile` (sigue en REQUIRED_PATH_KEYS) en vez
    // de `modsvsFolder`, que ya no se verifica ni se pide manualmente.
    const badGameinfo = "E:\\does-not-exist\\gameinfo.txt";
    const goodGameinfo = "E:\\good\\gameinfo.txt";
    // goodGameinfo existe; badGameinfo NO. El usuario primero da la mala, luego la buena.
    const fs = new MockFs(
      [GAME_ROOT, WORKSHOP, VPK_TOOL, goodGameinfo],
      [[VDF_PATH, vdfWithL4D2OnD()]],
    );
    const manual = new MockManual().onRequiredPath(
      "gameInfoFile",
      selected(badGameinfo),
      selected(goodGameinfo),
    );
    const detector = makeDetector({ registry, fs, manual });

    const result = await detector.detect();
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") {
      expect(result.paths.gameInfoFile).toBe(goodGameinfo);
    }
    // Se solicitó gameInfoFile DOS veces (la mala se rechazó por no existir).
    const gameinfoRequests = manual.requests.filter(
      (r) => r.kind === "required-path" && r.pathKey === "gameInfoFile",
    );
    expect(gameinfoRequests.length).toBe(2);
  });

  test("ruta faltante y usuario cancela → needs-manual required-path-missing", async () => {
    const registry = new MockRegistry(STEAM);
    // NOTA (BUG-009): se usa `vpkToolPath` (sigue en REQUIRED_PATH_KEYS) como la
    // ruta faltante, ya que `modsvsFolder` dejó de verificarse/pedirse.
    // Falta vpkTool y el usuario cancela la selección manual.
    const fs = new MockFs(
      [GAME_ROOT, WORKSHOP, GAMEINFO],
      [[VDF_PATH, vdfWithL4D2OnD()]],
    );
    const manual = new MockManual().onRequiredPath("vpkToolPath", cancelled);
    const detector = makeDetector({ registry, fs, manual });

    const result = await detector.detect();
    expect(result.kind).toBe("needs-manual");
    if (result.kind === "needs-manual") {
      expect(result.reason).toBe("required-path-missing");
      expect(result.verification?.missing).toContain("vpkToolPath");
    }
  });

  // -------------------------------------------------------------------------
  // Cancelaciones terminales: la cancelación de una selección manual SIEMPRE
  // termina la detección en needs-manual (definitivo). El ÚNICO bucle de
  // reintento de #requestExisting es para rutas `selected` inexistentes
  // (AC 1.12), NUNCA para `cancelled`.
  // -------------------------------------------------------------------------

  test("Game_Root cancelado tras VDF ausente → needs-manual library-folders-unreadable (AC 1.4)", async () => {
    const registry = new MockRegistry(STEAM);
    // FS sin el VDF (readTextFile → ok:false). El usuario CANCELA el Game_Root.
    const fs = new MockFs(ALL_REQUIRED);
    const manual = new MockManual().onGameRoot(cancelled);
    const detector = makeDetector({ registry, fs, manual });

    const result = await detector.detect();
    expect(result).toEqual({
      kind: "needs-manual",
      reason: "library-folders-unreadable",
    });
  });

  test("Game_Root cancelado tras ninguna lib con 550 → needs-manual l4d2-not-in-libraries (AC 1.6)", async () => {
    const registry = new MockRegistry(STEAM);
    // VDF válido pero SIN la clave 550. El usuario CANCELA el Game_Root.
    const vdfNo550 = `"libraryfolders" { "0" { "path" "${LIB.replace(
      /\\/g,
      "\\\\",
    )}" "apps" { "440" "1" } } }`;
    const fs = new MockFs(ALL_REQUIRED, [[VDF_PATH, vdfNo550]]);
    const manual = new MockManual().onGameRoot(cancelled);
    const detector = makeDetector({ registry, fs, manual });

    const result = await detector.detect();
    expect(result).toEqual({
      kind: "needs-manual",
      reason: "l4d2-not-in-libraries",
    });
  });

  test("la cancelación NO reintenta: se invoca al provider UNA sola vez y termina en needs-manual", async () => {
    // Caso más claro: Steam ausente + usuario cancela. Si #requestExisting
    // reintentara ante `cancelled`, habría más de una solicitud steam-path.
    const registry = new MockRegistry(null);
    const manual = new MockManual().onSteamPath(cancelled);
    const detector = makeDetector({ registry, manual });

    const result = await detector.detect();
    expect(result).toEqual({ kind: "needs-manual", reason: "steam-not-installed" });
    // Exactamente UNA invocación ante cancelación (no bucle infinito).
    expect(manual.requests.filter((r) => r.kind === "steam-path").length).toBe(1);
  });
});
