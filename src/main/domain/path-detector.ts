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

import { parseLibraryFolders } from "./vdf-parser.js";
import type {
  GamePaths,
  LibraryEntry,
  PathDetectionFailureReason,
  PathDetectionResult,
  PathVerification,
  RequiredPathKey,
} from "./types.js";

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

// ---------------------------------------------------------------------------
// Tarea 5.3 — I/O de registro + FS + derivación + verificación + orquestación.
// ---------------------------------------------------------------------------

/**
 * Ruta del registro y valor donde Steam publica su ruta de instalación (AC 1.1).
 * Se centralizan como constantes para que el `RegistryReader` real (winreg /
 * `reg query`) y los tests apunten al MISMO hive/key/value sin duplicar literales.
 */
export const STEAM_REGISTRY_HIVE = "HKCU";
export const STEAM_REGISTRY_KEY = "Software\\Valve\\Steam";
export const STEAM_REGISTRY_VALUE = "SteamPath";

/** Separador de disco de Windows, plataforma primaria del proyecto. */
const DISK_SEP = "\\";

/**
 * Segmentos de derivación de rutas (AC 1.8). Se centralizan como literales
 * únicos para que `derivePaths` sea la sola fuente de verdad de la topología.
 */
const L4D2_COMMON_DIR = "steamapps\\common\\Left 4 Dead 2";
const LEFT4DEAD2_SUBDIR = "left4dead2";
const WORKSHOP_SUBPATH = "addons\\workshop";
const VPK_TOOL_SUBPATH = "bin\\vpk.exe";
const GAMEINFO_FILE_NAME = "gameinfo.txt";
const MODSVS_SUBDIR = "modsvs";

/** Ruta del `libraryfolders.vdf` bajo un Steam_Path dado (AC 1.3). */
const LIBRARY_FOLDERS_SUBPATH = "steamapps\\libraryfolders.vdf";

/**
 * Une segmentos de ruta con el separador de disco de Windows (`\`), colapsando
 * un separador sobrante entre segmentos. Se usa un join LITERAL (no `path.join`
 * de Node) por la misma razón documentada para `internalPathToDiskPath` en el
 * historial: `path.join` depende de la plataforma de EJECUCIÓN (usaría `/` en
 * Linux/CI) mientras que las rutas de L4D2 son de Windows por definición. Así el
 * resultado es determinista en cualquier SO (importante para los tests en CI).
 */
function joinWindows(base: string, ...segments: string[]): string {
  let result = base.replace(/[\\/]+$/, "");
  for (const segment of segments) {
    const clean = segment.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
    result = `${result}${DISK_SEP}${clean}`;
  }
  return result;
}

/**
 * Orden canónico de las rutas REQUERIDAS a verificar (AC 1.9). `verifyPathsOnDisk`
 * y `detect` recorren en ESTE orden para que `missing` sea determinista.
 */
const REQUIRED_PATH_KEYS: readonly RequiredPathKey[] = [
  "gameRoot",
  "workshopFolder",
  "vpkToolPath",
  "gameInfoFile",
  "modsvsFolder",
];

// ---------------------------------------------------------------------------
// Dependencias inyectables (patrón CommandRunner de la sección 2)
// ---------------------------------------------------------------------------

/**
 * Abstracción inyectable de la LECTURA del registro de Windows.
 *
 * Por qué se inyecta (igual que `CommandRunner`): el dominio NO debe acoplarse a
 * un módulo concreto (`winreg`, `reg query` vía runner, etc.) ni tocar el
 * registro real en tests. `PathDetector` depende de ESTA interfaz; la
 * implementación real es de una tarea posterior (o un adaptador fino sobre
 * `winreg`/`reg query`), y los tests inyectan un lector en memoria.
 *
 * Contrato: `readValue` resuelve con el string del valor si existe, o `null` si
 * la clave o el valor NO existen (AC 1.2). NO se distingue "clave ausente" de
 * "valor ausente": ambos casos significan lo mismo para el flujo (Steam no
 * detectable por registro → selección manual). Si la lectura fallara por una
 * causa distinta a "no existe" (p. ej. permisos), la implementación real puede
 * resolver `null` también; el efecto para `detect` es el mismo camino de fallo.
 */
export interface RegistryReader {
  readValue(hive: string, key: string, value: string): Promise<string | null>;
}

/**
 * Resultado de intentar leer un archivo de texto del disco. Unión discriminada
 * por `ok` para distinguir "leído" de "no disponible" SIN usar excepciones ni
 * `null` ambiguo: `library-folders-unreadable` (AC 1.4) cubre ausente/ilegible,
 * y el parser cubre "malformado" por separado (un contenido presente pero basura
 * produce `[]` bibliotecas, que `detect` trata como l4d2-not-in-libraries salvo
 * que no haya `550`).
 */
export type FileReadResult =
  | { ok: true; content: string }
  | { ok: false };

/**
 * Abstracción inyectable del acceso al FILESYSTEM que necesita `PathDetector`:
 *
 *  - `readTextFile(path)`: lee el contenido de `libraryfolders.vdf` (AC 1.3).
 *    Devuelve `{ ok: false }` si el archivo está ausente o es ilegible (AC 1.4),
 *    en vez de lanzar, para que `detect` decida el camino de fallo sin try/catch.
 *  - `exists(path)`: verifica la existencia de una ruta en disco (AC 1.9, 1.11).
 *
 * Por qué se inyecta: igual que `RegistryReader` y `CommandRunner`, desacopla el
 * dominio de `node:fs` y hace `verifyPathsOnDisk`/`detect` testeables con un FS
 * en memoria. La implementación real (sobre `fs.promises`) es de una tarea
 * posterior; el dominio solo depende de esta interfaz.
 */
export interface FileSystemProbe {
  readTextFile(path: string): Promise<FileReadResult>;
  exists(path: string): Promise<boolean>;
}

/**
 * Qué ruta se le está pidiendo al usuario en una selección manual. Mapea con los
 * caminos de fallo del Requirement 1:
 *  - `steam-path` (AC 1.2): elegir el Steam_Path.
 *  - `game-root` (AC 1.4, 1.6): elegir el Game_Root cuando `libraryfolders.vdf`
 *    no sirve o ninguna biblioteca tiene `550`.
 *  - una {@link RequiredPathKey}: elegir esa ruta requerida puntual (AC 1.10).
 */
export type ManualPathRequest =
  | { kind: "steam-path" }
  | { kind: "game-root" }
  | { kind: "required-path"; pathKey: RequiredPathKey };

/**
 * Respuesta del usuario a una solicitud de selección manual: la ruta elegida, o
 * una señal de CANCELACIÓN. Unión discriminada (no `string | null`) para que el
 * llamador maneje explícitamente la cancelación (el usuario cerró el diálogo).
 */
export type ManualPathResponse =
  | { kind: "selected"; path: string }
  | { kind: "cancelled" };

/**
 * Proveedor inyectable de SELECCIÓN MANUAL de rutas.
 *
 * Por qué se inyecta: `detect` debe poder pedir una ruta al usuario ante un
 * fallo (AC 1.2, 1.4, 1.6, 1.10) SIN acoplarse a la UI ni a Electron (diálogos
 * `dialog.showOpenDialog`). En producción, el adaptador de UI implementa esta
 * interfaz; en tests, un proveedor programado devuelve rutas o cancelaciones en
 * secuencia. Así `detect` es testeable end-to-end sin ventana.
 *
 * Contrato: `requestPath(request)` resuelve con la ruta elegida o `cancelled`.
 * `detect` SIEMPRE re-verifica en disco la ruta devuelta antes de aceptarla (AC
 * 1.11) y, si no existe, vuelve a solicitarla (AC 1.12) hasta que exista o el
 * usuario cancele.
 */
export interface ManualPathProvider {
  requestPath(request: ManualPathRequest): Promise<ManualPathResponse>;
}

/** Dependencias que recibe {@link PathDetector} por constructor. */
export interface PathDetectorDeps {
  registry: RegistryReader;
  fs: FileSystemProbe;
  manual: ManualPathProvider;
}

// ---------------------------------------------------------------------------
// Constructores del resultado (garantizan el invariante de verificación)
// ---------------------------------------------------------------------------

/**
 * ÚNICO constructor del estado `ready` de {@link PathDetectionResult}
 * ("rutas listas para persistir").
 *
 * INVARIANTE (lo prueba la tarea 5.4 / Property 2): solo produce `ready` si el
 * {@link PathVerification} suministrado tiene `allPresent === true`; en caso
 * contrario devuelve un `needs-manual` con `required-path-missing`, arrastrando
 * la verificación que reveló las faltantes. Como `detect` (y cualquier otro
 * código) NO fabrica el literal `{ kind: "ready", ... }` a mano sino que pasa
 * SIEMPRE por aquí, es imposible llegar a `ready` sin una verificación en disco
 * exitosa: verificar-antes-de-persistir queda garantizado estructuralmente.
 */
export function pathsReady(
  paths: GamePaths,
  verification: PathVerification,
  source: "auto" | "manual",
): PathDetectionResult {
  if (!verification.allPresent) {
    return { kind: "needs-manual", reason: "required-path-missing", paths, verification };
  }
  return { kind: "ready", paths, verification, source };
}

/**
 * PathDetector — orquesta la detección de rutas de Steam/L4D2 (Requirement 1),
 * componiendo el I/O inyectado (registro + FS + selección manual) sobre las
 * funciones puras ya existentes (`parseLibraryFolders`, `findGameLibrary`).
 *
 * Se elige una CLASE con dependencias por constructor (como `VpkTool`): las
 * dependencias son estables durante la vida de la instancia y no ensucian cada
 * método.
 */
export class PathDetector {
  readonly #registry: RegistryReader;
  readonly #fs: FileSystemProbe;
  readonly #manual: ManualPathProvider;

  constructor(deps: PathDetectorDeps) {
    this.#registry = deps.registry;
    this.#fs = deps.fs;
    this.#manual = deps.manual;
  }

  /**
   * Lee `HKCU\Software\Valve\Steam : SteamPath` (AC 1.1). Devuelve el path si
   * existe, o `null` si la clave/valor está ausente (AC 1.2). Un valor de cadena
   * vacía se trata como ausente (`null`), porque un Steam_Path vacío no sirve
   * para derivar la ruta de `libraryfolders.vdf`.
   */
  async readSteamPath(): Promise<string | null> {
    const value = await this.#registry.readValue(
      STEAM_REGISTRY_HIVE,
      STEAM_REGISTRY_KEY,
      STEAM_REGISTRY_VALUE,
    );
    if (value === null || value.trim() === "") {
      return null;
    }
    return value;
  }

  /**
   * Deriva el {@link GamePaths} completo a partir del `path` de la Game_Library y
   * el `steamPath` (AC 1.7, 1.8).
   *
   * CLAVE (AC 1.7): `gameRoot` y todo lo que cuelga de él se derivan del
   * `gameLibrary` (que puede estar en OTRO disco), NUNCA del `steamPath`. El
   * `steamPath` solo se conserva como campo informativo de `GamePaths`.
   */
  derivePaths(gameLibrary: string, steamPath: string): GamePaths {
    const gameRoot = joinWindows(gameLibrary, L4D2_COMMON_DIR);
    const left4dead2Dir = joinWindows(gameRoot, LEFT4DEAD2_SUBDIR);
    return {
      steamPath,
      gameRoot,
      left4dead2Dir,
      workshopFolder: joinWindows(left4dead2Dir, WORKSHOP_SUBPATH),
      vpkToolPath: joinWindows(gameRoot, VPK_TOOL_SUBPATH),
      gameInfoFile: joinWindows(left4dead2Dir, GAMEINFO_FILE_NAME),
      modsvsFolder: joinWindows(gameRoot, MODSVS_SUBDIR),
    };
  }

  /**
   * Verifica en disco CADA ruta requerida (AC 1.9) y produce un
   * {@link PathVerification} con el mapa `present`, la lista `missing` y el
   * derivado `allPresent`. Recorre {@link REQUIRED_PATH_KEYS} en orden para que
   * `missing` sea determinista.
   */
  async verifyPathsOnDisk(paths: GamePaths): Promise<PathVerification> {
    const present = {} as Record<RequiredPathKey, boolean>;
    const missing: RequiredPathKey[] = [];
    for (const key of REQUIRED_PATH_KEYS) {
      const exists = await this.#fs.exists(paths[key]);
      present[key] = exists;
      if (!exists) {
        missing.push(key);
      }
    }
    return { present, missing, allPresent: missing.length === 0 };
  }

  /**
   * Orquesta el flujo completo (AC 1.1–1.12), respetando el sequence diagram del
   * design: registro → `libraryfolders.vdf` → `findGameLibrary` → `derivePaths`
   * → `verifyPathsOnDisk`, ofreciendo selección manual con RE-VERIFICACIÓN ante
   * cada fallo. Devuelve `ready` SOLO vía {@link pathsReady} (invariante de
   * verificación-antes-de-persistir), o `needs-manual` si el usuario cancela.
   */
  async detect(): Promise<PathDetectionResult> {
    // Paso 1-2: Steam_Path por registro, o selección manual (AC 1.1, 1.2).
    let steamPath = await this.readSteamPath();
    let source: "auto" | "manual" = "auto";
    if (steamPath === null) {
      const chosen = await this.#requestExisting({ kind: "steam-path" });
      if (chosen === null) {
        return { kind: "needs-manual", reason: "steam-not-installed" };
      }
      steamPath = chosen;
      source = "manual";
    }

    // Paso 3: leer y parsear libraryfolders.vdf; hallar la Game_Library.
    // Cualquier fallo (archivo ausente/ilegible o ninguna lib con 550) cae a
    // selección manual del Game_Root (AC 1.4, 1.6), desde el cual se derivan las
    // rutas igual que si viniera de la Game_Library.
    const gameLibrary = await this.#resolveGameLibrary(steamPath);
    if (gameLibrary.kind === "manual-root") {
      source = "manual";
      return this.#detectFromGameRoot(gameLibrary.gameRoot, steamPath, source);
    }
    if (gameLibrary.kind === "cancelled") {
      return { kind: "needs-manual", reason: gameLibrary.reason };
    }

    // Paso 4-5: derivar rutas desde la Game_Library y verificar en disco.
    const paths = this.derivePaths(gameLibrary.path, steamPath);
    return this.#verifyThenManual(paths, source);
  }

  // -------------------------------------------------------------------------
  // Helpers privados
  // -------------------------------------------------------------------------

  /**
   * Resuelve la Game_Library a partir del `steamPath`: lee/parsea el VDF y aplica
   * `findGameLibrary`. Si el VDF no sirve (AC 1.4) o ninguna lib tiene 550 (AC
   * 1.6), pide al usuario el Game_Root; si lo da, se usará ese Game_Root para
   * derivar; si cancela, se propaga el motivo de fallo.
   */
  async #resolveGameLibrary(
    steamPath: string,
  ): Promise<
    | { kind: "library"; path: string }
    | { kind: "manual-root"; gameRoot: string }
    | { kind: "cancelled"; reason: PathDetectionFailureReason }
  > {
    const vdfPath = joinWindows(steamPath, LIBRARY_FOLDERS_SUBPATH);
    const read = await this.#fs.readTextFile(vdfPath);

    if (!read.ok) {
      // AC 1.4: VDF ausente/ilegible → selección manual del Game_Root.
      return this.#requestGameRoot("library-folders-unreadable");
    }

    const entries: LibraryEntry[] = parseLibraryFolders(read.content);
    const library = findGameLibrary(entries);
    if (library === null) {
      // AC 1.6: ninguna biblioteca con 550 → selección manual del Game_Root.
      return this.#requestGameRoot("l4d2-not-in-libraries");
    }

    return { kind: "library", path: library };
  }

  /** Pide el Game_Root al usuario, re-verificando existencia (AC 1.11, 1.12). */
  async #requestGameRoot(
    reason: PathDetectionFailureReason,
  ): Promise<
    | { kind: "manual-root"; gameRoot: string }
    | { kind: "cancelled"; reason: PathDetectionFailureReason }
  > {
    const chosen = await this.#requestExisting({ kind: "game-root" });
    if (chosen === null) {
      return { kind: "cancelled", reason };
    }
    return { kind: "manual-root", gameRoot: chosen };
  }

  /**
   * Deriva `GamePaths` cuando el Game_Root vino de selección manual. El usuario
   * eligió directamente el Game_Root (ya re-verificado como existente), así que
   * el resto se deriva relativo a él con la MISMA topología que `derivePaths`,
   * y luego se pasa por la verificación completa (AC 1.9) + selección manual de
   * las que falten.
   */
  async #detectFromGameRoot(
    gameRoot: string,
    steamPath: string,
    source: "auto" | "manual",
  ): Promise<PathDetectionResult> {
    const left4dead2Dir = joinWindows(gameRoot, LEFT4DEAD2_SUBDIR);
    const paths: GamePaths = {
      steamPath,
      gameRoot,
      left4dead2Dir,
      workshopFolder: joinWindows(left4dead2Dir, WORKSHOP_SUBPATH),
      vpkToolPath: joinWindows(gameRoot, VPK_TOOL_SUBPATH),
      gameInfoFile: joinWindows(left4dead2Dir, GAMEINFO_FILE_NAME),
      modsvsFolder: joinWindows(gameRoot, MODSVS_SUBDIR),
    };
    return this.#verifyThenManual(paths, source);
  }

  /**
   * Verifica las rutas requeridas en disco y, por cada faltante, pide selección
   * manual re-verificando (AC 1.10–1.12). Solo devuelve `ready` (vía
   * {@link pathsReady}) cuando TODAS las rutas requeridas existen; si el usuario
   * cancela una faltante, devuelve `needs-manual` (required-path-missing) con la
   * verificación vigente.
   */
  async #verifyThenManual(
    initialPaths: GamePaths,
    source: "auto" | "manual",
  ): Promise<PathDetectionResult> {
    let paths = initialPaths;
    let verification = await this.verifyPathsOnDisk(paths);
    let effectiveSource = source;

    while (!verification.allPresent) {
      // Tomamos la primera faltante (orden canónico) y la pedimos manualmente.
      const pathKey = verification.missing[0];
      if (pathKey === undefined) {
        break;
      }
      const chosen = await this.#requestExisting({ kind: "required-path", pathKey });
      if (chosen === null) {
        // Usuario canceló: no hay forma de completar → needs-manual.
        return {
          kind: "needs-manual",
          reason: "required-path-missing",
          paths,
          verification,
        };
      }
      // Una ruta suplida manualmente marca el resultado como manual.
      effectiveSource = "manual";
      paths = { ...paths, [pathKey]: chosen };
      // AC 1.11: re-verificar TODO el conjunto tras la selección manual.
      verification = await this.verifyPathsOnDisk(paths);
    }

    // allPresent === true garantizado aquí; pathsReady lo revalida (invariante).
    return pathsReady(paths, verification, effectiveSource);
  }

  /**
   * Pide una ruta al usuario y NO la acepta hasta que exista en disco (AC 1.11,
   * 1.12): si la ruta elegida no existe, informa implícitamente volviendo a
   * solicitarla (bucle) hasta que exista o el usuario cancele. Devuelve la ruta
   * existente elegida, o `null` si el usuario canceló.
   */
  async #requestExisting(request: ManualPathRequest): Promise<string | null> {
    for (;;) {
      const response = await this.#manual.requestPath(request);
      if (response.kind === "cancelled") {
        return null;
      }
      const exists = await this.#fs.exists(response.path);
      if (exists) {
        return response.path;
      }
      // AC 1.12: no existe → se vuelve a solicitar (siguiente iteración).
    }
  }
}
