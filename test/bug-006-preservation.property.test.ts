import { expect } from "vitest";
import fc from "fast-check";

import {
  AddonScanner,
  DEFAULT_VPK_CONCURRENCY,
  VpkTool,
  extractAddonInfo,
} from "../src/main/domain/index.js";
import type {
  AddonFileSystem,
  AddonInfo,
  CommandResult,
  CommandRunner,
  DirEntry,
  ScannedAddon,
} from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * BUG-006 — Property tests de PRESERVACIÓN (Tarea 2 del plan).
 *
 * Metodología *observación primero*: el código actual de `AddonScanner.scan` ES
 * serial, así que su resultado ES la **referencia serial**. Estas properties
 * describen el CONTRATO de correctitud a preservar (Property 2 del diseño) y
 * PASAN sobre el código SIN arreglar. Tras el fix (que paraleliza pero preserva
 * lista/orden/metadata), las MISMAS properties deben seguir pasando (Tarea 3.3).
 *
 * El valor ESPERADO se computa desde un **MODELO INDEPENDIENTE determinista**
 * (recorrido en orden de las entradas aplicando las reglas del contrato), NO
 * desde `AddonScanner`. Si el escáner y el modelo coinciden para toda Workshop
 * generada, la preservación se sostiene.
 *
 * ---------------------------------------------------------------------------
 * FAKES DETERMINISTAS
 *
 * - {@link MockFs}: FS en memoria. `entries` mapea dir → entradas de nivel
 *   superior; `covers` es el conjunto de rutas `<id>.jpg` que existen; `files`
 *   mapea la ruta del `addoninfo.txt` extraído (bajo `TEMP/<id>`) a su contenido.
 * - {@link ScriptedRunner}: enruta `vpk l`/`vpk x` de forma determinista según
 *   un "plan de addoninfo" por VPK: puede LISTAR el addoninfo o no, y puede
 *   FALLAR el `vpk l` o el `vpk x` (exit ≠ 0 ⇒ VpkToolError ⇒ info null).
 *
 * El MODELO reconstruye el mismo comportamiento sin llamar al escáner.
 * ---------------------------------------------------------------------------
 */

const VPK_EXE = "C:\\game\\bin\\vpk.exe";
const TEMP = "C:\\tmp\\scan";
const COVER_EXTENSION = ".jpg";

/** Une dir + nombre con separador Windows, recortando separadores finales. */
const joinWin = (dir: string, name: string): string =>
  `${dir.replace(/[\\/]+$/, "")}\\${name}`;

// ---------------------------------------------------------------------------
// Plan de metadata por addon: describe QUÉ hace la fase de addoninfo para un VPK.
// ---------------------------------------------------------------------------

/**
 * Comportamiento determinista de la fase de metadata de un addon:
 *   - "ok"          → `vpk l` lista `addoninfo.txt` y `vpk x` lo extrae; el
 *                     archivo tiene texto válido ⇒ `info` poblado.
 *   - "malformed"   → igual que "ok" pero el texto es basura ⇒ `info` null.
 *   - "absent"      → `vpk l` NO lista addoninfo ⇒ `info` null (sin extraer).
 *   - "list-fails"  → `vpk l` devuelve exit ≠ 0 ⇒ VpkToolError ⇒ `info` null.
 *   - "extract-fails" → `vpk l` lista addoninfo pero `vpk x` falla ⇒ `info` null.
 */
type MetaPlan =
  | { kind: "ok"; title: string }
  | { kind: "malformed" }
  | { kind: "absent" }
  | { kind: "list-fails" }
  | { kind: "extract-fails" };

/** Texto válido de addoninfo con un título dado (el modelo usa el mismo parser). */
const addoninfoText = (title: string): string =>
  ['"AddonInfo"', "{", `    addontitle "${title}"`, "}"].join("\n");

const MALFORMED_TEXT = ">>> basura sin claves conocidas <<<\n{{{{";

// ---------------------------------------------------------------------------
// Fakes.
// ---------------------------------------------------------------------------

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
}

/**
 * Ejecutor de comandos determinista dirigido por un plan de metadata por VPK.
 * Enruta según el subcomando (`l`/`x`) y el vpkPath.
 */
class ScriptedRunner implements CommandRunner {
  /** exit code de `vpk l` por vpkPath (default 0). */
  readonly listExit = new Map<string, number>();
  /** stdout de `vpk l` por vpkPath (paths internos; default ""). */
  readonly listStdout = new Map<string, string>();
  /** exit code de `vpk x` por vpkPath (default 0). */
  readonly extractExit = new Map<string, number>();

  run(_executable: string, args: readonly string[]): Promise<CommandResult> {
    const [subcommand, vpkPath] = args;
    const key = vpkPath ?? "";
    if (subcommand === "l") {
      return Promise.resolve({
        exitCode: this.listExit.get(key) ?? 0,
        stdout: this.listStdout.get(key) ?? "",
        stderr: "",
      });
    }
    if (subcommand === "x") {
      return Promise.resolve({
        exitCode: this.extractExit.get(key) ?? 0,
        stdout: "",
        stderr: "",
      });
    }
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }
}

// ---------------------------------------------------------------------------
// Especificación de una entrada de la Workshop (para generar y para el modelo).
// ---------------------------------------------------------------------------

/**
 * Una entrada de nivel superior a poblar. `kind` distingue las categorías que el
 * contrato debe filtrar/incluir:
 *   - "vpk"      → archivo `.vpk` (casing arbitrario) → ADDON; tiene cover y plan.
 *   - "non-vpk"  → archivo con otra extensión → IGNORADO.
 *   - "dir"      → subdirectorio (aunque el nombre parezca `.vpk`) → IGNORADO.
 */
type EntrySpec =
  | { kind: "vpk"; baseName: string; casing: string; hasCover: boolean; meta: MetaPlan }
  | { kind: "non-vpk"; name: string }
  | { kind: "dir"; name: string };

/** Variantes de casing de la extensión `.vpk` (ejercita el match case-insensitive). */
const vpkCasing: fc.Arbitrary<string> = fc.constantFrom(
  ".vpk",
  ".VPK",
  ".Vpk",
  ".vPk",
);

/** Extensiones no-vpk para archivos que deben ignorarse. */
const nonVpkExt: fc.Arbitrary<string> = fc.constantFrom(
  ".jpg",
  ".txt",
  ".bin",
  ".nut",
  "", // sin extensión
);

const metaPlanArb: fc.Arbitrary<MetaPlan> = fc.oneof(
  fc
    .stringMatching(/^[A-Za-z0-9 _.-]{1,30}$/)
    .map((title): MetaPlan => ({ kind: "ok", title })),
  fc.constant<MetaPlan>({ kind: "malformed" }),
  fc.constant<MetaPlan>({ kind: "absent" }),
  fc.constant<MetaPlan>({ kind: "list-fails" }),
  fc.constant<MetaPlan>({ kind: "extract-fails" }),
);

/**
 * baseNames ÚNICOS (id inequívoco): en un mismo directorio no pueden coexistir
 * dos archivos con idéntico nombre. Charset realista de Workshop.
 */
const baseNameArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,20}$/)
  .filter((s) => s.length > 0);

/**
 * Genera una lista de entradas con baseNames globalmente únicos (para todas las
 * categorías, así ningún nombre de dir/non-vpk colisiona con un id de vpk).
 */
const scenario: fc.Arbitrary<EntrySpec[]> = fc
  .uniqueArray(baseNameArb, { minLength: 0, maxLength: 30 })
  .chain((baseNames) =>
    fc
      .tuple(
        ...baseNames.map(() =>
          fc.oneof(
            fc
              .tuple(vpkCasing, fc.boolean(), metaPlanArb)
              .map(
                ([casing, hasCover, meta]) =>
                  (baseName: string): EntrySpec => ({
                    kind: "vpk",
                    baseName,
                    casing,
                    hasCover,
                    meta,
                  }),
              ),
            nonVpkExt.map(
              (ext) =>
                (baseName: string): EntrySpec => ({
                  kind: "non-vpk",
                  name: `${baseName}${ext}`,
                }),
            ),
            // Subdirectorio: a veces con nombre que TERMINA en `.vpk` para
            // verificar que un dir nunca cuenta como addon.
            fc
              .option(vpkCasing, { nil: undefined })
              .map(
                (casing) =>
                  (baseName: string): EntrySpec => ({
                    kind: "dir",
                    name: casing ? `${baseName}${casing}` : baseName,
                  }),
              ),
          ),
        ),
      )
      .map((factories) =>
        baseNames.map((baseName, i) => (factories[i] as (b: string) => EntrySpec)(baseName)),
      ),
  );

// ---------------------------------------------------------------------------
// Construcción de los fakes y del MODELO a partir del escenario.
// ---------------------------------------------------------------------------

/** Puebla `MockFs` + `ScriptedRunner` para un escenario en un WORKSHOP dado. */
const buildFakes = (
  workshop: string,
  specs: readonly EntrySpec[],
): { fs: MockFs; runner: ScriptedRunner } => {
  const fs = new MockFs();
  const runner = new ScriptedRunner();

  const entries: DirEntry[] = specs.map((spec) => {
    switch (spec.kind) {
      case "vpk":
        return { name: `${spec.baseName}${spec.casing}`, isDirectory: false };
      case "non-vpk":
        return { name: spec.name, isDirectory: false };
      case "dir":
        return { name: spec.name, isDirectory: true };
    }
  });
  fs.entries.set(workshop, entries);

  for (const spec of specs) {
    if (spec.kind !== "vpk") {
      continue;
    }
    const id = spec.baseName;
    const vpkPath = joinWin(workshop, `${id}${spec.casing}`);

    if (spec.hasCover) {
      fs.covers.add(joinWin(workshop, `${id}${COVER_EXTENSION}`));
    }

    switch (spec.meta.kind) {
      case "ok":
        runner.listStdout.set(vpkPath, "addoninfo.txt");
        fs.files.set(joinWin(TEMP, `${id}\\addoninfo.txt`), addoninfoText(spec.meta.title));
        break;
      case "malformed":
        runner.listStdout.set(vpkPath, "addoninfo.txt");
        fs.files.set(joinWin(TEMP, `${id}\\addoninfo.txt`), MALFORMED_TEXT);
        break;
      case "absent":
        runner.listStdout.set(vpkPath, "materials/a.vmt\nmodels/b.mdl");
        break;
      case "list-fails":
        runner.listExit.set(vpkPath, -1);
        break;
      case "extract-fails":
        runner.listStdout.set(vpkPath, "addoninfo.txt");
        runner.extractExit.set(vpkPath, 5);
        break;
    }
  }

  return { fs, runner };
};

/**
 * MODELO INDEPENDIENTE: reconstruye el resultado esperado del escaneo serial
 * recorriendo las entradas EN ORDEN y aplicando las reglas del contrato, sin
 * llamar a `AddonScanner`. Fuente de verdad de la preservación.
 */
const modelScan = (
  workshop: string,
  specs: readonly EntrySpec[],
): ScannedAddon[] => {
  const result: ScannedAddon[] = [];
  for (const spec of specs) {
    // (3.1/3.2) solo archivos `.vpk` de nivel superior; dirs y otras exts fuera.
    if (spec.kind !== "vpk") {
      continue;
    }
    const id = spec.baseName;
    const vpkPath = joinWin(workshop, `${id}${spec.casing}`);
    // (3.3) cover best-effort: `<id>.jpg` si existe, null si no.
    const coverPath = spec.hasCover
      ? joinWin(workshop, `${id}${COVER_EXTENSION}`)
      : null;
    // (3.4) addoninfo best-effort: null salvo texto válido y parseable.
    let info: AddonInfo | null = null;
    if (spec.meta.kind === "ok") {
      info = extractAddonInfo(addoninfoText(spec.meta.title));
    }
    // "malformed" ⇒ extractAddonInfo devolvería null; "absent"/"*-fails" ⇒ null.
    result.push({ id, vpkPath, coverPath, info });
  }
  return result;
};

// ---------------------------------------------------------------------------
// Property: el resultado del escaneo es deep-equal y EN EL MISMO ORDEN que el
// modelo (solo .vpk nivel superior, id derivado, cover correcto, info best-effort,
// orden del listado, sin pérdida/duplicación/reordenamiento). PASA sobre el
// código serial actual (Property 2 del diseño).
// ---------------------------------------------------------------------------

propertyTest(
  2,
  "El escaneo preserva lista, orden y metadata del serial de referencia",
  fc.asyncProperty(
    scenario,
    fc.string({ minLength: 0, maxLength: 20 }),
    async (specs, workshopSuffix) => {
      const workshop = `C:\\ws${workshopSuffix}`;

      const expected = modelScan(workshop, specs);

      const { fs, runner } = buildFakes(workshop, specs);
      const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);
      const result = await scanner.scan(workshop);

      // Deep-equal Y en el mismo orden: misma lista, mismo orden, misma metadata.
      // (Cubre 3.1–3.6: filtrado, id, cover, info best-effort, orden, sin dup.)
      expect(result).toEqual(expected);

      // Refuerzo explícito de "sin pérdida/duplicación/reordenamiento": la
      // secuencia de ids coincide exactamente con la de los `.vpk` en el orden
      // del listado.
      const expectedIds = specs
        .filter((s): s is Extract<EntrySpec, { kind: "vpk" }> => s.kind === "vpk")
        .map((s) => s.baseName);
      expect(result.map((a) => a.id)).toEqual(expectedIds);
    },
  ),
);

// ---------------------------------------------------------------------------
// Property (Tarea 5): equivalencia deep-equal + COTA de concurrencia sobre el
// código YA arreglado. Se mide `maxInFlight` con un runner instrumentado que
// CEDE al event loop antes de resolver (permite el solapamiento real del pool)
// y se asevera que nunca supera DEFAULT_VPK_CONCURRENCY, además de que el
// resultado sigue siendo deep-equal y en el mismo orden que el modelo.
// ---------------------------------------------------------------------------

/** Cede al event loop una vez (permite solapamiento del pool si lo hubiera). */
const yieldToEventLoopP = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Igual que {@link ScriptedRunner} (mismo enrutado determinista por vpkPath)
 * pero INSTRUMENTADO: mide el pico de invocaciones `vpk.exe` en vuelo
 * (`maxInFlight`) y cede al event loop antes de resolver.
 */
class InstrumentedScriptedRunner implements CommandRunner {
  readonly listExit = new Map<string, number>();
  readonly listStdout = new Map<string, string>();
  readonly extractExit = new Map<string, number>();

  #inFlight = 0;
  maxInFlight = 0;

  async run(_executable: string, args: readonly string[]): Promise<CommandResult> {
    const [subcommand, vpkPath] = args;
    const key = vpkPath ?? "";

    this.#inFlight += 1;
    if (this.#inFlight > this.maxInFlight) {
      this.maxInFlight = this.#inFlight;
    }
    try {
      await yieldToEventLoopP();
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

/** Puebla `MockFs` + `InstrumentedScriptedRunner` para un escenario dado. */
const buildInstrumentedFakes = (
  workshop: string,
  specs: readonly EntrySpec[],
): { fs: MockFs; runner: InstrumentedScriptedRunner } => {
  const fs = new MockFs();
  const runner = new InstrumentedScriptedRunner();

  const entries: DirEntry[] = specs.map((spec) => {
    switch (spec.kind) {
      case "vpk":
        return { name: `${spec.baseName}${spec.casing}`, isDirectory: false };
      case "non-vpk":
        return { name: spec.name, isDirectory: false };
      case "dir":
        return { name: spec.name, isDirectory: true };
    }
  });
  fs.entries.set(workshop, entries);

  for (const spec of specs) {
    if (spec.kind !== "vpk") {
      continue;
    }
    const id = spec.baseName;
    const vpkPath = joinWin(workshop, `${id}${spec.casing}`);

    if (spec.hasCover) {
      fs.covers.add(joinWin(workshop, `${id}${COVER_EXTENSION}`));
    }

    switch (spec.meta.kind) {
      case "ok":
        runner.listStdout.set(vpkPath, "addoninfo.txt");
        fs.files.set(joinWin(TEMP, `${id}\\addoninfo.txt`), addoninfoText(spec.meta.title));
        break;
      case "malformed":
        runner.listStdout.set(vpkPath, "addoninfo.txt");
        fs.files.set(joinWin(TEMP, `${id}\\addoninfo.txt`), MALFORMED_TEXT);
        break;
      case "absent":
        runner.listStdout.set(vpkPath, "materials/a.vmt\nmodels/b.mdl");
        break;
      case "list-fails":
        runner.listExit.set(vpkPath, -1);
        break;
      case "extract-fails":
        runner.listStdout.set(vpkPath, "addoninfo.txt");
        runner.extractExit.set(vpkPath, 5);
        break;
    }
  }

  return { fs, runner };
};

propertyTest(
  1,
  "El escaneo paralelo es equivalente al serial y respeta la cota DEFAULT_VPK_CONCURRENCY",
  fc.asyncProperty(
    scenario,
    fc.string({ minLength: 0, maxLength: 20 }),
    async (specs, workshopSuffix) => {
      const workshop = `C:\\ws${workshopSuffix}`;

      const expected = modelScan(workshop, specs);

      const { fs, runner } = buildInstrumentedFakes(workshop, specs);
      const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);
      const result = await scanner.scan(workshop);

      // Equivalencia total: deep-equal y en el mismo orden que el modelo.
      expect(result).toEqual(expected);

      // COTA de concurrencia: el pool nunca lanza más de DEFAULT_VPK_CONCURRENCY
      // invocaciones `vpk.exe` en vuelo simultáneamente, para toda Workshop.
      expect(runner.maxInFlight).toBeLessThanOrEqual(DEFAULT_VPK_CONCURRENCY);
    },
  ),
);
