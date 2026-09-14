import { describe, expect, test } from "vitest";

import {
  AddonScanner,
  DEFAULT_VPK_CONCURRENCY,
  VpkTool,
} from "../src/main/domain/index.js";
import type {
  AddonFileSystem,
  CommandResult,
  CommandRunner,
  DirEntry,
} from "../src/main/domain/index.js";

/**
 * BUG-006 — Unit tests concretos del escaneo PARALELIZADO (Tarea 4 del plan).
 *
 * Verifican el CONTRATO de correctitud que el fix debe preservar sobre casos
 * puntuales y deterministas (complementan las properties de la Tarea 5):
 *   - Orden preservado con `addoninfo` que falla en el MEDIO de la lista
 *     (escritura por índice, no por orden de finalización).
 *   - Addon sin cover ⇒ `coverPath === null`, addon igualmente listado.
 *   - Subdirectorios y archivos no-`.vpk` ignorados (solo `.vpk` de nivel
 *     superior en el resultado).
 *   - Lista vacía ⇒ `[]` (poolSize = min(DEFAULT_VPK_CONCURRENCY, 0) = 0, sin
 *     workers).
 *   - Cota de concurrencia: `maxInFlight <= DEFAULT_VPK_CONCURRENCY`.
 *   - `id` derivado del nombre y `vpkPath` con separador de Windows, idénticos
 *     al serial.
 *
 * Los fakes son deterministas y en memoria (sin `vpk.exe` real).
 */

const VPK_EXE = "C:\\game\\bin\\vpk.exe";
const WORKSHOP = "C:\\ws";
const TEMP = "C:\\tmp\\scan";
const COVER_EXTENSION = ".jpg";

/** Une dir + nombre con separador Windows (mismo criterio que el scanner). */
const joinWin = (dir: string, name: string): string =>
  `${dir.replace(/[\\/]+$/, "")}\\${name}`;

/** Texto de `addoninfo.txt` bien formado con un título dado. */
const addoninfoText = (title: string): string =>
  ['"AddonInfo"', "{", `    addontitle "${title}"`, "}"].join("\n");

/** Cede al event loop una vez (permite solapamiento del pool si lo hubiera). */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * FS en memoria: `entries` mapea dir → entradas; `covers` es el conjunto de
 * rutas `<id>.jpg` existentes; `files` mapea la ruta del `addoninfo.txt`
 * extraído (bajo `TEMP/<id>`) a su contenido.
 */
class MockFs implements AddonFileSystem {
  readonly entries = new Map<string, DirEntry[]>();
  readonly covers = new Set<string>();
  readonly files = new Map<string, string>();

  listEntries(dir: string): Promise<DirEntry[]> {
    return Promise.resolve(this.entries.get(dir) ?? []);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.covers.has(path) || this.files.has(path));
  }

  readTextFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      return Promise.reject(new Error(`ENOENT: ${path}`));
    }
    return Promise.resolve(content);
  }

  ensureDir(_dir: string): Promise<void> {
    return Promise.resolve();
  }

  // mtimeMs/sizeBytes (P-31, Paso 1) no son relevantes para este test de
  // concurrencia; valor fijo, no exercised.
  stat(_path: string): Promise<{ mtimeMs: number; size: number }> {
    return Promise.resolve({ mtimeMs: 0, size: 0 });
  }
}

/**
 * Runner determinista dirigido por vpkPath, que además MIDE la concurrencia
 * (`maxInFlight`): enruta `vpk l`/`vpk x` según planes por VPK y cede al event
 * loop antes de resolver para permitir el solapamiento real del pool.
 */
class InstrumentedScriptedRunner implements CommandRunner {
  /** stdout de `vpk l` por vpkPath (paths internos; default ""). */
  readonly listStdout = new Map<string, string>();
  /** exit code de `vpk l` por vpkPath (default 0). */
  readonly listExit = new Map<string, number>();
  /** exit code de `vpk x` por vpkPath (default 0). */
  readonly extractExit = new Map<string, number>();

  #inFlight = 0;
  maxInFlight = 0;

  async run(
    _executable: string,
    args: readonly string[],
  ): Promise<CommandResult> {
    const [subcommand, vpkPath] = args;
    const key = vpkPath ?? "";

    this.#inFlight += 1;
    if (this.#inFlight > this.maxInFlight) {
      this.maxInFlight = this.#inFlight;
    }
    try {
      await yieldToEventLoop();
      if (subcommand === "l") {
        return {
          exitCode: this.listExit.get(key) ?? 0,
          stdout: this.listStdout.get(key) ?? "",
          stderr: "",
        };
      }
      if (subcommand === "x") {
        return { exitCode: this.extractExit.get(key) ?? 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    } finally {
      this.#inFlight -= 1;
    }
  }
}

/** Marca un addon como "listable con addoninfo válido" (list + extract OK). */
const withValidAddoninfo = (
  fs: MockFs,
  runner: InstrumentedScriptedRunner,
  id: string,
  vpkPath: string,
  title: string,
): void => {
  runner.listStdout.set(vpkPath, "addoninfo.txt");
  fs.files.set(joinWin(TEMP, `${id}\\addoninfo.txt`), addoninfoText(title));
};

describe("BUG-006: escaneo paralelizado — unit tests concretos", () => {
  test("preserva el orden aunque el addoninfo del MEDIO falle (info null en su posición)", async () => {
    const fs = new MockFs();
    const runner = new InstrumentedScriptedRunner();

    // 5 addons; el del medio (index 2) falla su `vpk l` → info null.
    const ids = ["a0", "a1", "a2", "a3", "a4"];
    fs.entries.set(
      WORKSHOP,
      ids.map((id) => ({ name: `${id}.vpk`, isDirectory: false })),
    );
    for (const id of ids) {
      const vpkPath = joinWin(WORKSHOP, `${id}.vpk`);
      if (id === "a2") {
        // `vpk l` con exit ≠ 0 ⇒ VpkToolError ⇒ info null (best-effort).
        runner.listExit.set(vpkPath, -1);
      } else {
        withValidAddoninfo(fs, runner, id, vpkPath, `Mod ${id}`);
      }
    }

    const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);
    const result = await scanner.scan(WORKSHOP);

    // Orden idéntico al listado (escritura por índice, no por finalización).
    expect(result.map((a) => a.id)).toEqual(ids);
    // El del medio quedó con info null; los demás con metadata poblada.
    expect(result[2]?.info).toBeNull();
    expect(result[0]?.info).not.toBeNull();
    expect(result[4]?.info).not.toBeNull();
    // El addon fallido NO se omitió: sigue presente con su id/vpkPath.
    expect(result[2]?.id).toBe("a2");
    expect(result[2]?.vpkPath).toBe(joinWin(WORKSHOP, "a2.vpk"));
  });

  test("addon sin cover ⇒ coverPath null, pero igual se lista", async () => {
    const fs = new MockFs();
    const runner = new InstrumentedScriptedRunner();
    fs.entries.set(WORKSHOP, [
      { name: "conCover.vpk", isDirectory: false },
      { name: "sinCover.vpk", isDirectory: false },
    ]);
    fs.covers.add(joinWin(WORKSHOP, `conCover${COVER_EXTENSION}`));
    // "absent": el `vpk l` no lista addoninfo ⇒ info null, sin extraer.
    runner.listStdout.set(joinWin(WORKSHOP, "conCover.vpk"), "materials/a.vmt");
    runner.listStdout.set(joinWin(WORKSHOP, "sinCover.vpk"), "materials/b.vmt");

    const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);
    const result = await scanner.scan(WORKSHOP);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe("conCover");
    expect(result[0]?.coverPath).toBe(joinWin(WORKSHOP, `conCover${COVER_EXTENSION}`));
    expect(result[1]?.id).toBe("sinCover");
    expect(result[1]?.coverPath).toBeNull();
  });

  test("ignora subdirectorios y archivos no-.vpk (solo .vpk de nivel superior)", async () => {
    const fs = new MockFs();
    const runner = new InstrumentedScriptedRunner();
    fs.entries.set(WORKSHOP, [
      { name: "real.vpk", isDirectory: false },
      { name: "otro.vpk", isDirectory: false },
      { name: "readme.txt", isDirectory: false },
      { name: "cover.jpg", isDirectory: false },
      { name: "subcarpeta", isDirectory: true },
      // Un directorio cuyo nombre TERMINA en .vpk igual debe ignorarse.
      { name: "trampa.vpk", isDirectory: true },
    ]);
    runner.listStdout.set(joinWin(WORKSHOP, "real.vpk"), "materials/x.vmt");
    runner.listStdout.set(joinWin(WORKSHOP, "otro.vpk"), "materials/y.vmt");

    const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);
    const result = await scanner.scan(WORKSHOP);

    expect(result.map((a) => a.id)).toEqual(["real", "otro"]);
  });

  test("lista vacía ⇒ [] (poolSize 0, no lanza workers)", async () => {
    const fs = new MockFs();
    const runner = new InstrumentedScriptedRunner();
    fs.entries.set(WORKSHOP, []);

    const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);
    const result = await scanner.scan(WORKSHOP);

    expect(result).toEqual([]);
    // Ninguna invocación vpk.exe ⇒ no hubo trabajo en vuelo.
    expect(runner.maxInFlight).toBe(0);
  });

  test("cota de concurrencia: maxInFlight <= DEFAULT_VPK_CONCURRENCY con muchos addons", async () => {
    const fs = new MockFs();
    const runner = new InstrumentedScriptedRunner();
    const count = DEFAULT_VPK_CONCURRENCY * 3; // muchos más que el pool
    const ids: string[] = [];
    const entries: DirEntry[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = `addon${i}`;
      ids.push(id);
      entries.push({ name: `${id}.vpk`, isDirectory: false });
      withValidAddoninfo(fs, runner, id, joinWin(WORKSHOP, `${id}.vpk`), `T${i}`);
    }
    fs.entries.set(WORKSHOP, entries);

    const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);
    const result = await scanner.scan(WORKSHOP);

    expect(result.map((a) => a.id)).toEqual(ids);
    expect(runner.maxInFlight).toBeLessThanOrEqual(DEFAULT_VPK_CONCURRENCY);
    // Con más addons que el pool, el solapamiento efectivamente ocurre.
    expect(runner.maxInFlight).toBeGreaterThan(1);
  });

  test("id derivado del nombre y vpkPath con separador Windows", async () => {
    const fs = new MockFs();
    const runner = new InstrumentedScriptedRunner();
    fs.entries.set(WORKSHOP, [
      { name: "12345.vpk", isDirectory: false },
      // casing arbitrario de la extensión (match case-insensitive).
      { name: "Mapa.VPK", isDirectory: false },
    ]);
    runner.listStdout.set(joinWin(WORKSHOP, "12345.vpk"), "materials/a.vmt");
    runner.listStdout.set(joinWin(WORKSHOP, "Mapa.VPK"), "materials/b.vmt");

    const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);
    const result = await scanner.scan(WORKSHOP);

    expect(result[0]?.id).toBe("12345");
    expect(result[0]?.vpkPath).toBe(joinWin(WORKSHOP, "12345.vpk"));
    expect(result[1]?.id).toBe("Mapa");
    expect(result[1]?.vpkPath).toBe(joinWin(WORKSHOP, "Mapa.VPK"));
  });
});
