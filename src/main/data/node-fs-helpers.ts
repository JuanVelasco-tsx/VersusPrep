/**
 * Primitivas de node:fs/promises compartidas por los adaptadores *FileSystem
 * (Tarea 20.4, bloque 1). Cada *FileSystem del dominio (AddonFileSystem,
 * CollisionFileSystem, MergeFileSystem, BackupFileSystem, GameInfoFileSystem,
 * MergeOrchestratorFileSystem) delega en estas funciones en vez de reimplementar
 * la misma operación seis veces con matices que podrían divergir.
 *
 * Cada función respeta la semántica MÁS ESTRICTA exigida por cualquiera de sus
 * consumidores (documentada en su JSDoc); el *FileSystem que la use hereda esa
 * semántica tal cual, sin envolverla.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

/** Crea un directorio de forma recursiva e idempotente (no lanza si ya existe). */
export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** `true`/`false` según exista la ruta; NUNCA lanza (ENOENT y similares -> false). */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lee un archivo de texto UTF-8. LANZA si no existe o es ilegible (contrato
 * compartido por AddonFileSystem.readTextFile y GameInfoFileSystem.readTextFile
 * — idéntico en ambos, a diferencia de FileSystemProbe.readTextFile, que NO lanza).
 */
export async function readTextFileOrThrow(target: string): Promise<string> {
  return fs.readFile(target, "utf8");
}

/** Sobrescribe (o crea) un archivo de texto UTF-8. */
export async function writeTextFile(target: string, content: string): Promise<void> {
  await fs.writeFile(target, content, "utf8");
}

/**
 * Copia `source` a `dest`, SOBRESCRIBIENDO si `dest` ya existe (comportamiento
 * por defecto de fs.copyFile sin COPYFILE_EXCL). LANZA si falla (contrato
 * compartido por CollisionFileSystem, BackupFileSystem y
 * MergeOrchestratorFileSystem: este último depende de que el error se propague
 * para que el manejo REACTIVO de EACCES/EPERM lo capture y eleve).
 */
export async function copyFileOverwrite(source: string, dest: string): Promise<void> {
  await fs.copyFile(source, dest);
}

/**
 * Elimina un directorio de forma recursiva e idempotente: NO lanza si `dir` no
 * existe (equivalente a rm -rf). Contrato de MergeOrchestratorFileSystem.removeDir,
 * usado en el finally de #materialize (limpieza del workDir en éxito, fallo o
 * elevación por igual).
 */
export async function removeDirRecursive(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/** Entrada de directorio de NIVEL SUPERIOR (no recursivo): nombre + si es carpeta. */
export interface FsDirEntry {
  name: string;
  isDirectory: boolean;
}

/** Lista las entradas de NIVEL SUPERIOR de `dir` (no recursivo). Contrato de AddonFileSystem.listEntries. */
export async function listTopLevelEntries(dir: string): Promise<FsDirEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }));
}

/** Archivo encontrado en un recorrido recursivo, con su ruta RELATIVA a la raíz. */
export interface FsWalkedFile {
  relativePath: string;
}

/**
 * Recorre `rootDir` RECURSIVAMENTE y devuelve solo los ARCHIVOS (no directorios),
 * con `relativePath` relativo a `rootDir` usando `/` como separador (para calzar
 * con la normalización de paths internos del dominio, ver toCollisionKey/
 * vpk-path.ts). Contrato de CollisionFileSystem.walk.
 */
export async function walkRecursive(rootDir: string): Promise<FsWalkedFile[]> {
  const results: FsWalkedFile[] = [];
  async function recurse(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await recurse(fullPath);
      } else {
        const relative = path.relative(rootDir, fullPath).split(path.sep).join("/");
        results.push({ relativePath: relative });
      }
    }
  }
  await recurse(rootDir);
  return results;
}