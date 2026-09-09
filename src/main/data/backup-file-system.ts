import type { BackupFileSystem } from "../domain/index.js";
import { copyFileOverwrite, pathExists } from "./node-fs-helpers.js";

/** BackupFileSystem real (Tarea 20.4, bloque 1): consumido por BackupManager (Sección 12). */
export class RealBackupFileSystem implements BackupFileSystem {
  async exists(target: string): Promise<boolean> {
    return pathExists(target);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    return copyFileOverwrite(sourcePath, destPath);
  }
}