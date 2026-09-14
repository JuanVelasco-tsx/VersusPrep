import { describe, expect, test } from "vitest";

import { GameInfoEditor, ensureModsvsFirstInContent } from "../src/main/domain/index.js";
import type { GameInfoFileSystem } from "../src/main/domain/index.js";

/**
 * Tests de P-30 Paso 2 (generalización de GameInfoEditor, DECISIÓN 6 en
 * game-info-editor.ts): `folderName` ya NO es la constante fija `"modsvs"`,
 * es un parámetro REQUERIDO tanto del núcleo puro `ensureModsvsFirstInContent`
 * como del método de I/O `GameInfoEditor.ensureModsvsFirst`. Estos tests
 * confirman que un `folderName` DISTINTO de `"modsvs"` (p. ej. el id técnico
 * de un preset) se reconoce/inserta correctamente en la entrada
 * `Game <folderName>` del bloque SearchPaths, sin que ninguna lógica interna
 * siga asumiendo `"modsvs"`. NO cubren el cambio de comportamiento real de
 * QUÉ carpeta se usa en producción (eso sigue siendo `"modsvs"` hasta un paso
 * posterior de P-30, ver `GAMEINFO_SEARCH_PATH_FOLDER` en
 * `merge-orchestrator.ts`) — los tests de BUG-010 (que pasan `"modsvs"`
 * explícito) siguen cubriendo ese caso concreto.
 */

const EOL = "\n";

/** Mismo helper de estilo que los tests de BUG-010: gameinfo.txt sintético con un bloque SearchPaths bien formado. */
function buildGameInfo(blockLines: string[]): string {
  return [
    '"GameInfo"',
    "{",
    "\tFileSystem",
    "\t{",
    "\t\tSearchPaths",
    "\t\t{",
    ...blockLines,
    "\t\t}",
    "\t}",
    "}",
    "",
  ].join(EOL);
}

/** Líneas `Game <algo>` de `content`, en orden de aparición. */
function gameLines(content: string): string[] {
  return content.split(EOL).filter((line) => /^\s*game\s/i.test(line));
}

describe("ensureModsvsFirstInContent — folderName distinto de 'modsvs' (P-30, Paso 2)", () => {
  test("Caso A: inserta 'Game preset-a1b2c3' como primera entrada, sin mencionar 'modsvs'", () => {
    const content = buildGameInfo(["\t\t\tGame\tupdate", "\t\t\tGame\tleft4dead2_dlc3"]);

    const result = ensureModsvsFirstInContent(content, "preset-a1b2c3");

    expect(result.appliedCase).toBe("inserted");
    const lines = gameLines(result.content);
    expect(lines[0]).toMatch(/Game\tpreset-a1b2c3\s*$/);
    // folderName distinto = carpeta distinta: nada del contenido resultante
    // menciona "modsvs" (no quedó ningún rastro de la vieja constante fija).
    expect(result.content).not.toMatch(/game\s+"?modsvs"?\s*$/im);
  });

  test("'Game modsvs' existente y 'Game preset-xyz' pedido son carpetas INDEPENDIENTES: no se confunden ni se pisan", () => {
    const content = buildGameInfo(["\t\t\tGame\tmodsvs", "\t\t\tGame\tupdate"]);

    // No hay ninguna entrada "preset-xyz" -> Caso A: se inserta como primera,
    // SIN tocar ni mover el "Game modsvs" ya existente.
    const result = ensureModsvsFirstInContent(content, "preset-xyz");

    expect(result.appliedCase).toBe("inserted");
    const lines = gameLines(result.content);
    expect(lines[0]).toMatch(/Game\tpreset-xyz\s*$/);
    expect(lines.some((line) => /Game\tmodsvs\s*$/.test(line))).toBe(true);
  });

  test("Caso C con folderName custom: ya es primera-y-única -> idempotente, sin cambios", () => {
    const content = buildGameInfo(["\t\t\tGame\tpreset-a1b2c3", "\t\t\tGame\tupdate"]);

    const result = ensureModsvsFirstInContent(content, "preset-a1b2c3");

    expect(result).toEqual({ content, changed: false, appliedCase: "unchanged" });
  });
});

/** GameInfoFileSystem en memoria: un único archivo, registra cada escritura. */
class InMemoryGameInfoFs implements GameInfoFileSystem {
  readonly writes: Array<{ path: string; content: string }> = [];
  readonly #files: Map<string, string>;

  constructor(files: Map<string, string>) {
    this.#files = files;
  }

  async readTextFile(path: string): Promise<string> {
    const content = this.#files.get(path);
    if (content === undefined) throw new Error(`No existe: ${path}`);
    return content;
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
    this.#files.set(path, content);
  }
}

describe("GameInfoEditor.ensureModsvsFirst — folderName distinto de 'modsvs' (P-30, Paso 2)", () => {
  const PATH = "C:\\Game\\left4dead2\\gameinfo.txt";

  test("escribe 'Game <folderName>' en el archivo con el folderName pedido, NO 'modsvs'", async () => {
    const content = buildGameInfo(["\t\t\tGame\tupdate"]);
    const fs = new InMemoryGameInfoFs(new Map([[PATH, content]]));
    const editor = new GameInfoEditor(fs);

    const result = await editor.ensureModsvsFirst(PATH, "preset-a1b2c3");

    expect(result).toEqual({ appliedCase: "inserted", changed: true });
    expect(fs.writes).toHaveLength(1);
    expect(fs.writes[0]!.content).toMatch(/Game\tpreset-a1b2c3\s*\n/);
    expect(fs.writes[0]!.content).not.toMatch(/game\s+"?modsvs"?\s*$/im);
  });

  test("Caso C con folderName custom: NO escribe el archivo (idempotente)", async () => {
    const content = buildGameInfo(["\t\t\tGame\tpreset-a1b2c3", "\t\t\tGame\tupdate"]);
    const fs = new InMemoryGameInfoFs(new Map([[PATH, content]]));
    const editor = new GameInfoEditor(fs);

    const result = await editor.ensureModsvsFirst(PATH, "preset-a1b2c3");

    expect(result).toEqual({ appliedCase: "unchanged", changed: false });
    expect(fs.writes).toHaveLength(0);
  });
});
