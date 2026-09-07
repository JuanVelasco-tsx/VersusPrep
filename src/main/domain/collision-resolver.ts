/**
 * CollisionResolver — fusión del contenido extraído con la política "el último
 * del Priority_Order gana" (Tarea 10.1, Requirement 7; AC 7.1, 7.2).
 *
 * Fusiona el contenido ya extraído de varios addons en una única carpeta de
 * destino (`pak01_dir/`) recorriendo los {@link ExtractedRoot} en orden
 * ASCENDENTE de Priority_Order. Al copiar cada archivo a `destDir`, si el path
 * relativo ya fue escrito por un addon anterior (colisión), se SOBRESCRIBE.
 * Como el último addon del Priority_Order se copia al final, GANA EL ÚLTIMO
 * (AC 7.2, validado por hash SHA256 en la validación end-to-end previa).
 *
 * Cada colisión (un mismo path relativo aportado por ≥ 2 addons) se registra en
 * el {@link MergeReport}: `contributors` lista los addonId que aportaron ese
 * path EN ORDEN de recorrido (ascendente) y `winner` es el último (el que quedó
 * físicamente en `destDir`).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 1 — Interfaz de FS PROPIA ({@link CollisionFileSystem}), no reutilizar
 * la de PathDetector ni la de AddonScanner.
 *
 * Coherente con la DECISIÓN 1 documentada en `addon-scanner.ts`: cada componente
 * de dominio define su PROPIO contrato de FS inyectable mientras no exista un
 * consumidor común consolidado. El checkpoint de la tarea 9 agrupa 6+7+8 y la
 * disciplina de ramas de CONTRIBUTING.md desaconseja mergear PathDetector antes
 * de tiempo solo para deduplicar. La duplicación de un contrato de FS pequeño es
 * un costo ACEPTADO: `CollisionFileSystem` expone exactamente lo que la fusión
 * necesita (walk recursivo + crear directorios + copiar archivo sobrescribiendo),
 * que NO coincide con las operaciones de `AddonFileSystem` (no hay `exists` ni
 * `readTextFile`, sí hay `copyFile`).
 *
 * A revisar (nota explícita): una vez existan PathDetector + AddonScanner +
 * VScriptDetector + CollisionResolver, evaluar unificar las interfaces de FS del
 * dominio en un único puerto.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 2 — Normalización del `relativePath` para comparar entre roots
 * (AC 7.1).
 *
 * El contenido en disco ya está extraído con separador de Windows (`\`); cada
 * addon vive en su propio `rootDir`. Para decidir si dos archivos de roots
 * distintos "son el mismo path" (colisión) hace falta una CLAVE estable. La
 * normalización de esa clave (separadores `\` → `/`, sin separador líder,
 * minúsculas) vive en el NÚCLEO PURO (`collision-core.ts`, {@link toCollisionKey})
 * y se reutiliza aquí para que la clave con la que se construye el destino en
 * disco sea EXACTAMENTE la misma con la que el núcleo decide el ganador. Motivo
 * del casing: el FS de destino (NTFS) es case-insensitive, así que
 * `Materials/a.vmt` y `materials/A.VMT` colisionan en disco.
 *
 * Esta clave normalizada se usa como `relativePath` reportado (forma estable con
 * `/`) y como base del destino en disco: el path de DESTINO real se construye
 * con el separador de Windows (ver {@link joinWindowsPath}), coherente con el
 * resto del dominio.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 3 — Delegación en el núcleo PURO (Tarea 10.2).
 *
 * La DECISIÓN de ganador y el armado del `MergeReport` NO viven aquí: se delegan
 * en `resolveMerge` (`collision-core.ts`), que es puro y testeable como
 * propiedad (Tarea 10.3). `mergeInto` queda responsable SOLO del I/O: recorre
 * los roots (`walk`), arma la vista "addonId + paths" que el núcleo consume, y
 * copia cada archivo a su destino (`ensureDir` + `copyFile`) en Priority_Order
 * ASCENDENTE, sobrescribiendo. La sobrescritura física materializa lo que el
 * núcleo ya decidió: el último gana. No hay lógica de colisiones duplicada.
 * ---------------------------------------------------------------------------
 *
 * DECISIÓN 4 — La normalización de clave (minúsculas + separador `/`) aplica al
 * ÁRBOL COMPLETO de salida, no solo a los paths que colisionan entre addons.
 *
 * Consecuencia directa de las DECISIÓN 2/3: `mergeInto` construye el `destPath`
 * físico a partir de la MISMA clave normalizada (`toCollisionKey`) que el núcleo
 * usa para agrupar contribuidores y decidir el ganador. El efecto es que TODO el
 * árbol fusionado en `pak01_dir/` queda escrito en MINÚSCULAS y con separador de
 * Windows normalizado, AUNQUE un archivo NO colisione con ningún otro addon: un
 * `Materials/Foo.VMT` aportado por un solo addon termina físicamente como
 * `materials\foo.vmt`. Lo mismo con `FileCollision.relativePath` del MergeReport:
 * reporta la clave normalizada (minúsculas, `/`), NO el path con el casing
 * original que le puso el autor del addon.
 *
 * MOTIVO (por qué es correcto y necesario, no un accidente que haya que revertir):
 * la clave canónica debe ser ÚNICA de extremo a extremo — agrupar, decidir
 * ganador y escribir a disco tienen que usar EXACTAMENTE la misma clave, o el
 * archivo físico podría no coincidir con la ruta bajo la cual se decidió el
 * ganador. Si en cambio el destino usara el `relativePath` ORIGINAL sin
 * normalizar, dos addons que aportan el mismo archivo lógico con casing distinto
 * (`Materials/Foo.vmt` vs `materials/foo.vmt`) escribirían a dos rutas de string
 * DISTINTAS: en NTFS (Windows, plataforma primaria, case-insensitive) probablemente
 * colapsan igual al mismo archivo, pero en un filesystem CASE-SENSITIVE
 * (Linux / Steam Deck, plataformas secundarias según README.md y design.md) se
 * crearían DOS archivos separados y la política "el último gana" dejaría de
 * aplicar (quedarían ambos, con el que "gana" dependiendo de detalles del FS).
 * Normalizar el destino elimina esa divergencia entre plataformas y hace la
 * fusión determinista en cualquier SO. Escribir todo en minúsculas es seguro para
 * L4D2/Source porque el engine resuelve las rutas de contenido de forma
 * case-insensitive; el único cambio observable es el casing del árbol de salida.
 *
 * NOTA PARA LA TAREA 21 (UI) — aviso de colisiones: el `relativePath` que se
 * muestre al usuario en un aviso de File_Collision estará en MINÚSCULAS y con
 * separador normalizado (p. ej. `materials/foo.vmt`), NO en el casing original
 * del addon. Es esperado por lo anterior; que no sorprenda al implementar esa
 * tarea. Si la UI necesitara mostrar el casing original habría que propagar el
 * `relativePath` crudo por separado (hoy no se conserva; sería un cambio de
 * alcance de la 21, no un bug de la fusión).
 * ---------------------------------------------------------------------------
 */

import {
  type AddonContribution,
  resolveMerge,
  toCollisionKey,
} from "./collision-core.js";
import type { ExtractedRoot, MergeReport } from "./types.js";

/** Separador de path en disco (Windows), coherente con `vpk-path.ts`. */
const DISK_SEPARATOR = "\\";

/**
 * Un archivo hallado al recorrer un `rootDir`, identificado por su ruta relativa
 * al root. `relativePath` usa el separador con que el FS lo haya listado; la
 * normalización a clave canónica la hace {@link CollisionResolver}.
 */
export interface WalkedFile {
  /** Ruta relativa del archivo respecto del `rootDir` recorrido. */
  relativePath: string;
}

/**
 * Contrato de FS inyectable PROPIO de CollisionResolver (ver DECISIÓN 1).
 *
 * Es un puerto neutro que en producción se implementa con `node:fs/promises` y
 * en los tests con un doble en memoria. Todas las rutas son absolutas en formato
 * del sistema anfitrión (Windows en el caso primario).
 */
export interface CollisionFileSystem {
  /**
   * Recorre RECURSIVAMENTE `rootDir` y devuelve TODOS los archivos (no los
   * directorios) hallados bajo él, cada uno con su ruta relativa al `rootDir`.
   * El orden dentro de un mismo root no afecta la política de colisiones (el
   * ganador se decide entre roots, no dentro de uno): dos archivos distintos de
   * un mismo addon no colisionan entre sí. Si `rootDir` no existe o no se puede
   * leer, la implementación decide; CollisionResolver no captura ese fallo.
   */
  walk(rootDir: string): Promise<WalkedFile[]>;

  /**
   * Asegura que exista un directorio (lo crea recursivamente si hace falta).
   * Idempotente: no falla si ya existe. Se usa para crear el árbol de
   * subdirectorios de destino antes de copiar cada archivo.
   */
  ensureDir(dir: string): Promise<void>;

  /**
   * Copia `sourcePath` a `destPath` SOBRESCRIBIENDO si el destino ya existe.
   * La sobrescritura es la clave de la política "el último gana": copiar el
   * archivo de un addon posterior sobre uno ya escrito por un addon anterior.
   */
  copyFile(sourcePath: string, destPath: string): Promise<void>;
}

/**
 * Une un directorio y una ruta relativa con el separador de Windows.
 *
 * Se usa el literal `\` (no `path.join`) por coherencia con el resto del dominio
 * (ver `addon-scanner.ts` / `vpk-path.ts`), que fija Windows como plataforma
 * primaria de las rutas de disco. `relative` puede venir con `/` o `\`: se
 * normaliza a `\` para el destino en disco. Se recorta el separador final de
 * `dir` para no duplicarlo.
 */
function joinWindowsPath(dir: string, relative: string): string {
  const trimmedDir = dir.replace(/[\\/]+$/, "");
  const diskRelative = relative.replace(/\//g, DISK_SEPARATOR).replace(/^[\\/]+/, "");
  return `${trimmedDir}${DISK_SEPARATOR}${diskRelative}`;
}

/**
 * Directorio padre (en formato Windows) de un path de disco. Devuelve `null` si
 * el path no tiene separador (archivo en la raíz de destDir; no hay subdir que
 * crear). Se usa para asegurar el árbol de subdirectorios antes de copiar.
 */
function parentDirOf(diskPath: string): string | null {
  const idx = diskPath.lastIndexOf(DISK_SEPARATOR);
  return idx === -1 ? null : diskPath.slice(0, idx);
}

/**
 * CollisionResolver — fusiona el contenido extraído aplicando "el último gana".
 *
 * Depende de un {@link CollisionFileSystem} inyectado por constructor (mismo
 * patrón que VpkTool/AddonScanner: dependencia estable de la instancia), para
 * ser testeable sin tocar disco real. Se elige una clase para mantener la
 * dependencia como estado privado inmutable y exponer `mergeInto` tal como lo
 * describe la interfaz de diseño (sección "CollisionResolver").
 */
export class CollisionResolver {
  readonly #fs: CollisionFileSystem;

  /**
   * @param fs FS inyectado para recorrer roots, crear directorios y copiar
   *   archivos sobrescribiendo.
   */
  constructor(fs: CollisionFileSystem) {
    this.#fs = fs;
  }

  /**
   * Fusiona el contenido de `extractedRoots` en `destDir` (AC 7.1, 7.2).
   *
   * Recorre `extractedRoots` EN EL ORDEN RECIBIDO (Priority_Order ASCENDENTE) y,
   * para cada archivo de cada root, lo copia a `destDir/<relativePath>`
   * sobrescribiendo si ya existía. Como el último root del arreglo se copia al
   * final, su archivo prevalece en cada colisión (gana el último).
   *
   * Devuelve un {@link MergeReport} con las colisiones detectadas: solo los
   * paths aportados por ≥ 2 addons, con `contributors` en orden ascendente y
   * `winner` = el último contribuidor (el que quedó físicamente en `destDir`).
   *
   * @param destDir Carpeta de destino de la fusión (p. ej. `pak01_dir/`).
   * @param extractedRoots Roots extraídos, en Priority_Order ASCENDENTE.
   */
  async mergeInto(destDir: string, extractedRoots: readonly ExtractedRoot[]): Promise<MergeReport> {
    // Fase 1 — I/O de lectura: recorrer cada root y quedarse con sus archivos.
    // Se conserva el `WalkedFile` original (con su separador/casing) para poder
    // construir el `sourcePath` real de la copia; en paralelo se arma la vista
    // "addonId + paths" (con los paths ORIGINALES) que consume el núcleo puro.
    // El orden de `extractedRoots` (Priority_Order ASCENDENTE) se preserva.
    const walkedByRoot: WalkedFile[][] = [];
    const contributions: AddonContribution[] = [];
    for (const root of extractedRoots) {
      const files = await this.#fs.walk(root.rootDir);
      walkedByRoot.push(files);
      contributions.push({
        addonId: root.addonId,
        relativePaths: files.map((f) => f.relativePath),
      });
    }

    // Fase 2 — DECISIÓN pura: el núcleo determina ganadores y colisiones a partir
    // de las contribuciones (sin tocar disco). `mergeInto` no duplica esa lógica.
    const { report } = resolveMerge(contributions);

    // Fase 3 — I/O de escritura: copiar cada archivo a su destino canónico en
    // orden ascendente, sobrescribiendo. La clave de destino se calcula con la
    // MISMA normalización que usó el núcleo ({@link toCollisionKey}), de modo que
    // dos aportes del mismo path lógico caen en el MISMO destino y la última
    // copia (el ganador que decidió el núcleo) queda físicamente en disco.
    for (let i = 0; i < extractedRoots.length; i++) {
      const root = extractedRoots[i];
      const files = walkedByRoot[i];
      if (root === undefined || files === undefined) {
        continue;
      }
      for (const walked of files) {
        const key = toCollisionKey(walked.relativePath);
        const sourcePath = joinWindowsPath(root.rootDir, walked.relativePath);
        // El destino se construye desde la CLAVE NORMALIZADA (`key`), no desde el
        // `relativePath` original. Esto normaliza el ÁRBOL COMPLETO de salida a
        // minúsculas + `/` (luego `\` en disco), NO solo los paths que colisionan:
        // un archivo aportado por un único addon también se escribe normalizado. Es
        // deliberado y necesario — ver DECISIÓN 4 del encabezado: la clave debe ser
        // única de extremo a extremo para que la fusión "el último gana" sea
        // determinista también en filesystems case-SENSITIVE (Linux/Steam Deck). El
        // `sourcePath`, en cambio, sí usa el casing ORIGINAL (así existe en disco).
        const destPath = joinWindowsPath(destDir, key);
        const parent = parentDirOf(destPath);
        if (parent !== null) {
          await this.#fs.ensureDir(parent);
        }
        await this.#fs.copyFile(sourcePath, destPath);
      }
    }

    return report;
  }
}
