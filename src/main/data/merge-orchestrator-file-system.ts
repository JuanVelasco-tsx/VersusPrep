import type { MergeOrchestratorFileSystem } from "../domain/index.js";
import { copyFileOverwrite, ensureDir, removeDirRecursive } from "./node-fs-helpers.js";

/** MergeOrchestratorFileSystem real (Tarea 20.4, bloque 1): consumido por MergeOrchestrator (Sección 18). */
export class RealMergeOrchestratorFileSystem implements MergeOrchestratorFileSystem {
  async ensureDir(dir: string): Promise<void> {
    return ensureDir(dir);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    return copyFileOverwrite(sourcePath, destPath);
  }

  async removeDir(dir: string): Promise<void> {
    return removeDirRecursive(dir);
  }
}