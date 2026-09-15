import { describe, expect, test } from "vitest";

import {
  AddonScanner,
  VpkTool,
  extractAddonInfo,
} from "../src/main/domain/index.js";
import type {
  AddonFileSystem,
  CommandResult,
  CommandRunner,
  DirEntry,
} from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 6.1: escaneo de la Workshop_Folder (AC 2.1–2.6).
 *
 * Se ejercita `AddonScanner` con:
 *   - un {@link AddonFileSystem} MOCKEADO en memoria (listado, existencia,
 *     lectura de texto, creación de directorios), sin tocar disco;
 *   - un {@link VpkTool} REAL construido sobre un {@link CommandRunner} mockeado
 *     (mismo patrón que `test/vpk-tool.test.ts`), para ejercer el camino real de
 *     list/extract y poder simular exit ≠ 0 (VpkToolError).
 *
 * Además se testea el extractor ad-hoc `extractAddonInfo` aislado.
 *
 * NOTA: NO son property tests (esos son 6.2/6.3, commits aparte). Son ejemplos
 * que fijan el contrato documentado en `addon-scanner.ts` / `addoninfo-extract.ts`.
 */

const VPK_EXE = "C:\\game\\bin\\vpk.exe";
const WORKSHOP = "C:\\ws";
const TEMP = "C:\\tmp\\scan";

// ---------------------------------------------------------------------------
// Mock de CommandRunner: enruta por args a list (`vpk l`) o extract (`vpk x`).
// ---------------------------------------------------------------------------

/**
 * Ejecutor de comandos mockeado. Responde a `vpk l <vpk>` con un stdout
 * configurable por VPK y a `vpk x ...` con un exit configurable, de modo que
 * podamos simular tanto listados normales como fallos de list/extract.
 */
class ScriptedRunner implements CommandRunner {
  /** stdout de `vpk l` por vpkPath (paths internos, uno por línea). */
  readonly listStdout = new Map<string, string>();
  /** exit code de `vpk l` por vpkPath (default 0). */
  readonly listExit = new Map<string, number>();
  /** exit code de `vpk x` por vpkPath (default 0). */
  readonly extractExit = new Map<string, number>();

  run(_executable: string, args: readonly string[]): Promise<CommandResult> {
    const [subcommand, vpkPath] = args;
    if (subcommand === "l") {
      const exit = this.listExit.get(vpkPath ?? "") ?? 0;
      const stdout = this.listStdout.get(vpkPath ?? "") ?? "";
      return Promise.resolve({ exitCode: exit, stdout, stderr: "" });
    }
    if (subcommand === "x") {
      const exit = this.extractExit.get(vpkPath ?? "") ?? 0;
      return Promise.resolve({ exitCode: exit, stdout: "", stderr: "" });
    }
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }
}

// ---------------------------------------------------------------------------
// Mock de AddonFileSystem en memoria.
// ---------------------------------------------------------------------------

/**
 * FS mockeado. `entries` mapea un directorio a sus entradas; `existing` es el
 * conjunto de rutas que existen; `files` mapea ruta → contenido de texto. Los
 * archivos "extraídos" del addoninfo se registran manualmente para simular lo
 * que `vpk x` habría escrito (aquí VpkTool no escribe: el runner es un mock).
 */
class MockFs implements AddonFileSystem {
  readonly entries = new Map<string, DirEntry[]>();
  readonly existing = new Set<string>();
  readonly files = new Map<string, string>();
  readonly ensuredDirs: string[] = [];
  /** Stat configurable por vpkPath (P-31, Paso 1); ausente = usa `defaultStat`. */
  readonly stats = new Map<string, { mtimeMs: number; size: number }>();
  /** Devuelto para cualquier vpkPath sin entrada en `stats`. */
  defaultStat = { mtimeMs: 0, size: 0 };
  /** vpkPaths para los que `stat` debe RECHAZAR (simula fs.stat fallando). */
  readonly statFailures = new Set<string>();

  listEntries(dir: string): Promise<DirEntry[]> {
    return Promise.resolve(this.entries.get(dir) ?? []);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.existing.has(path) || this.files.has(path));
  }

  readTextFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      return Promise.reject(new Error(`ENOENT: ${path}`));
    }
    return Promise.resolve(content);
  }

  ensureDir(dir: string): Promise<void> {
    this.ensuredDirs.push(dir);
    return Promise.resolve();
  }

  stat(path: string): Promise<{ mtimeMs: number; size: number }> {
    if (this.statFailures.has(path)) {
      return Promise.reject(new Error(`ENOENT (stat): ${path}`));
    }
    return Promise.resolve(this.stats.get(path) ?? this.defaultStat);
  }
}

const file = (name: string): DirEntry => ({ name, isDirectory: false });
const dir = (name: string): DirEntry => ({ name, isDirectory: true });

const buildScanner = (fs: MockFs, runner: ScriptedRunner): AddonScanner =>
  new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);

// ---------------------------------------------------------------------------
// AC 2.1 / 2.2: solo `.vpk` de nivel superior; ignora otras extensiones y subdirs.
// ---------------------------------------------------------------------------

describe("AddonScanner: incluye solo `.vpk` de nivel superior (AC 2.1, 2.2)", () => {
  test("ignora otras extensiones y subdirectorios; incluye solo los .vpk", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [
      file("111.vpk"),
      file("222.vpk"),
      file("111.jpg"),
      file("readme.txt"),
      file("notes.md"),
      dir("222"), // subdirectorio residual: debe ignorarse
      dir("materials"),
    ]);
    const runner = new ScriptedRunner(); // list devuelve vacío → info null
    const scanner = buildScanner(fs, runner);

    const result = await scanner.scan(WORKSHOP);

    expect(result.map((a) => a.id).sort()).toEqual(["111", "222"]);
  });
});

// ---------------------------------------------------------------------------
// AC 2.3: `<id>.vpk` → addon con id `<id>` y vpkPath correcto.
// ---------------------------------------------------------------------------

describe("AddonScanner: id y vpkPath (AC 2.3)", () => {
  test("`<id>.vpk` produce id=<id> y vpkPath en la workshop folder", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("3776576407.vpk")]);
    const scanner = buildScanner(fs, new ScriptedRunner());

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.id).toBe("3776576407");
    expect(addon?.vpkPath).toBe("C:\\ws\\3776576407.vpk");
  });
});

// ---------------------------------------------------------------------------
// AC 2.4: cover = ruta de `<id>.jpg` si existe; null si no.
// ---------------------------------------------------------------------------

describe("AddonScanner: asociación de Addon_Cover (AC 2.4)", () => {
  test("coverPath = ruta del <id>.jpg cuando existe junto al vpk", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("100.vpk")]);
    fs.existing.add("C:\\ws\\100.jpg");
    const scanner = buildScanner(fs, new ScriptedRunner());

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.coverPath).toBe("C:\\ws\\100.jpg");
  });

  test("coverPath = null cuando no hay <id>.jpg", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("200.vpk")]);
    const scanner = buildScanner(fs, new ScriptedRunner());

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.coverPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P-31, Paso 1: mtimeMs/sizeBytes del .vpk (datos de ordenamiento para Biblioteca).
// ---------------------------------------------------------------------------

describe("AddonScanner: mtimeMs/sizeBytes del .vpk (P-31, Paso 1)", () => {
  test("popula mtimeMs/sizeBytes desde fs.stat del .vpk", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("700.vpk")]);
    fs.stats.set("C:\\ws\\700.vpk", { mtimeMs: 1_700_000_000_000, size: 123_456 });
    const scanner = buildScanner(fs, new ScriptedRunner());

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.mtimeMs).toBe(1_700_000_000_000);
    expect(addon?.sizeBytes).toBe(123_456);
  });

  test("si fs.stat falla, degrada a 0/0 sin abortar ni omitir el addon (mismo criterio best-effort que addoninfo, AC 2.5)", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("701.vpk")]);
    fs.statFailures.add("C:\\ws\\701.vpk");
    const scanner = buildScanner(fs, new ScriptedRunner());

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.id).toBe("701");
    expect(addon?.mtimeMs).toBe(0);
    expect(addon?.sizeBytes).toBe(0);
  });

  test("un fallo de stat en un addon no impide escanear a los demás, cada uno con su propio stat", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("702.vpk"), file("703.vpk")]);
    fs.statFailures.add("C:\\ws\\702.vpk");
    fs.stats.set("C:\\ws\\703.vpk", { mtimeMs: 42, size: 99 });
    const scanner = buildScanner(fs, new ScriptedRunner());

    const result = await scanner.scan(WORKSHOP);

    expect(result.find((a) => a.id === "702")).toMatchObject({ mtimeMs: 0, sizeBytes: 0 });
    expect(result.find((a) => a.id === "703")).toMatchObject({ mtimeMs: 42, sizeBytes: 99 });
  });
});

// ---------------------------------------------------------------------------
// AC 2.5: metadata opcional; su fallo NO bloquea ni omite el addon.
// ---------------------------------------------------------------------------

describe("AddonScanner: lectura de addoninfo no bloquea el escaneo (AC 2.5)", () => {
  const ADDONINFO_TEXT = [
    '"AddonInfo"',
    "{",
    '    addontitle       "Mi Mod"      //Max 127 chars.',
    '    addonauthor      "Fulano"',
    '    addonDescription "Una descripción"',
    "}",
  ].join("\n");

  test("(a) addoninfo presente y bien formado → info poblado con los 3 campos", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("500.vpk")]);
    const runner = new ScriptedRunner();
    runner.listStdout.set("C:\\ws\\500.vpk", "addoninfo.txt\nmaterials/a.vmt");
    // El archivo que `vpk x` habría escrito bajo destDir/<id>.
    fs.files.set("C:\\tmp\\scan\\500\\addoninfo.txt", ADDONINFO_TEXT);
    const scanner = buildScanner(fs, runner);

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.info).toEqual({
      title: "Mi Mod",
      author: "Fulano",
      description: "Una descripción",
    });
  });

  test("(b) addoninfo con campos parciales → solo esos campos presentes", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("501.vpk")]);
    const runner = new ScriptedRunner();
    runner.listStdout.set("C:\\ws\\501.vpk", "addoninfo.txt");
    fs.files.set(
      "C:\\tmp\\scan\\501\\addoninfo.txt",
      '"AddonInfo"\n{\n  addontitle "Solo Titulo"\n}',
    );
    const scanner = buildScanner(fs, runner);

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.info).toEqual({ title: "Solo Titulo" });
    expect(addon?.info && "author" in addon.info).toBe(false);
    expect(addon?.info && "description" in addon.info).toBe(false);
  });

  test("(c) addoninfo ausente del listado del VPK → info null, addon igual listado", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("502.vpk")]);
    const runner = new ScriptedRunner();
    runner.listStdout.set("C:\\ws\\502.vpk", "materials/a.vmt\nmodels/b.mdl");
    const scanner = buildScanner(fs, runner);

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.id).toBe("502");
    expect(addon?.info).toBeNull();
  });

  test("(d1) `vpk l` falla (VpkToolError) → info null, addon IGUAL listado", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("503.vpk")]);
    const runner = new ScriptedRunner();
    runner.listExit.set("C:\\ws\\503.vpk", -1); // list falla
    const scanner = buildScanner(fs, runner);

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.id).toBe("503");
    expect(addon?.info).toBeNull();
  });

  test("(d2) `vpk x` falla (VpkToolError) → info null, addon IGUAL listado", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("504.vpk")]);
    const runner = new ScriptedRunner();
    runner.listStdout.set("C:\\ws\\504.vpk", "addoninfo.txt");
    runner.extractExit.set("C:\\ws\\504.vpk", 5); // extract falla
    const scanner = buildScanner(fs, runner);

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.id).toBe("504");
    expect(addon?.info).toBeNull();
  });

  test("(e) addoninfo con texto malformado → info null sin lanzar", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("505.vpk")]);
    const runner = new ScriptedRunner();
    runner.listStdout.set("C:\\ws\\505.vpk", "addoninfo.txt");
    fs.files.set("C:\\tmp\\scan\\505\\addoninfo.txt", ">>> basura sin claves <<<\n{{{{");
    const scanner = buildScanner(fs, runner);

    const [addon] = await scanner.scan(WORKSHOP);

    expect(addon?.id).toBe("505");
    expect(addon?.info).toBeNull();
  });

  test("un fallo de metadata en un addon no impide escanear a los demás", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("600.vpk"), file("601.vpk")]);
    const runner = new ScriptedRunner();
    runner.listExit.set("C:\\ws\\600.vpk", -1); // 600 falla su metadata
    runner.listStdout.set("C:\\ws\\601.vpk", "addoninfo.txt");
    fs.files.set("C:\\tmp\\scan\\601\\addoninfo.txt", '"AddonInfo"\n{\n addonauthor "X"\n}');
    const scanner = buildScanner(fs, runner);

    const result = await scanner.scan(WORKSHOP);

    expect(result.map((a) => a.id)).toEqual(["600", "601"]);
    expect(result[0]?.info).toBeNull();
    expect(result[1]?.info).toEqual({ author: "X" });
  });
});

// ---------------------------------------------------------------------------
// Tests directos del EXTRACTOR ad-hoc.
// ---------------------------------------------------------------------------

describe("extractAddonInfo: extractor ad-hoc de addoninfo.txt", () => {
  test("bloque bien formado con casing variado, comillas y comentarios `//`", () => {
    const text = [
      '"AddonInfo"',
      "{",
      '    addonTitle       "Mod Con Comillas"   //Max 127 chars.',
      "    addonauthor      AutorSinComillas",
      '    addonDESCRIPTION "Desc // con slashes internos"',
      "    addonversion     1.0   // no usado",
      "}",
    ].join("\n");

    expect(extractAddonInfo(text)).toEqual({
      title: "Mod Con Comillas",
      author: "AutorSinComillas",
      description: "Desc // con slashes internos",
    });
  });

  test("valores sin comillas: token hasta fin de línea, recortado", () => {
    const text = 'addontitle    MiModSinComillas   \naddonauthor Yo';
    expect(extractAddonInfo(text)).toEqual({
      title: "MiModSinComillas",
      author: "Yo",
    });
  });

  test("campos parciales → solo esos campos, resto ausente", () => {
    const info = extractAddonInfo('addontitle "Solo Titulo"');
    expect(info).toEqual({ title: "Solo Titulo" });
    expect(info && "author" in info).toBe(false);
    expect(info && "description" in info).toBe(false);
  });

  test("bloque AddonInfo ausente (ningún campo conocido) → null", () => {
    expect(extractAddonInfo("clave_desconocida valor\notra cosa")).toBeNull();
  });

  test("texto claramente malformado → null sin lanzar", () => {
    expect(extractAddonInfo(">>>>>> {{{{ ]]]] basura")).toBeNull();
  });

  test("cadena vacía → null", () => {
    expect(extractAddonInfo("")).toBeNull();
  });

  test("comentario que precede al valor no rompe la clave conocida", () => {
    // Línea de comentario puro se ignora; la de campo se reconoce.
    const text = "//comentario\naddonauthor \"Autor\"";
    expect(extractAddonInfo(text)).toEqual({ author: "Autor" });
  });
});

// ---------------------------------------------------------------------------
// Rediseño Paso 8/8 (README 2e): progreso de escaneo para el checklist de
// "Primer arranque" ("Leyendo tus addons suscritos: N de M").
// ---------------------------------------------------------------------------

describe("AddonScanner: progreso de scan (rediseño Paso 8/8)", () => {
  test("sin onProgress: se comporta idéntico a antes (no rompe nada)", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("1.vpk"), file("2.vpk")]);
    const scanner = buildScanner(fs, new ScriptedRunner());

    const result = await scanner.scan(WORKSHOP);

    expect(result.map((a) => a.id).sort()).toEqual(["1", "2"]);
  });

  test("con onProgress: se llama una vez por addon, done llega a total y total es fijo", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, [file("1.vpk"), file("2.vpk"), file("3.vpk")]);
    const calls: { done: number; total: number }[] = [];
    const scanner = new AddonScanner(fs, new VpkTool(new ScriptedRunner(), VPK_EXE), TEMP, (event) =>
      calls.push(event),
    );

    await scanner.scan(WORKSHOP);

    expect(calls).toHaveLength(3);
    expect(calls.every((event) => event.total === 3)).toBe(true);
    // El orden de FINALIZACIÓN de un pool acotado no está garantizado, pero la
    // secuencia de `done` sí: cada llamada suma exactamente 1 sobre la anterior.
    expect(calls.map((event) => event.done)).toEqual([1, 2, 3]);
  });

  test("workshop vacía: onProgress nunca se llama (nada que escanear)", async () => {
    const fs = new MockFs();
    fs.entries.set(WORKSHOP, []);
    const calls: { done: number; total: number }[] = [];
    const scanner = new AddonScanner(fs, new VpkTool(new ScriptedRunner(), VPK_EXE), TEMP, (event) =>
      calls.push(event),
    );

    const result = await scanner.scan(WORKSHOP);

    expect(result).toEqual([]);
    expect(calls).toEqual([]);
  });
});
