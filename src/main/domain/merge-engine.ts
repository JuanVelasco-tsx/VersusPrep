/**
 * MergeEngine — núcleo de la fusión de addons (Tarea 11.1, Requirement 6).
 *
 * Orquesta el flujo completo de fusión descrito en el diseño (sección
 * "MergeEngine") y en el diagrama de secuencia 3:
 *
 *   1. Para CADA addon (en Priority_Order ASCENDENTE):
 *        a. `VpkTool.list(vpk)`  → paths internos (con `/`, ruido ya filtrado).
 *        b. Crear los SUBDIRECTORIOS de destino bajo `<workDir>\extract\<addonId>\`
 *           ANTES de extraer (AC 6.3: `vpk x` NO crea carpetas).
 *        c. `VpkTool.extract(vpk, paths, destDir)` POR LOTES (el batching ya lo
 *           hace VpkTool internamente).
 *   2. Delegar en `CollisionResolver.mergeInto(pak01_dir, extraídos ascendente)`
 *      la fusión "el último gana" (AC 6.7 / Requirement 7).
 *   3. `VpkTool.pack(pak01_dir)` → genera `pak01_dir.vpk` (AC 6.8) y se devuelve
 *      su ruta.
 *
 * Si `list` o `extract` de un addon devuelven exit ≠ éxito, `VpkTool` lanza un
 * {@link VpkToolError} que YA identifica el addon; MergeEngine deja PROPAGAR ese
 * error tal cual y ABORTA: no procesa los addons restantes ni ejecuta la fusión
 * ni el empaquetado (AC 6.8, 6.12). Ver DECISIÓN 4.
 *
 * Estructura de trabajo en disco (design.md):
 *
 *   <workDir>\
 *     extract\<addonId>\...   # contenido extraído por addon (paths con `\`)
 *     pak01_dir\...           # contenido fusionado (lo escribe CollisionResolver)
 *     pak01_dir.vpk           # Merged_Package generado por `vpk pack`
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 1 — Derivación de los subdirectorios a crear antes de extraer
 * (AC 6.3, punto de diseño 1).
 *
 * `VpkTool.extract` NO crea carpetas; MergeEngine debe crearlas antes, con
 * `destDir` como working directory de la extracción. De cada path interno (con
 * `/`) se toma su DIRECTORIO PADRE (todo lo anterior al último `/`); los archivos
 * en la raíz del VPK (sin `/`) no aportan subdirectorio. Ese conjunto de
 * directorios padre se DEDUPLICA (varios archivos comparten carpeta) y cada uno
 * se traduce a separador de Windows con {@link internalPathToDiskPath} (`/`→`\`)
 * y se une al `destDir` del addon con el join de Windows del dominio. Se crea
 * SIEMPRE el `destDir` base del addon (aunque el VPK solo tenga archivos en la
 * raíz), porque `vpk x` lo usa como cwd y debe existir.
 *
 * Solo se crean los directorios padre (no una entrada por archivo): `ensureDir`
 * es recursivo e idempotente, así que crear el padre alcanza para que la
 * extracción del archivo tenga dónde escribir. No hace falta ordenar el set:
 * al ser recursivo, crear `a\b\c` crea también `a\b` y `a`.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 2 — FS inyectado PROPIO mínimo ({@link MergeFileSystem}) + el
 * CollisionResolver se RECIBE ya construido (punto de diseño 2).
 *
 * Coherente con la DECISIÓN 1 de `addon-scanner.ts` / `collision-resolver.ts`:
 * cada componente de dominio define su PROPIO contrato de FS inyectable, con las
 * operaciones MÍNIMAS que necesita. MergeEngine solo necesita CREAR directorios
 * (el árbol `extract\<addonId>` y `pak01_dir`); NO recorre ni copia archivos —de
 * eso se encarga `CollisionResolver` con SU propio `CollisionFileSystem`. Por eso
 * {@link MergeFileSystem} expone únicamente `ensureDir`.
 *
 * Sobre quién construye el `CollisionResolver`: se OPTÓ por RECIBIRLO ya
 * construido por inyección (en vez de que MergeEngine lo instancie internamente
 * con un adaptador de su propio FS). Motivos:
 *   - Testabilidad: en los unit tests (tarea 11.2) MergeEngine puede recibir un
 *     doble de `CollisionResolver` que registre la llamada a `mergeInto` (destDir
 *     y roots en orden) SIN tener que implementar `walk`/`copyFile` en memoria.
 *     Así el test de MergeEngine verifica SU responsabilidad (orden del flujo,
 *     creación de dirs, aborto) aislada de la lógica de colisiones, que ya tiene
 *     sus propios tests (10.1/10.3).
 *   - Separación de responsabilidades y de FS: el `CollisionFileSystem` (walk +
 *     ensureDir + copyFile) es DISTINTO del `MergeFileSystem` (solo ensureDir);
 *     no tiene sentido que MergeEngine construya un adaptador para un FS que no
 *     es suyo. El wiring (crear el `CollisionResolver` con su FS real de
 *     `node:fs/promises`) es responsabilidad de la capa de composición
 *     (orquestador, tarea 18), no del núcleo de fusión.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 3 — `VpkTool` inyectado por constructor (punto de diseño 3).
 *
 * `VpkTool` es una dependencia ESTABLE de la instancia (igual que en
 * AddonScanner): se inyecta una sola vez por constructor, junto con el
 * {@link MergeFileSystem} y el {@link CollisionResolver}. Se elige una CLASE para
 * mantener las dependencias como estado privado inmutable y exponer `merge` tal
 * como fija la interfaz de diseño.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 4 — Orden ascendente y aborto por propagación (AC 6.8, 6.12; punto de
 * diseño 4).
 *
 * Se respeta el orden ASCENDENTE de `orderedAddons` en TODO el flujo: la fase de
 * extracción itera en ese orden y los {@link ExtractedRoot} se pasan a
 * `mergeInto` en el MISMO orden (para que "el último gana" aplique bien). Si una
 * operación de `VpkTool` falla, su {@link VpkToolError} —que ya lleva el
 * `addonId`, la `operation` y el `exitCode`— se deja PROPAGAR sin re-envolver
 * (no aporta información re-envolverlo; el error ya identifica el addon, tal como
 * indica la consigna). Como el flujo es secuencial (`for ... await`), un throw
 * en un addon corta el bucle: NO se listan/extraen los addons siguientes ni se
 * llega a `mergeInto`/`pack`. El orquestador (tarea 18) traduce ese error a un
 * `OperationResult { ok: false, addonId }` para la UI.
 *
 * NOTA (pendiente P-14, ver `Context/02-pendientes.md`): si `merge` aborta a
 * mitad, los directorios/archivos ya creados bajo `<workDir>\extract` y
 * `pak01_dir` NO se limpian hoy. La limpieza del workDir tras un abort queda
 * como responsabilidad futura del orquestador (tarea 18) o de quien invoque
 * MergeEngine; no la resuelve este núcleo.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 5 — Rutas de trabajo con separador de Windows literal (punto de
 * diseño 5).
 *
 * `extract\<addonId>`, `pak01_dir` y el resultado de `pack` se derivan uniendo
 * con el separador de Windows literal (`\`), NO con `path.join` de Node (el
 * historial documenta por qué: determinismo e independencia del SO donde corran
 * los tests; `path.join` normaliza según la plataforma anfitriona). Se reutiliza
 * el mismo criterio que `vpk-path.ts` / `collision-resolver.ts` / `addon-scanner.ts`.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 6 — DIVERGENCIA CONSCIENTE de la firma de `merge` respecto de
 * design.md: devuelve `{ vpkPath, report }`, NO `Promise<string>`.
 *
 * La interfaz original de design.md (sección "MergeEngine") especifica
 * `merge(...): Promise<string>` (solo la ruta del `.vpk`). Se detectó que esa
 * firma DESCARTABA silenciosamente el {@link MergeReport} que
 * `CollisionResolver.mergeInto` calcula, pese a que el Requirement 7.1 y el
 * propio design.md dicen que el MergeReport existe "para que la UI pueda avisar
 * las colisiones". El tipo `OperationResult` (tipo de dominio de la tarea 1) ya
 * reserva `report?: MergeReport` para eso, pero con la firma `Promise<string>`
 * el dato NUNCA podría llegar hasta el orquestador (tarea 18): se perdía en el
 * `await ...mergeInto(...)` sin asignar.
 *
 * Por eso la firma REAL diverge del documento: devuelve
 * `Promise<{ vpkPath: string; report: MergeReport }>` en vez de `Promise<string>`.
 * `vpkPath` es la ruta del `pak01_dir.vpk`; `report` se nombró así (no
 * `mergeReport` ni `collisions`) para ALINEAR con `OperationResult.report`, de
 * modo que el orquestador de la tarea 18 pueda pasar el `report` casi directo.
 *
 * Esto es una DIVERGENCIA CONSCIENTE respecto de la interfaz publicada en
 * design.md, registrada en `Context/04-historial-decisiones.md`. Quien lea
 * design.md NO debe asumir que el contrato sigue siendo `Promise<string>`.
 *
 * De paso queda documentado (ver también la Fase 3 de `merge`) que el literal
 * `"pak01_dir"` (`PAK01_DIR_NAME`) usado como `addonId` en `pack()` es
 * DELIBERADO: `pack` opera sobre el paquete FUSIONADO, no sobre un addon de
 * origen; no hay addonId real, así que se usa esa etiqueta para que un eventual
 * `VpkToolError` de esa fase identifique claramente el empaquetado del paquete
 * fusionado y no atribuya el fallo a un addon inexistente.
 * ---------------------------------------------------------------------------
 */

import type { CollisionResolver } from "./collision-resolver.js";
import type { ExtractedRoot, GamePaths, MergeReport, ScannedAddon } from "./types.js";
import { DISK_SEPARATOR, internalPathToDiskPath } from "./vpk-path.js";
import type { VpkTool } from "./vpk-tool.js";

/** Separador de path INTERNO del VPK (`/`), coherente con `vpk-path.ts`. */
const VPK_INTERNAL_SEPARATOR = "/";

/** Nombre del subdirectorio de trabajo donde se extrae cada addon. */
const EXTRACT_SUBDIR = "extract";

/** Nombre de la carpeta de fusión y base del Merged_Package generado. */
const PAK01_DIR_NAME = "pak01_dir";

/**
 * Contrato de FS inyectable PROPIO de MergeEngine (ver DECISIÓN 2). Reúne la
 * ÚNICA operación de I/O que el núcleo de fusión necesita: crear directorios.
 * El recorrido y la copia de archivos NO están aquí; son responsabilidad del
 * {@link CollisionResolver} y de su propio `CollisionFileSystem`.
 *
 * Es un puerto neutro que en producción se implementa con `node:fs/promises` y
 * en los tests con un doble en memoria (tarea 11.2). Todas las rutas son
 * absolutas en formato del sistema anfitrión (Windows en el caso primario).
 */
export interface MergeFileSystem {
  /**
   * Asegura que exista un directorio (lo crea recursivamente si hace falta).
   * Idempotente: no falla si ya existe. Se usa para crear el `destDir` base de
   * cada addon y los subdirectorios de destino antes de la extracción.
   */
  ensureDir(dir: string): Promise<void>;
}

/**
 * Une un directorio y un segmento relativo con el separador de Windows.
 *
 * Se usa el literal `\` (no `path.join`) por coherencia con el resto del dominio
 * (ver `vpk-path.ts` / `collision-resolver.ts` / `addon-scanner.ts`), que fija
 * Windows como plataforma primaria de las rutas de disco. Se recorta el
 * separador final de `dir` para no duplicarlo; `segment` puede venir con `/` o
 * `\` y se normaliza a `\` (sin separador líder).
 */
function joinWindowsPath(dir: string, segment: string): string {
  const trimmedDir = dir.replace(/[\\/]+$/, "");
  const diskSegment = segment.replace(/\//g, DISK_SEPARATOR).replace(/^[\\/]+/, "");
  return `${trimmedDir}${DISK_SEPARATOR}${diskSegment}`;
}

/**
 * Directorio padre de un path INTERNO del VPK (separador `/`). Devuelve `null`
 * si el path no tiene `/` (archivo en la raíz del VPK: no aporta subdirectorio
 * que crear). El resultado conserva el separador interno `/`; la traducción a
 * `\` la hace el llamador con {@link internalPathToDiskPath}.
 */
function internalParentDir(internalPath: string): string | null {
  const slash = internalPath.lastIndexOf(VPK_INTERNAL_SEPARATOR);
  return slash === -1 ? null : internalPath.slice(0, slash);
}

/**
 * MergeEngine — orquesta list → crear dirs → extraer por lotes → fusionar →
 * empaquetar. Depende de un {@link VpkTool} (única puerta a `vpk.exe`), un
 * {@link MergeFileSystem} (crear directorios) y un {@link CollisionResolver}
 * (fusión "el último gana"), todos inyectados por constructor para ser testeable
 * sin `vpk.exe` ni disco reales (tarea 11.2).
 */
export class MergeEngine {
  readonly #vpkTool: VpkTool;
  readonly #fs: MergeFileSystem;
  readonly #collisionResolver: CollisionResolver;

  /**
   * @param vpkTool Herramienta para `list`/`extract`/`pack` (dependencia estable).
   * @param fs FS inyectado para crear directorios de trabajo.
   * @param collisionResolver Resolvedor de colisiones ya construido (con su
   *   propio `CollisionFileSystem`); ver DECISIÓN 2.
   */
  constructor(vpkTool: VpkTool, fs: MergeFileSystem, collisionResolver: CollisionResolver) {
    this.#vpkTool = vpkTool;
    this.#fs = fs;
    this.#collisionResolver = collisionResolver;
  }

  /**
   * Fusiona `orderedAddons` (en Priority_Order ASCENDENTE) y devuelve la ruta del
   * `pak01_dir.vpk` generado JUNTO CON el {@link MergeReport} de colisiones
   * (AC 6.3, 6.7, 6.8, 6.12). Ver DECISIÓN 6 sobre por qué el retorno diverge de
   * la firma `Promise<string>` publicada en design.md.
   *
   * @param orderedAddons Addons a fusionar, en Priority_Order ASCENDENTE (el
   *   último gana en las colisiones).
   * @param _paths Rutas del juego. No se consume en esta fase (la instalación en
   *   `modsvs/` y el `gameinfo.txt` son responsabilidad del orquestador, tarea
   *   18); se mantiene en la firma por fidelidad al contrato de diseño y para no
   *   romper a los llamadores cuando esa fase se conecte.
   * @param workDir Carpeta temporal de trabajo (contiene `extract\` y `pak01_dir`).
   * @returns `{ vpkPath, report }`: `vpkPath` es la ruta del `pak01_dir.vpk`
   *   (Merged_Package) generado por `vpk pack`; `report` es el {@link MergeReport}
   *   con las colisiones detectadas por `CollisionResolver.mergeInto`. Se nombra
   *   `report` para alinear con `OperationResult.report`, que el orquestador
   *   (tarea 18) espera poblar. Ver DECISIÓN 6.
   */
  async merge(
    orderedAddons: readonly ScannedAddon[],
    _paths: GamePaths,
    workDir: string,
  ): Promise<{ vpkPath: string; report: MergeReport }> {
    // Fase 1 — Por cada addon (orden ASCENDENTE): list → crear dirs → extract.
    // Se arma en paralelo la lista de ExtractedRoot en el MISMO orden para la
    // fusión. Un throw de VpkTool (list/extract) corta el bucle y aborta (AC 6.12).
    const extractedRoots: ExtractedRoot[] = [];
    const extractBaseDir = joinWindowsPath(workDir, EXTRACT_SUBDIR);
    for (const addon of orderedAddons) {
      const destDir = joinWindowsPath(extractBaseDir, addon.id);
      await this.#extractAddon(addon, destDir);
      extractedRoots.push({ addonId: addon.id, rootDir: destDir });
    }

    // Fase 2 — Fusión "el último gana" en pak01_dir/ (delegada; AC 6.7). Se
    // CAPTURA el MergeReport que devuelve mergeInto (colisiones detectadas): no
    // se descarta, porque el Req 7.1 lo necesita para que la UI avise las
    // colisiones y OperationResult.report lo espera (ver DECISIÓN 6).
    const pak01Dir = joinWindowsPath(workDir, PAK01_DIR_NAME);
    await this.#fs.ensureDir(pak01Dir);
    const report = await this.#collisionResolver.mergeInto(pak01Dir, extractedRoots);

    // Fase 3 — Empaquetar pak01_dir/ → pak01_dir.vpk (AC 6.8). El addonId del
    // error de pack (si fallara) usa PAK01_DIR_NAME ("pak01_dir") como etiqueta
    // de forma DELIBERADA: `pack` opera sobre el paquete FUSIONADO, no sobre un
    // addon de origen, así que no hay un addonId real; usar PAK01_DIR_NAME hace
    // que un eventual VpkToolError diga claramente que el fallo fue en el
    // empaquetado del paquete fusionado y no lo atribuya a un addon inexistente.
    const vpkPath = await this.#vpkTool.pack(pak01Dir, PAK01_DIR_NAME);

    return { vpkPath, report };
  }

  /**
   * Lista, crea subdirectorios y extrae el contenido de UN addon a `destDir`
   * (AC 6.1, 6.3). Cualquier `VpkToolError` de `list`/`extract` se propaga tal
   * cual (ya identifica el addon), abortando la fusión (AC 6.12).
   */
  async #extractAddon(addon: ScannedAddon, destDir: string): Promise<void> {
    // a. Listar el VPK (ruido ya filtrado por VpkTool; paths internos con `/`).
    const internalPaths = await this.#vpkTool.list(addon.vpkPath, addon.id);

    // b. Crear el destDir base (cwd de `vpk x`) y los subdirectorios de destino
    //    ANTES de extraer (AC 6.3). Se deriva el conjunto ÚNICO de directorios
    //    padre de los paths internos (ver DECISIÓN 1).
    await this.#fs.ensureDir(destDir);
    for (const relativeSubdir of this.#uniqueDestSubdirs(internalPaths)) {
      await this.#fs.ensureDir(joinWindowsPath(destDir, relativeSubdir));
    }

    // c. Extraer por lotes (el batching lo hace VpkTool). destDir es el cwd.
    await this.#vpkTool.extract(addon.vpkPath, internalPaths, destDir, addon.id);
  }

  /**
   * Deriva el conjunto ÚNICO de subdirectorios de destino (relativos, con `\`) a
   * crear para `internalPaths`. Toma el directorio padre de cada path interno,
   * descarta los que no tienen padre (archivos en la raíz), deduplica y traduce
   * `/`→`\` con {@link internalPathToDiskPath}. Ver DECISIÓN 1.
   */
  #uniqueDestSubdirs(internalPaths: readonly string[]): string[] {
    const uniqueInternalDirs = new Set<string>();
    for (const internalPath of internalPaths) {
      const parent = internalParentDir(internalPath);
      if (parent !== null && parent.length > 0) {
        uniqueInternalDirs.add(parent);
      }
    }
    return [...uniqueInternalDirs].map(internalPathToDiskPath);
  }
}
