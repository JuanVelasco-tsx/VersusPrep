import type { MergeFileSystem } from "../domain/index.js";
import { ensureDir } from "./node-fs-helpers.js";

/** MergeFileSystem real (Tarea 20.4, bloque 1): consumido por MergeEngine (Sección 11). */
export class RealMergeFileSystem implements MergeFileSystem {
  async ensureDir(dir: string): Promise<void> {
    return ensureDir(dir);
  }
}