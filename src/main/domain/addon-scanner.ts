/**
 * AddonScanner — escaneo de la Workshop_Folder (Tarea 6.1, Requirement 2).
 *
 * Recorre la Workshop_Folder y produce la lista de {@link ScannedAddon}
 * detectados. Reglas (AC 2.1–2.6):
 *
 *   - Incluye ÚNICAMENTE archivos con extensión `.vpk` ubicados DIRECTAMENTE en
 *     la carpeta (nivel superior); ignora subdirectorios y otras extensiones
 *     (AC 2.1, 2.2).
 *   - Trata `<id>.vpk` como Addon con identificador `<id>` (nombre sin la
 *     extensión) (AC 2.3).
 *   - Asocia como Addon_Cover el archivo `<id>.jpg` presente en la MISMA carpeta
 *     que el `<id>.vpk`; `null` si no existe (AC 2.4).
 *   - Lee, de forma OPCIONAL y NO bloqueante, la metadata del `addoninfo.txt`
 *     interno del VPK (AC 2.5). Cualquier fallo en esta fase degrada a
 *     `info: null` SIN abortar ni omitir el addon.
 *   - Lee, también best-effort, `mtimeMs`/`sizeBytes` del `.vpk` vía `fs.stat`
 *     (P-31, Paso 1 — datos de ORDENAMIENTO para Biblioteca; el ordenamiento
 *     en sí vive en el renderer, acá solo se provee el dato).
 *   - Al finalizar, devuelve la lista de addons con su cover asociado (AC 2.6).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 1 — Interfaz de FS PROPIA ({@link AddonFileSystem}), no reutilizar la
 * de la sección 5 (PathDetector / `FileSystemProbe`).
 *
 * AddonScanner define su PROPIO contrato de FS inyectable en vez de depender del
 * `FileSystemProbe` de PathDetector (que en esta rama NO está mergeado).
 * Motivo: CONTRIBUTING.md exige que cada rama parta de main actualizada y el
 * checkpoint de la tarea 9 agrupa deliberadamente las secciones 6+7+8; mergear
 * PathDetector antes de tiempo solo para evitar la duplicación rompería esa
 * disciplina de ramas. La duplicación de un contrato de FS pequeño es un costo
 * ACEPTADO conscientemente: todavía no hay suficientes consumidores
 * (PathDetector, AddonScanner y probablemente VScriptDetector en la sección 7)
 * como para saber qué forma debería tener una interfaz de FS común.
 *
 * A revisar (nota explícita): una vez existan PathDetector + AddonScanner +
 * VScriptDetector, evaluar si conviene UNIFICAR las interfaces de FS. Prioridad
 * MENOR que reconciliar los parsers de addoninfo (ver `addoninfo-extract.ts`).
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 2 — Lectura del `addoninfo.txt` vía {@link VpkTool} (extracción
 * SELECTIVA), NO lectura de disco directa. El `addoninfo.txt` vive DENTRO del
 * `<id>.vpk`; el flujo es:
 *   1. `vpkTool.list(vpkPath, id)` para obtener los paths internos (con `/`,
 *      ruido ya filtrado). Se busca uno cuyo BASENAME sea `addoninfo.txt`
 *      (case-insensitive). Si no aparece ⇒ `info: null`, sin extraer nada.
 *   2. Si existe, `vpkTool.extract(vpkPath, [ese path], destDir, id)` extrae SOLO
 *      ese archivo a un directorio temporal (extract acepta una LISTA; pasar uno
 *      solo extrae solo ese). `addoninfo.txt` va en la raíz del VPK, así que no
 *      hay subdirectorio que crear, pero igual se asegura el `destDir`.
 *   3. Se lee el archivo extraído con el FS inyectado y se parsea con el
 *      extractor ad-hoc {@link extractAddonInfo} (ver DECISIÓN 3 en su módulo).
 *
 * `VpkTool` se INYECTA en el constructor (igual que el `CommandRunner`/`vpkExe`
 * en el propio `VpkTool`).
 * ---------------------------------------------------------------------------
 *
 * CONFIRMACIÓN CRÍTICA (AC 2.5) — el fallo de addoninfo NO bloquea el escaneo.
 * TODA la fase de metadata (list, extract, lectura, parseo) va envuelta en un
 * try/catch por-addon: cualquier fallo —addoninfo ausente del listado, `vpk l` /
 * `vpk x` con exit ≠ 0 ({@link VpkToolError}), error de lectura del FS, texto
 * malformado— degrada a `info: null` SIN abortar el escaneo ni omitir el addon.
 * El addon SIEMPRE se lista con su `id`, `vpkPath` y `coverPath` correctos; solo
 * queda sin metadata. La lista de `.vpk` (AC 2.1–2.3) y la asociación de cover
 * (AC 2.4) NO dependen del addoninfo.
 */

import { COVER_EXTENSION } from "./addon-cover.js";
import { extractAddonInfo } from "./addoninfo-extract.js";
import type { AddonInfo, ScannedAddon } from "./types.js";
import { DEFAULT_VPK_CONCURRENCY } from "./vpk-tool.js";
import type { VpkTool } from "./vpk-tool.js";

/** Nombre interno (basename) del archivo de metadata dentro del VPK. */
const ADDONINFO_BASENAME = "addoninfo.txt";
/** Extensión (con punto) de los archivos de addon. */
const VPK_EXTENSION = ".vpk";

/**
 * Una entrada de directorio, con su nombre y si es un directorio.
 *
 * Se modela el listado como entradas que distinguen archivo de subdirectorio
 * (en vez de dos métodos separados) porque el escaneo necesita, en una sola
 * pasada, (a) quedarse con los `.vpk` de nivel superior y (b) descartar los
 * subdirectorios (AC 2.1, 2.2). `name` es SOLO el nombre de la entrada (basename),
 * no una ruta completa.
 */
export interface DirEntry {
  /** Nombre de la entrada (basename), sin la ruta del directorio contenedor. */
  name: string;
  /** `true` si la entrada es un directorio; `false` si es un archivo. */
  isDirectory: boolean;
}

/**
 * Contrato de FS inyectable PROPIO de AddonScanner (ver DECISIÓN 1). Reúne las
 * operaciones mínimas que el escaneo necesita. Documentado al estilo del
 * `CommandRunner` de `vpk-tool.ts`: es un puerto neutro que se implementa con
 * `node:fs/promises` en producción y con un doble en memoria en los tests.
 *
 * Todas las rutas son absolutas en formato del sistema anfitrión (Windows en el
 * caso primario). El contrato NO impone codificación de texto: `readTextFile`
 * devuelve el contenido ya decodificado como string (UTF-8 en la implementación
 * real).
 */
export interface AddonFileSystem {
  /**
   * Lista las ENTRADAS directas de `dir`, distinguiendo archivo de directorio.
   * No es recursivo: devuelve solo el nivel superior. Si `dir` no existe o no se
   * puede leer, la implementación decide (típicamente rechaza); AddonScanner no
   * captura ese fallo porque sin el listado no hay escaneo posible.
   */
  listEntries(dir: string): Promise<DirEntry[]>;

  /**
   * Indica si existe una ruta (archivo o directorio) en disco. Se usa para
   * resolver la presencia del `<id>.jpg` (AC 2.4). No debe lanzar por "no
   * existe": devuelve `false` en ese caso.
   */
  exists(path: string): Promise<boolean>;

  /** Lee un archivo de texto y devuelve su contenido decodificado (UTF-8). */
  readTextFile(path: string): Promise<string>;

  /**
   * Asegura que exista un directorio (lo crea recursivamente si hace falta). Se
   * usa para preparar el `destDir` temporal de extracción del `addoninfo.txt`.
   * Idempotente: no falla si el directorio ya existe.
   */
  ensureDir(dir: string): Promise<void>;

  /**
   * `fs.stat` de un archivo (P-31, Paso 1: mtime/tamaño del `.vpk`, datos de
   * ORDENAMIENTO para Biblioteca — metadata de filesystem, no requiere
   * `vpk.exe`). Puede lanzar (archivo inexistente/ilegible); `AddonScanner`
   * la envuelve en el mismo try/catch best-effort que ya usa para el
   * addoninfo (AC 2.5).
   */
  stat(path: string): Promise<{ mtimeMs: number; size: number }>;
}

/**
 * Une un directorio y un nombre de entrada con el separador de Windows.
 *
 * Se usa el literal `\\` (no `path.join`) por coherencia con el resto del
 * dominio, que fija Windows como plataforma primaria de las rutas de disco (ver
 * la decisión de separadores de `vpk-path.ts`). Se normaliza para no duplicar el
 * separador si `dir` ya termina en `\` o `/`.
 */
function joinWindowsPath(dir: string, name: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  return `${trimmed}\\${name}`;
}

/**
 * Deriva el `<id>` de un nombre de archivo `<id>.vpk`, quitando la extensión
 * `.vpk` (case-insensitive). Devuelve `null` si el nombre no es un `.vpk` de
 * nivel superior válido (extensión distinta o nombre vacío tras quitarla).
 */
function addonIdFromVpkName(fileName: string): string | null {
  if (fileName.length <= VPK_EXTENSION.length) {
    return null;
  }
  const suffix = fileName.slice(-VPK_EXTENSION.length);
  if (suffix.toLowerCase() !== VPK_EXTENSION) {
    return null;
  }
  return fileName.slice(0, fileName.length - VPK_EXTENSION.length);
}

/**
 * Escáner de la Workshop_Folder. Depende de un {@link AddonFileSystem} (I/O de
 * disco) y de un {@link VpkTool} (lectura del `addoninfo.txt` interno), ambos
 * inyectados por constructor para ser testeable sin disco ni `vpk.exe` reales.
 */
export class AddonScanner {
  readonly #fs: AddonFileSystem;
  readonly #vpkTool: VpkTool;
  /** Directorio base donde se extraen temporalmente los `addoninfo.txt`. */
  readonly #tempDir: string;

  /**
   * @param fs FS inyectado para listar entradas, comprobar existencia, leer
   *   texto y crear directorios.
   * @param vpkTool Herramienta para listar/extraer el `addoninfo.txt` interno.
   * @param tempDir Directorio base para la extracción temporal del addoninfo.
   *   Se crea bajo demanda un subdirectorio por addon.
   */
  constructor(fs: AddonFileSystem, vpkTool: VpkTool, tempDir: string) {
    this.#fs = fs;
    this.#vpkTool = vpkTool;
    this.#tempDir = tempDir;
  }

  /**
   * Escanea `workshopFolder` y devuelve los addons detectados (AC 2.1–2.6).
   *
   * El orden del resultado sigue el orden en que el FS listó las entradas.
   *
   * ---------------------------------------------------------------------------
   * BUG-006 — el escaneo se ejecuta con CONCURRENCIA ACOTADA (no serial). El
   * recorrido se hace en DOS FASES para bajar la latencia sin cambiar QUÉ
   * produce el escaneo (mismo resultado, mismo orden, misma metadata que el
   * escaneo serial de referencia):
   *
   *   FASE 1 — recolección secuencial de CANDIDATOS (barata, SIN `vpk.exe`):
   *     recorre `entries` EN ORDEN y se queda solo con los `.vpk` de nivel
   *     superior (AC 2.1/2.2), derivando lo barato y determinista `{ id, vpkPath }`.
   *     Las entradas ignoradas (subdirectorios y no-`.vpk`) NO ocupan lugar, así
   *     que el ÍNDICE de cada candidato ES su posición final en el resultado. El
   *     `filter/map` preserva el orden de `entries`, idéntico al del recorrido
   *     serial anterior.
   *
   *   FASE 2 — llenado PARALELO con concurrencia ACOTADA (pool INLINE):
   *     replica el patrón de `classifyWithBoundedConcurrency` (ipc-handlers.ts) y
   *     de `MergeEngine.preview`: un array `results` de longitud
   *     `candidates.length`, un CURSOR compartido y hasta
   *     `DEFAULT_VPK_CONCURRENCY` (vpk-tool.ts, única fuente del tamaño de pool)
   *     workers. Cada worker toma `index = cursor++`, corta al salir de rango,
   *     procesa `#resolveCover` + `#readAddonInfoSafely` (que NO cambian) y
   *     escribe en `results[index]`. La escritura POR ÍNDICE (posición original)
   *     garantiza que el orden del resultado sea el del listado del directorio,
   *     independiente del orden en que terminen los workers. Nunca hay más de
   *     `DEFAULT_VPK_CONCURRENCY` invocaciones `vpk.exe` en vuelo a la vez.
   *
   * El manejo de errores best-effort por-addon es INALTERADO: `#readAddonInfoSafely`
   * conserva su try/catch → `null` y `#resolveCover` usa `fs.exists` no-lanzante,
   * así que ningún worker propaga una excepción que rompa el `Promise.all` durante
   * el escaneo normal (AC 2.5). El único rechazo posible sigue siendo el de
   * `listEntries` (Fase 1, fuera del pool): sin listado no hay escaneo.
   * ---------------------------------------------------------------------------
   */
  async scan(workshopFolder: string): Promise<ScannedAddon[]> {
    const entries = await this.#fs.listEntries(workshopFolder);

    // FASE 1 — candidatos en orden (barata, sin vpk.exe). El índice del
    // candidato ES su posición final en el resultado (los ignorados no ocupan
    // lugar), preservando el orden del listado (AC 2.1/2.2).
    const candidates = entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => ({ entry, id: addonIdFromVpkName(entry.name) }))
      .filter((candidate): candidate is { entry: DirEntry; id: string } => candidate.id !== null)
      .map((candidate) => ({
        id: candidate.id,
        vpkPath: joinWindowsPath(workshopFolder, candidate.entry.name),
      }));

    // FASE 2 — pool INLINE acotado que escribe por índice (orden preservado).
    const results: ScannedAddon[] = new Array<ScannedAddon>(candidates.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor++;
        const candidate = candidates[index];
        // noUncheckedIndexedAccess: candidate es {…} | undefined; el undefined
        // solo ocurre cuando index salió de rango → fin del worker.
        if (candidate === undefined) {
          return;
        }
        const coverPath = await this.#resolveCover(workshopFolder, candidate.id);
        const info = await this.#readAddonInfoSafely(candidate.vpkPath, candidate.id);
        const { mtimeMs, sizeBytes } = await this.#resolveFileStat(candidate.vpkPath);
        // AC 2.3/2.4: addon con id derivado, vpkPath y cover asociado (o null).
        results[index] = {
          id: candidate.id,
          vpkPath: candidate.vpkPath,
          coverPath,
          info,
          mtimeMs,
          sizeBytes,
        };
      }
    };

    const poolSize = Math.min(DEFAULT_VPK_CONCURRENCY, candidates.length);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));

    return results;
  }

  /**
   * Resuelve el Addon_Cover de un addon: ruta de `<id>.jpg` en la MISMA carpeta
   * que el VPK si existe, `null` si no (AC 2.4).
   */
  async #resolveCover(workshopFolder: string, id: string): Promise<string | null> {
    const coverPath = joinWindowsPath(workshopFolder, `${id}${COVER_EXTENSION}`);
    const present = await this.#fs.exists(coverPath);
    return present ? coverPath : null;
  }

  /**
   * `mtimeMs`/`sizeBytes` del `.vpk` (P-31, Paso 1), BEST-EFFORT: mismo
   * criterio que `#readAddonInfoSafely` (AC 2.5) — cualquier fallo del `stat`
   * (ventana muy chica entre listar el directorio y leerlo) degrada a `{ 0, 0
   * }` sin abortar ni omitir el addon. `0` nunca es un valor real para un
   * archivo que SÍ existe, así que un consumidor de la UI puede distinguir
   * "degradado" de "vacío" si algún día le importa.
   */
  async #resolveFileStat(vpkPath: string): Promise<{ mtimeMs: number; sizeBytes: number }> {
    try {
      const stats = await this.#fs.stat(vpkPath);
      return { mtimeMs: stats.mtimeMs, sizeBytes: stats.size };
    } catch {
      return { mtimeMs: 0, sizeBytes: 0 };
    }
  }

  /**
   * Lee la metadata del `addoninfo.txt` interno del VPK, de forma BEST-EFFORT y
   * NO bloqueante (AC 2.5). Devuelve el {@link AddonInfo} parseado o `null` ante
   * CUALQUIER fallo: addoninfo ausente del listado, `vpk l`/`vpk x` con exit ≠ 0
   * ({@link VpkToolError}), error de lectura del FS o texto malformado.
   *
   * TODA la fase va envuelta en un try/catch para garantizar que un throw de
   * VpkTool (u otro) NUNCA propague y aborte el escaneo del addon.
   */
  async #readAddonInfoSafely(vpkPath: string, id: string): Promise<AddonInfo | null> {
    try {
      // 1) Listar el VPK y localizar el path interno del addoninfo.txt.
      const internalPaths = await this.#vpkTool.list(vpkPath, id);
      const addoninfoInternalPath = internalPaths.find(
        (p) => basenameOf(p).toLowerCase() === ADDONINFO_BASENAME,
      );
      if (addoninfoInternalPath === undefined) {
        // No hay addoninfo en el VPK: sin metadata, pero el addon igual se lista.
        return null;
      }

      // 2) Extraer SOLO ese path a un destino temporal por addon.
      const destDir = joinWindowsPath(this.#tempDir, id);
      await this.#fs.ensureDir(destDir);
      await this.#vpkTool.extract(vpkPath, [addoninfoInternalPath], destDir, id);

      // 3) Leer el archivo extraído (respetando su path interno con `/` → `\`) y
      // parsearlo con el extractor ad-hoc. `vpk x` escribe relativo a destDir
      // reproduciendo la estructura interna; addoninfo.txt suele ir en la raíz.
      const extractedPath = joinWindowsPath(destDir, internalToDiskRelative(addoninfoInternalPath));
      const text = await this.#fs.readTextFile(extractedPath);
      return extractAddonInfo(text);
    } catch {
      // AC 2.5: cualquier fallo de la fase de metadata degrada a null sin
      // abortar ni omitir el addon.
      return null;
    }
  }
}

/**
 * Basename de un path interno de VPK (separador `/`). Devuelve el último
 * segmento; si no hay `/`, devuelve el path completo.
 */
function basenameOf(internalPath: string): string {
  const slash = internalPath.lastIndexOf("/");
  return slash === -1 ? internalPath : internalPath.slice(slash + 1);
}

/**
 * Convierte un path interno de VPK (`/`) al path RELATIVO de disco de Windows
 * (`\`) con el que quedó escrito bajo `destDir` tras `vpk x`. Solo traduce el
 * separador; no antepone `destDir` (eso lo hace el llamador con `joinWindowsPath`).
 */
function internalToDiskRelative(internalPath: string): string {
  return internalPath.replace(/\//g, "\\");
}
