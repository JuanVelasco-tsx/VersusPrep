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
 * BUG-006 — Test EXPLORATORIO de la Bug Condition (Tarea 1 del plan).
 *
 * OBJETIVO: surfacear el contraejemplo que demuestra que, sobre el código SIN
 * arreglar, `AddonScanner.scan` ejecuta las invocaciones `vpk.exe`
 * (`vpk l` + `vpk x`) con **concurrencia efectiva 1** (serial): nunca hay dos
 * invocaciones en vuelo a la vez.
 *
 * METODOLOGÍA (bug condition): la aserción de este test codifica el
 * comportamiento CORRECTO esperado DESPUÉS del fix (`maxInFlight > 1`). Por eso
 * DEBE FALLAR sobre el código serial actual (donde `maxInFlight === 1`). Ese
 * fallo CONFIRMA que el bug existe (`isBugCondition` retorna `true`). Tras el
 * fix (Tarea 3.1), el MISMO test pasará y validará que el bug quedó resuelto
 * (Tarea 3.2, que además aserta la cota superior `<= DEFAULT_VPK_CONCURRENCY`).
 *
 * ---------------------------------------------------------------------------
 * CONTRAEJEMPLO DOCUMENTADO (medido sobre el código SIN arreglar):
 *   Con 8 addons `.vpk` de nivel superior, cada uno con `addoninfo.txt` listable
 *   (⇒ 2 invocaciones `vpk.exe` por addon: `vpk l` + `vpk x`), el escáner serial
 *   produce `maxInFlight === 1`: en ningún instante coexisten dos invocaciones
 *   `vpk.exe` en vuelo. La aserción `maxInFlight > 1` FALLA, demostrando
 *   concurrencia efectiva 1 (tiempo lineal en N).
 * ---------------------------------------------------------------------------
 *
 * INSTRUMENTACIÓN: el `AddonScanner` usa un `VpkTool`, no directamente el
 * runner; por eso se instrumenta un {@link CommandRunner} que:
 *   - incrementa un contador `inFlight` al ENTRAR a `run` (subcomandos `l`/`x`),
 *     registra el máximo observado (`maxInFlight`) y lo decrementa al resolver;
 *   - NO resuelve inmediato: CEDE al event loop (`setTimeout(0)`) antes de
 *     resolver, para que —de existir paralelismo— dos invocaciones puedan estar
 *     en vuelo simultáneamente. Sobre el bucle serial esto no cambia nada: cada
 *     addon espera al anterior, así que el pico nunca supera 1.
 */

const VPK_EXE = "C:\\game\\bin\\vpk.exe";
const WORKSHOP = "C:\\ws";
const TEMP = "C:\\tmp\\scan";

/** Cantidad de addons `.vpk` de nivel superior de la Workshop de prueba (≥ 5). */
const ADDON_COUNT = 8;

/** Texto de `addoninfo.txt` bien formado usado por todos los addons. */
const ADDONINFO_TEXT = [
  '"AddonInfo"',
  "{",
  '    addontitle       "Mod de prueba"',
  '    addonauthor      "Autor"',
  "}",
].join("\n");

/** Cede al event loop una vez (permite solapamiento si lo hubiera). */
const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Ejecutor de comandos INSTRUMENTADO. Enruta `vpk l`/`vpk x` con stdout/exit
 * deterministas (todos los addons listan un `addoninfo.txt` ⇒ list + extract) y
 * mide el solapamiento de invocaciones concurrentes.
 *
 * `maxInFlight` es el pico de invocaciones `vpk.exe` simultáneamente en vuelo
 * durante todo el escaneo. Sobre el código serial vale 1; tras el fix, > 1.
 */
class InstrumentedRunner implements CommandRunner {
  /** Invocaciones actualmente en vuelo. */
  #inFlight = 0;
  /** Pico máximo de invocaciones en vuelo observado. */
  maxInFlight = 0;

  async run(
    _executable: string,
    args: readonly string[],
  ): Promise<CommandResult> {
    const [subcommand] = args;

    // Entrar: una invocación `vpk.exe` más en vuelo.
    this.#inFlight += 1;
    if (this.#inFlight > this.maxInFlight) {
      this.maxInFlight = this.#inFlight;
    }

    try {
      // Ceder al event loop: si hubiera paralelismo, otra invocación podría
      // entrar mientras esta espera, elevando `maxInFlight` por encima de 1.
      await yieldToEventLoop();

      if (subcommand === "l") {
        // Todos los VPK listan un `addoninfo.txt` ⇒ habrá también un `vpk x`.
        return { exitCode: 0, stdout: "addoninfo.txt", stderr: "" };
      }
      // `vpk x` (extract): éxito silencioso.
      return { exitCode: 0, stdout: "", stderr: "" };
    } finally {
      // Salir: la invocación dejó de estar en vuelo.
      this.#inFlight -= 1;
    }
  }
}

/**
 * FS mockeado en memoria: lista los `.vpk` de nivel superior y provee el texto
 * del `addoninfo.txt` que `vpk x` habría escrito bajo `TEMP/<id>`.
 */
class MockFs implements AddonFileSystem {
  readonly entries = new Map<string, DirEntry[]>();
  readonly files = new Map<string, string>();

  listEntries(dir: string): Promise<DirEntry[]> {
    return Promise.resolve(this.entries.get(dir) ?? []);
  }

  exists(_path: string): Promise<boolean> {
    // Los covers no son relevantes para este test de concurrencia.
    return Promise.resolve(false);
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

/** Construye una Workshop con `count` addons `.vpk`, cada uno con addoninfo. */
const buildWorkshopFs = (count: number): MockFs => {
  const fs = new MockFs();
  const entries: DirEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `addon${i}`;
    entries.push({ name: `${id}.vpk`, isDirectory: false });
    // Archivo que `vpk x` habría escrito bajo TEMP/<id>/addoninfo.txt.
    fs.files.set(`${TEMP}\\${id}\\addoninfo.txt`, ADDONINFO_TEXT);
  }
  fs.entries.set(WORKSHOP, entries);
  return fs;
};

describe("BUG-006: la Bug Condition — escaneo serial (concurrencia efectiva 1)", () => {
  test("el escaneo solapa invocaciones `vpk.exe` (maxInFlight > 1)", async () => {
    const fs = buildWorkshopFs(ADDON_COUNT);
    const runner = new InstrumentedRunner();
    const scanner = new AddonScanner(fs, new VpkTool(runner, VPK_EXE), TEMP);

    const result = await scanner.scan(WORKSHOP);

    // Sanity: los 8 addons se listaron (la bug condition requiere N grande).
    expect(result).toHaveLength(ADDON_COUNT);

    // El pool nunca debe exceder DEFAULT_VPK_CONCURRENCY (cota que el fix
    // respeta). Se aserta también sobre el código serial: 1 <= la cota, así que
    // esta expectativa PASA tanto antes como después del fix.
    expect(runner.maxInFlight).toBeLessThanOrEqual(DEFAULT_VPK_CONCURRENCY);

    // ASERCIÓN CLAVE — comportamiento CORRECTO (esperado tras el fix):
    // debe haber solapamiento (> 1 invocación en vuelo a la vez).
    //
    // Sobre el código SIN arreglar (serial) esto FALLA porque maxInFlight === 1:
    // demuestra la concurrencia efectiva 1 (bug confirmado).
    expect(runner.maxInFlight).toBeGreaterThan(1);
  });
});
