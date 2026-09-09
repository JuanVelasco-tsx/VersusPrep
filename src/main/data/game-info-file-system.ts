import type { GameInfoFileSystem } from "../domain/index.js";
import { readTextFileOrThrow, writeTextFile } from "./node-fs-helpers.js";

/** GameInfoFileSystem real (Tarea 20.4, bloque 1): consumido por GameInfoEditor (Sección 13). */
export class RealGameInfoFileSystem implements GameInfoFileSystem {
  async readTextFile(target: string): Promise<string> {
    return readTextFileOrThrow(target);
  }

  async writeTextFile(target: string, content: string): Promise<void> {
    return writeTextFile(target, content);
  }
}