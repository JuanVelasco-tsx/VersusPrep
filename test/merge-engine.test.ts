import { describe, expect, test } from "vitest";

import { MergeEngine, VpkToolError } from "../src/main/domain/index.js";
import type {
  CollisionResolver,
  ExtractedRoot,
  GamePaths,
  MergeFileSystem,
  MergeReport,
  ScannedAddon,
  VpkTool,
} from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 11.2: orquestación del `MergeEngine` (AC 6.3, 6.8, 6.12).
 *
 * Estos tests ejercitan la RESPONSABILIDAD PROPIA de MergeEngine —el orden del
 * flujo (list → crear dirs → extract por addon; luego mergeInto; luego pack), la
 * creación de subdirectorios ANTES de extraer, la generación del `pak01_dir.vpk`
 * y el aborto identificando el addon ante un fallo de VpkTool— SIN tocar
 * `vpk.exe` ni disco reales. Las tres dependencias del constructor se mockean.
 *
 * NOTA: esto NO es un property test. Es un conjunto de ejemplos que fija el
 * contrato de orquestación documentado en `merge-engine.ts`. La lógica de
 * colisiones y la de `vpk.exe` tienen sus propios tests (10.x y 2.8); aquí se
 * verifica el ORDEN y el ABORTO de MergeEngine de forma aislada.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN DE MOCKEO — doble ESTRUCTURAL de VpkTool (no VpkTool real + runner).
 *
 * `VpkTool` es una CLASE concreta. Se optó por un DOBLE ESTRUCTURAL que
 * implementa su forma pública (`list`/`extract`/`pack`) y se castea a `VpkTool`,
 * en vez de construir un `VpkTool` real con un `CommandRunner` mockeado. Motivos:
 *
 *   - Log cronológico limpio y directo: cada método del doble registra un evento
 *     etiquetado (`{op:'list', addonId}`, etc.) en UN único array compartido con
 *     los demás dobles, así las aserciones de ORDEN (subdirs antes de extract;
 *     mergeInto tras todas las extracciones; pack al final) son inmediatas.
 *   - Control directo del fallo POR ADDON: inyectar "el 2.º addon falla en
 *     extract" es trivial (el doble compara el addonId recibido); con el
 *     CommandRunner real habría que mapear cada invocación cruda de `vpk x` a su
 *     addon (VpkTool no expone el addonId en los args), lo que enturbia el test.
 *   - Aislamiento: no dependemos del batching interno de `extract` ni del
 *     formato de args de `vpk.exe`; eso ya lo cubre `vpk-tool.test.ts` (2.8).
 *
 * `MergeFileSystem` es una interfaz: doble trivial cuyo `ensureDir` registra el
 * dir creado en el log. `CollisionResolver` es una CLASE: doble estructural que
 * registra `mergeInto(destDir, roots)` (guardando una copia de roots en orden) y
 * devuelve un `MergeReport` configurable (vacío por defecto, o uno con colisiones
 * reales vía `setReport` para verificar que llega intacto al retorno de merge);
 * se castea a `CollisionResolver`.
 * ---------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Log cronológico compartido y sus eventos
// ---------------------------------------------------------------------------

/**
 * Evento del log cronológico compartido entre los tres dobles. El `op` etiqueta
 * la operación; los campos opcionales identifican el addon / dir / destDir según
 * corresponda, para poder aserar el orden y el contenido de cada llamada.
 */
interface LogEvent {
  op: "list" | "ensureDir" | "extract" | "mergeInto" | "pack";
  addonId?: string;
  dir?: string;
  destDir?: string;
}

/** Índices de los eventos cuyo `op` coincide, en orden de aparición. */
function indicesOf(log: readonly LogEvent[], op: LogEvent["op"]): number[] {
  return log.flatMap((e, i) => (e.op === op ? [i] : []));
}

/** Primer índice de un `op` (o -1 si no aparece). */
function firstIndexOf(log: readonly LogEvent[], op: LogEvent["op"]): number {
  return log.findIndex((e) => e.op === op);
}

// ---------------------------------------------------------------------------
// Dobles de las tres dependencias del constructor de MergeEngine
// ---------------------------------------------------------------------------

/**
 * Doble estructural de `VpkTool`. Registra list/extract/pack en el log compartido
 * y permite inyectar:
 *   - `listResults`: paths internos que devuelve `list` por addonId.
 *   - `failListFor` / `failExtractFor`: addonId que debe lanzar VpkToolError en
 *     esa operación (para los tests de aborto).
 *   - `packResult`: ruta que devuelve `pack` (por defecto `<sourceDir>.vpk`).
 */
class FakeVpkTool {
  readonly #log: LogEvent[];
  readonly #listResults: Map<string, string[]>;
  #failListFor: string | null = null;
  #failExtractFor: string | null = null;

  constructor(log: LogEvent[], listResults: Map<string, string[]>) {
    this.#log = log;
    this.#listResults = listResults;
  }

  failListFor(addonId: string): this {
    this.#failListFor = addonId;
    return this;
  }

  failExtractFor(addonId: string): this {
    this.#failExtractFor = addonId;
    return this;
  }

  list(_vpkPath: string, addonId: string): Promise<string[]> {
    this.#log.push({ op: "list", addonId });
    if (this.#failListFor === addonId) {
      return Promise.reject(
        new VpkToolError({ addonId, operation: "list", exitCode: -1, stderr: "list boom" }),
      );
    }
    return Promise.resolve(this.#listResults.get(addonId) ?? []);
  }

  extract(
    _vpkPath: string,
    _internalPaths: readonly string[],
    _destDir: string,
    addonId: string,
  ): Promise<void> {
    this.#log.push({ op: "extract", addonId });
    if (this.#failExtractFor === addonId) {
      return Promise.reject(
        new VpkToolError({ addonId, operation: "extract", exitCode: 3, stderr: "extract boom" }),
      );
    }
    return Promise.resolve();
  }

  pack(sourceDir: string, _addonId: string): Promise<string> {
    this.#log.push({ op: "pack", dir: sourceDir });
    return Promise.resolve(`${sourceDir}.vpk`);
  }
}

/** Doble de `MergeFileSystem`: registra cada dir asegurado en el log. */
class FakeMergeFs implements MergeFileSystem {
  readonly #log: LogEvent[];

  constructor(log: LogEvent[]) {
    this.#log = log;
  }

  ensureDir(dir: string): Promise<void> {
    this.#log.push({ op: "ensureDir", dir });
    return Promise.resolve();
  }
}

/**
 * Doble estructural de `CollisionResolver`: registra `mergeInto(destDir, roots)`
 * (guardando una copia inmutable de roots en el orden recibido) y devuelve un
 * MergeReport vacío. Expone `lastRoots` para aserar el orden pasado a la fusión.
 */
class FakeCollisionResolver {
  readonly #log: LogEvent[];
  lastRoots: ExtractedRoot[] | null = null;
  /**
   * MergeReport que devolverá `mergeInto`. Por defecto vacío (`{ collisions: [] }`)
   * para los tests que no lo inspeccionan; se puede inyectar uno con colisiones
   * REALES vía `setReport` para verificar que ese report llega INTACTO al retorno
   * de `merge` (que hoy YA no lo descarta; ver DECISIÓN 6 de merge-engine.ts).
   */
  #report: MergeReport = { collisions: [] };

  constructor(log: LogEvent[]) {
    this.#log = log;
  }

  setReport(report: MergeReport): this {
    this.#report = report;
    return this;
  }

  mergeInto(destDir: string, extractedRoots: readonly ExtractedRoot[]): Promise<MergeReport> {
    this.#log.push({ op: "mergeInto", destDir });
    this.lastRoots = [...extractedRoots];
    return Promise.resolve(this.#report);
  }
}

// ---------------------------------------------------------------------------
// Helpers de construcción de fixtures
// ---------------------------------------------------------------------------

/** Addon mínimo válido para MergeEngine (solo usa `id` y `vpkPath`). */
function addon(id: string): ScannedAddon {
  return {
    id,
    vpkPath: `C:\\ws\\${id}.vpk`,
    coverPath: null,
    info: null,
  };
}

/**
 * `GamePaths` stub: MergeEngine NO lo consume hoy (el parámetro es `_paths`), así
 * que un objeto con las 7 rutas en strings dummy alcanza y no fuerza valores reales.
 */
const PATHS_STUB: GamePaths = {
  steamPath: "C:\\Steam",
  gameRoot: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2",
  left4dead2Dir: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2",
  workshopFolder: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\addons\\workshop",
  vpkToolPath: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\bin\\vpk.exe",
  gameInfoFile: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\gameinfo.txt",
  modsvsFolder: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\modsvs",
};

const WORK_DIR = "C:\\work";
const EXTRACT_BASE = `${WORK_DIR}\\extract`;
const PAK01_DIR = `${WORK_DIR}\\pak01_dir`;

/** Arma MergeEngine + dobles compartiendo un mismo log; devuelve todo para aserar. */
function makeEngine(listResults: Map<string, string[]>): {
  engine: MergeEngine;
  log: LogEvent[];
  vpk: FakeVpkTool;
  resolver: FakeCollisionResolver;
} {
  const log: LogEvent[] = [];
  const vpk = new FakeVpkTool(log, listResults);
  const fs = new FakeMergeFs(log);
  const resolver = new FakeCollisionResolver(log);
  const engine = new MergeEngine(
    vpk as unknown as VpkTool,
    fs,
    resolver as unknown as CollisionResolver,
  );
  return { engine, log, vpk, resolver };
}

// ---------------------------------------------------------------------------
// Caso 1: orden del flujo end-to-end (camino feliz)
// ---------------------------------------------------------------------------

describe("MergeEngine.merge: orden del flujo end-to-end (AC 6.3, 6.7, 6.8)", () => {
  test("por addon: list → ensureDir(s) → extract; luego mergeInto UNA vez; luego pack", async () => {
    const addons = [addon("100"), addon("200"), addon("300")];
    const listResults = new Map<string, string[]>([
      ["100", ["materials/a.vmt"]],
      ["200", ["models/b.mdl"]],
      ["300", ["sound/c.wav"]],
    ]);
    const { engine, log, resolver } = makeEngine(listResults);

    // MergeReport con colisiones REALES: debe llegar INTACTO al retorno de merge
    // (verifica que `report` no se descarta; ver DECISIÓN 6 de merge-engine.ts).
    const reportConColisiones: MergeReport = {
      collisions: [
        {
          relativePath: "materials/shared.vmt",
          contributors: ["100", "200"],
          winner: "200",
        },
        {
          relativePath: "models/shared.mdl",
          contributors: ["200", "300"],
          winner: "300",
        },
      ],
    };
    resolver.setReport(reportConColisiones);

    const out = await engine.merge(addons, PATHS_STUB, WORK_DIR);

    // La secuencia por addon respeta el orden ascendente: list/extract del addon
    // N ocurren antes que los del addon N+1.
    const listIdx = indicesOf(log, "list");
    const extractIdx = indicesOf(log, "extract");
    expect(log.filter((e) => e.op === "list").map((e) => e.addonId)).toEqual(["100", "200", "300"]);
    expect(log.filter((e) => e.op === "extract").map((e) => e.addonId)).toEqual([
      "100",
      "200",
      "300",
    ]);
    // list del addon i antes que extract del addon i, y todo el bloque de un
    // addon antes del list del siguiente.
    expect(listIdx[0]).toBeLessThan(extractIdx[0]!);
    expect(extractIdx[0]!).toBeLessThan(listIdx[1]!);
    expect(extractIdx[1]!).toBeLessThan(listIdx[2]!);

    // mergeInto ocurre DESPUÉS de todas las extracciones y ANTES del pack, y UNA sola vez.
    expect(indicesOf(log, "mergeInto")).toHaveLength(1);
    const mergeIdx = firstIndexOf(log, "mergeInto");
    const packIdx = firstIndexOf(log, "pack");
    expect(extractIdx[extractIdx.length - 1]!).toBeLessThan(mergeIdx);
    expect(mergeIdx).toBeLessThan(packIdx);

    // Los extractedRoots llegan a mergeInto en el MISMO orden ascendente.
    expect(resolver.lastRoots).toEqual([
      { addonId: "100", rootDir: `${EXTRACT_BASE}\\100` },
      { addonId: "200", rootDir: `${EXTRACT_BASE}\\200` },
      { addonId: "300", rootDir: `${EXTRACT_BASE}\\300` },
    ]);
    // mergeInto se llamó sobre el pak01_dir correcto.
    expect(log.find((e) => e.op === "mergeInto")?.destDir).toBe(PAK01_DIR);

    // merge devuelve la ruta del pak01_dir.vpk en `vpkPath`.
    expect(out.vpkPath).toBe(`${PAK01_DIR}.vpk`);

    // Y el MergeReport de mergeInto llega INTACTO en `report` (no se descarta):
    // misma estructura, con las colisiones reales inyectadas (ver DECISIÓN 6).
    expect(out.report).toEqual(reportConColisiones);
  });
});

// ---------------------------------------------------------------------------
// Caso 2: creación de subdirectorios ANTES de extraer (AC 6.3)
// ---------------------------------------------------------------------------

describe("MergeEngine.merge: subdirectorios creados antes de extraer (AC 6.3)", () => {
  test("ensureDir del destDir base y de los subdirs derivados, todos antes de extract", async () => {
    const addons = [addon("100")];
    // Paths con subdirectorios (materials/models, scripts/vscripts) y uno en la raíz.
    const listResults = new Map<string, string[]>([
      ["100", ["materials/models/a.vtf", "scripts/vscripts/x.nut", "root.txt"]],
    ]);
    const { engine, log } = makeEngine(listResults);

    await engine.merge(addons, PATHS_STUB, WORK_DIR);

    const destBase = `${EXTRACT_BASE}\\100`;
    const ensuredDirs = log.filter((e) => e.op === "ensureDir").map((e) => e.dir);

    // Se aseguró el destDir base y los dos subdirs de destino traducidos a `\`.
    expect(ensuredDirs).toContain(destBase);
    expect(ensuredDirs).toContain(`${destBase}\\materials\\models`);
    expect(ensuredDirs).toContain(`${destBase}\\scripts\\vscripts`);

    // El path en la raíz (`root.txt`, sin `/`) NO genera un ensureDir de subdir
    // extra: solo existen el base y los dos subdirs (más el pak01_dir de la fusión).
    const extractDirEnsures = ensuredDirs.filter((d) => d!.startsWith(destBase));
    expect(extractDirEnsures).toHaveLength(3);

    // Todos los ensureDir del addon ocurren ANTES del extract de ese addon (por
    // posición en el log cronológico).
    const extractIdx = firstIndexOf(log, "extract");
    log.forEach((e, i) => {
      if (e.op === "ensureDir" && e.dir!.startsWith(destBase)) {
        expect(i).toBeLessThan(extractIdx);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Caso 3: generación del pak01_dir.vpk
// ---------------------------------------------------------------------------

describe("MergeEngine.merge: generación del pak01_dir.vpk", () => {
  test("retorna exactamente lo que devuelve pack, con el pak01_dir derivado de workDir", async () => {
    const addons = [addon("100")];
    const listResults = new Map<string, string[]>([["100", ["materials/a.vmt"]]]);
    const { engine, log } = makeEngine(listResults);

    const out = await engine.merge(addons, PATHS_STUB, WORK_DIR);

    // pack se llamó con el pak01_dir correcto y merge devuelve su `.vpk` en vpkPath.
    expect(log.find((e) => e.op === "pack")?.dir).toBe(PAK01_DIR);
    expect(out.vpkPath).toBe(`${PAK01_DIR}.vpk`);
  });
});

// ---------------------------------------------------------------------------
// Caso 4: aborto con identificación del addon ante fallo (AC 6.8, 6.12)
// ---------------------------------------------------------------------------

describe("MergeEngine.merge: aborto identificando el addon ante fallo (AC 6.8, 6.12)", () => {
  test("extract falla en el 2.º addon: propaga el error, no toca el 3.º ni fusiona/empaqueta", async () => {
    const addons = [addon("100"), addon("200"), addon("300")];
    const listResults = new Map<string, string[]>([
      ["100", ["materials/a.vmt"]],
      ["200", ["models/b.mdl"]],
      ["300", ["sound/c.wav"]],
    ]);
    const { engine, log, vpk } = makeEngine(listResults);
    vpk.failExtractFor("200");

    let thrown: unknown;
    try {
      await engine.merge(addons, PATHS_STUB, WORK_DIR);
    } catch (err) {
      thrown = err;
    }

    // Rechaza con ESE VpkToolError (mismo addonId/operation).
    expect(thrown).toBeInstanceOf(VpkToolError);
    const e = thrown as VpkToolError;
    expect(e.operation).toBe("extract");
    expect(e.addonId).toBe("200");

    // NO se procesó el 3.º addon (ni list ni extract del "300").
    expect(log.some((ev) => ev.op === "list" && ev.addonId === "300")).toBe(false);
    expect(log.some((ev) => ev.op === "extract" && ev.addonId === "300")).toBe(false);

    // NO se fusionó ni se empaquetó.
    expect(log.some((ev) => ev.op === "mergeInto")).toBe(false);
    expect(log.some((ev) => ev.op === "pack")).toBe(false);
  });

  test("list falla en el 2.º addon: aborta sin llegar a extract de ese addon ni a la fusión", async () => {
    const addons = [addon("100"), addon("200"), addon("300")];
    const listResults = new Map<string, string[]>([
      ["100", ["materials/a.vmt"]],
      ["300", ["sound/c.wav"]],
    ]);
    const { engine, log, vpk } = makeEngine(listResults);
    vpk.failListFor("200");

    let thrown: unknown;
    try {
      await engine.merge(addons, PATHS_STUB, WORK_DIR);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(VpkToolError);
    const e = thrown as VpkToolError;
    expect(e.operation).toBe("list");
    expect(e.addonId).toBe("200");

    // El list del "200" ocurrió, pero NO su extract (falló antes de extraer).
    expect(log.some((ev) => ev.op === "list" && ev.addonId === "200")).toBe(true);
    expect(log.some((ev) => ev.op === "extract" && ev.addonId === "200")).toBe(false);

    // El 3.º addon no se tocó y no hubo fusión ni empaquetado.
    expect(log.some((ev) => ev.op === "list" && ev.addonId === "300")).toBe(false);
    expect(log.some((ev) => ev.op === "mergeInto")).toBe(false);
    expect(log.some((ev) => ev.op === "pack")).toBe(false);
  });
});
