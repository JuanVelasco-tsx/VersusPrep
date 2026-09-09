import type { CollisionFileSystem, WalkedFile } from "../domain/index.js";
import { copyFileOverwrite, ensureDir, walkRecursive } from "./node-fs-helpers.js";

/** CollisionFileSystem real (Tarea 20.4, bloque 1): consumido por CollisionResolver (Sección 10). */
export class RealCollisionFileSystem implements CollisionFileSystem {
  async walk(rootDir: string): Promise<WalkedFile[]> {
    return walkRecursive(rootDir);
  }

  async ensureDir(dir: string): Promise<void> {
    return ensureDir(dir);
  }

  async copyFile(sourcePath: string, destPath: string): Promise<void> {
    return copyFileOverwrite(sourcePath, destPath);
  }
}