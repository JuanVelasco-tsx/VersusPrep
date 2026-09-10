import { promises as fs } from "node:fs";

import type { FileReadResult, FileSystemProbe } from "../domain/index.js";
import { pathExists } from "./node-fs-helpers.js";

/** FileSystemProbe real (Tarea 20.4, bloque 1): consumida por PathDetector (Sección 5). */
export class RealFileSystemProbe implements FileSystemProbe {
  async readTextFile(target: string): Promise<FileReadResult> {
    try {
      const content = await fs.readFile(target, "utf8");
      return { ok: true, content };
    } catch {
      return { ok: false };
    }
  }

  async exists(target: string): Promise<boolean> {
    return pathExists(target);
  }
}