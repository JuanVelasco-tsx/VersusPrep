import type { AddonFileSystem, DirEntry } from "../domain/index.js";
import {
  ensureDir,
  listTopLevelEntries,
  pathExists,
  readTextFileOrThrow,
} from "./node-fs-helpers.js";

/** AddonFileSystem real (Tarea 20.4, bloque 1): consumido por AddonScanner (Sección 6). */
export class RealAddonFileSystem implements AddonFileSystem {
  async listEntries(dir: string): Promise<DirEntry[]> {
    return listTopLevelEntries(dir);
  }

  async exists(target: string): Promise<boolean> {
    return pathExists(target);
  }

  async readTextFile(target: string): Promise<string> {
    return readTextFileOrThrow(target);
  }

  async ensureDir(dir: string): Promise<void> {
    return ensureDir(dir);
  }
}