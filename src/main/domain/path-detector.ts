/**
 * PathDetector — selección de la Game_Library (AC 1.5, AC 1.6 / Tarea 5.1 /
 * Property 1).
 *
 * Esta parte del PathDetector (Tarea 5.1) cubre la lógica PURA de selección de
 * la biblioteca de Steam que contiene L4D2 a partir de las `LibraryEntry[]` ya
 * parseadas de `libraryfolders.vdf` (ver `vdf-parser.ts`).
 *
 * El resto del PathDetector (lectura del registro con `readSteamPath`,
 * derivación de rutas con `derivePaths`, verificación en disco con
 * `verifyPathsOnDisk` y la orquestación `detect`) es de la tarea 5.3 y NO se
 * implementa aquí.
 *
 * Se re-exporta `parseLibraryFolders` desde el parser para que el consumidor del
 * PathDetector tenga una sola puerta de entrada al parseo + selección.
 */

import type { LibraryEntry } from "./types.js";

export { parseLibraryFolders } from "./vdf-parser.js";

/**
 * AppID de Left 4 Dead 2 en Steam. Es la clave que debe estar presente en el
 * bloque `apps` de una biblioteca para considerarla la Game_Library (AC 1.5).
 */
export const L4D2_APP_ID = "550";

/**
 * Selecciona la ruta de la PRIMERA biblioteca (en orden de aparición) cuyo
 * bloque `apps` contiene la clave `550` (L4D2), o `null` si ninguna la contiene
 * (AC 1.5, AC 1.6 / Property 1).
 *
 * La comparación del AppID es EXACTA contra el literal {@link L4D2_APP_ID}
 * ("550"); los AppIDs son numéricos, por lo que el casing no altera el dígito.
 * El orden respetado es el de `entries`, que a su vez preserva el orden de
 * aparición en el archivo (ver `parseLibraryFolders`).
 *
 * @param entries Bibliotecas parseadas, en orden de aparición.
 * @returns El `path` de la primera biblioteca con L4D2, o `null` si ninguna.
 */
export function findGameLibrary(entries: LibraryEntry[]): string | null {
  for (const entry of entries) {
    if (entry.apps.includes(L4D2_APP_ID)) {
      return entry.path;
    }
  }
  return null;
}
