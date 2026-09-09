import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseRegQueryOutput } from "../src/main/data/registry-reader.js";
import { parseTasklistCsv } from "../src/main/data/process-list-provider.js";
import {
  copyFileOverwrite,
  ensureDir,
  listTopLevelEntries,
  pathExists,
  readTextFileOrThrow,
  removeDirRecursive,
  walkRecursive,
  writeTextFile,
} from "../src/main/data/node-fs-helpers.js";

/**
 * Tests del bloque 1 de la Tarea 20.4 (adaptadores hoja). Cubren:
 *   1. El parseo PURO de las salidas de `reg query` y `tasklist` (sin tocar el
 *      SO): son la unica logica no trivial de RegistryReader/ProcessListProvider.
 *   2. Integracion LIGERA de node-fs-helpers contra un directorio temporal real
 *      bajo os.tmpdir(), limpiado en afterEach. Los seis *FileSystem wrapper son
 *      delegacion directa a estos helpers, asi que no se testean por separado.
 */

// ---------------------------------------------------------------------------
// parseRegQueryOutput
// ---------------------------------------------------------------------------

describe("parseRegQueryOutput", () => {
  test("extrae un REG_SZ simple", () => {
    const out = [
      "",
      "HKEY_CURRENT_USER\\Software\\Valve\\Steam",
      "    SteamPath    REG_SZ    C:\\Steam",
      "",
    ].join("\r\n");
    expect(parseRegQueryOutput(out, "SteamPath")).toBe("C:\\Steam");
  });

  test("extrae un dato con espacios (ruta Program Files)", () => {
    const out = [
      "HKEY_CURRENT_USER\\Software\\Valve\\Steam",
      "    SteamPath    REG_SZ    C:\\Program Files (x86)\\Steam",
    ].join("\r\n");
    expect(parseRegQueryOutput(out, "SteamPath")).toBe(
      "C:\\Program Files (x86)\\Steam",
    );
  });

  test("devuelve null si el valor buscado no aparece", () => {
    const out = [
      "HKEY_CURRENT_USER\\Software\\Valve\\Steam",
      "    OtroValor    REG_SZ    algo",
    ].join("\r\n");
    expect(parseRegQueryOutput(out, "SteamPath")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseTasklistCsv
// ---------------------------------------------------------------------------

describe("parseTasklistCsv", () => {
  test("extrae el Image Name de cada linea CSV", () => {
    const out = [
      '"left4dead2.exe","1234","Console","1","2,000 K"',
      '"steam.exe","5678","Console","1","120,000 K"',
    ].join("\r\n");
    expect(parseTasklistCsv(out)).toEqual(["left4dead2.exe", "steam.exe"]);
  });

  test("ignora lineas vacias", () => {
    const out = ['"explorer.exe","999","Console","1","50,000 K"', "", "   "].join(
      "\r\n",
    );
    expect(parseTasklistCsv(out)).toEqual(["explorer.exe"]);
  });

  test("salida vacia -> []", () => {
    expect(parseTasklistCsv("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// node-fs-helpers (integracion ligera contra un tmpdir real)
// ---------------------------------------------------------------------------

describe("node-fs-helpers (tmpdir real)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "l4d2-data-adapters-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("ensureDir crea recursivo e idempotente; pathExists lo confirma", async () => {
    const nested = path.join(tmp, "a", "b", "c");
    expect(await pathExists(nested)).toBe(false);
    await ensureDir(nested);
    expect(await pathExists(nested)).toBe(true);
    // Idempotente: segunda llamada no lanza.
    await ensureDir(nested);
    expect(await pathExists(nested)).toBe(true);
  });

  test("writeTextFile + readTextFileOrThrow round-trip UTF-8", async () => {
    const file = path.join(tmp, "nota.txt");
    await writeTextFile(file, "hola áéí");
    expect(await readTextFileOrThrow(file)).toBe("hola áéí");
  });

  test("readTextFileOrThrow LANZA si el archivo no existe", async () => {
    await expect(readTextFileOrThrow(path.join(tmp, "no-existe.txt"))).rejects.toThrow();
  });

  test("copyFileOverwrite crea y luego SOBRESCRIBE el destino", async () => {
    const src = path.join(tmp, "src.txt");
    const dest = path.join(tmp, "dest.txt");
    await writeTextFile(src, "v1");
    await copyFileOverwrite(src, dest);
    expect(await readTextFileOrThrow(dest)).toBe("v1");
    // Reescribir origen y copiar de nuevo: el destino queda sobrescrito.
    await writeTextFile(src, "v2");
    await copyFileOverwrite(src, dest);
    expect(await readTextFileOrThrow(dest)).toBe("v2");
  });

  test("removeDirRecursive borra el arbol y NO lanza si no existe", async () => {
    const dir = path.join(tmp, "borrar", "sub");
    await ensureDir(dir);
    await writeTextFile(path.join(dir, "x.txt"), "x");
    await removeDirRecursive(path.join(tmp, "borrar"));
    expect(await pathExists(path.join(tmp, "borrar"))).toBe(false);
    // Idempotente sobre inexistente: no lanza.
    await removeDirRecursive(path.join(tmp, "borrar"));
  });

  test("listTopLevelEntries devuelve solo el nivel superior con isDirectory", async () => {
    await writeTextFile(path.join(tmp, "archivo.txt"), "a");
    await ensureDir(path.join(tmp, "carpeta"));
    // Un archivo anidado NO debe aparecer (no es recursivo).
    await writeTextFile(path.join(tmp, "carpeta", "anidado.txt"), "n");

    const entries = await listTopLevelEntries(tmp);
    const byName = new Map(entries.map((e) => [e.name, e.isDirectory]));
    expect(byName.get("archivo.txt")).toBe(false);
    expect(byName.get("carpeta")).toBe(true);
    expect(byName.has("anidado.txt")).toBe(false);
    expect(entries.length).toBe(2);
  });

  test("walkRecursive devuelve solo archivos con relativePath usando '/'", async () => {
    await ensureDir(path.join(tmp, "materials", "sub"));
    await writeTextFile(path.join(tmp, "raiz.txt"), "r");
    await writeTextFile(path.join(tmp, "materials", "a.vmt"), "a");
    await writeTextFile(path.join(tmp, "materials", "sub", "b.vtf"), "b");

    const walked = await walkRecursive(tmp);
    const rels = walked.map((w) => w.relativePath).sort();
    expect(rels).toEqual(["materials/a.vmt", "materials/sub/b.vtf", "raiz.txt"]);
    // Ningun separador de Windows en las rutas relativas.
    for (const r of rels) expect(r.includes("\\")).toBe(false);
  });
});