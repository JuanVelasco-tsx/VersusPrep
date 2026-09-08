/**
 * BackupManager — backup de un unico nivel antes de sobrescribir el
 * Merged_Package (Tarea 12.1, Requirement 5; AC 5.1, 5.2, 5.3).
 *
 * Responsabilidad unica: antes de que el orquestador instale un nuevo
 * pak01_dir.vpk en modsvs/, copiar el existente a pak01_dir.vpk.backup en la
 * MISMA carpeta (un solo nivel de backup).
 *
 * ---------------------------------------------------------------------------
 * DECISION 1 — Forma de BackupResult: union discriminada por created, SIN
 * campo ok (AC 5.2).
 *
 * Los fallos se propagan SIEMPRE por throw (ver DECISION 3): nunca hay una
 * rama de "error controlado" en el retorno. Por eso BackupResult es una
 * union discriminada por created, no por ok:
 *
 *   type BackupResult =
 *     | { created: true;  backupPath: string }
 *     | { created: false };
 *
 * Si se aniadiera un campo ok seria siempre true (el fallo sale por
 * excepcion), lo que no discrimina nada. Esta forma es isomorfa a un
 * Optional<{ backupPath: string }> con semantica mas expresiva: created
 * dice si se creo un backup y backupPath (solo presente cuando created es
 * true) da la ruta de ese backup.
 *
 * Contraste con OperationResult del orquestador (que SI tiene ok: false):
 * en ese caso el orquestador captura el error y lo convierte en un resultado
 * de operacion. BackupManager vive en la capa de DOMINIO y no captura: la
 * traduccion del throw a un OperationResult { ok: false } es responsabilidad
 * del orquestador (tarea 18).
 * ---------------------------------------------------------------------------
 *
 * DECISION 2 — Semantica de "pak01_dir.vpk ausente = no-op exitoso, no aborta"
 * (AC 5.1, cobertura de primera instalacion).
 *
 * El AC 5.1 dice: "The Manager SHALL crear un Backup del pak01_dir.vpk actual
 * BEFORE de modificarlo." La condicion implica que el "actual" exista. Cuando
 * el Manager se usa por PRIMERA VEZ, todavia no hay ningun pak01_dir.vpk en
 * modsvs/; en ese caso no hay nada que respaldar y la ausencia NO es un fallo
 * (no hay riesgo de perder un archivo que no existe). backupExisting devuelve
 * { created: false } sin tocar nada y el orquestador SIGUE ADELANTE.
 *
 * Si en cambio el archivo EXISTE y la COPIA FALLA (permisos, disco lleno, etc.),
 * el error se PROPAGA sin atrapar (ver DECISION 3) y el orquestador aborta la
 * fusion conforme al AC 5.2: "IF la creacion del Backup falla, THEN THE Manager
 * SHALL abortar la operacion de fusion e informar al usuario del motivo."
 *
 * Resumen del flujo:
 *   1. exists(sourcePath)  -> false -> devuelve { created: false } (no-op).
 *   2. exists(sourcePath)  -> true  -> copyFile(sourcePath, backupPath).
 *        a. copyFile OK    -> devuelve { created: true, backupPath }.
 *        b. copyFile throw -> propaga (el orquestador aborta, AC 5.2).
 * ---------------------------------------------------------------------------
 *
 * DECISION 3 — Propagar fallos por throw, sin atrapar (AC 5.2).
 *
 * backupExisting NO envuelve la copia en try/catch. Si copyFile lanza
 * (EACCES, EPERM, ENOSPC, etc.), el error sube al orquestador tal cual.
 * El orquestador (tarea 18) es quien decide que hacer ante ese fallo:
 * a) invoca ElevationService.handleWriteFailure si el error es de permisos
 *    y reintenta en una instancia elevada, o b) convierte el error en un
 *    OperationResult { ok: false } para informar al usuario. Ambas decisiones
 *    son del ORQUESTADOR, no del dominio. Si BackupManager atrapara el error
 *    y devolviera un { ok: false }, el orquestador no podria distinguir un
 *    fallo de backup de un EACCES que merece reintento elevado, rompiendo la
 *    logica del handleWriteFailure de la tarea 17.2.
 * ---------------------------------------------------------------------------
 *
 * DECISION 4 — Nombre y ubicacion del backup: pak01_dir.vpk.backup en
 * modsvs/, junto al original.
 *
 * pak01_dir.vpk.backup es la convencion ya implicita en el .gitignore del
 * repo (patron *.vpk.backup*). Ventajas:
 *   - Nombre fijo -> un solo nivel garantizado (AC 5.3): sobrescribir el backup
 *     previo es tan simple como copiar al mismo destino.
 *   - Misma carpeta (modsvs/) -> no se necesita ensureDir; modsvs/ existe
 *     en cualquier instalacion donde el Manager haya corrido antes, y si no
 *     existe el backup no se crea (DECISION 2 cubre ese caso).
 *   - El patron del .gitignore evita versionar accidentalmente el backup si
 *     el usuario tiene el Game_Root dentro del workspace de desarrollo.
 * ---------------------------------------------------------------------------
 *
 * DECISION 5 — FS inyectado PROPIO minimo ({@link BackupFileSystem}), solo
 * exists y copyFile (ver patron MergeFileSystem / AddonFileSystem).
 *
 * Cada componente de dominio define su PROPIO contrato de FS inyectable con
 * las operaciones MINIMAS que necesita (ver DECISION 1 en addon-scanner.ts,
 * collision-resolver.ts y merge-engine.ts). BackupManager solo necesita
 * saber si un archivo existe y copiarlo sobrescribiendo; no recorre ni crea
 * directorios. BackupFileSystem expone exactamente esas dos operaciones.
 * ---------------------------------------------------------------------------
 *
 * DECISION 6 — Separador de path \ LITERAL (no path.join), coherente con
 * el resto del dominio.
 *
 * Las rutas de modsvs/ son rutas de Windows; se construyen con el separador
 * \ literal, igual que en merge-engine.ts, collision-resolver.ts y
 * addon-scanner.ts. path.join de Node usa / en Linux/macOS (plataforma
 * del CI) y produciria rutas incorrectas para la plataforma primaria. El
 * literal "\\" es intencional y no debe reemplazarse por path.sep ni por
 * path.join (ver entrada correspondiente en Context/04-historial-decisiones.md).
 * ---------------------------------------------------------------------------
 */

import type { BackupResult } from "./types.js";

/** Nombre del Merged_Package instalado en modsvs/. */
const SOURCE_FILENAME = "pak01_dir.vpk";

/** Nombre del archivo de backup (un solo nivel, se sobrescribe — AC 5.3). */
const BACKUP_FILENAME = "pak01_dir.vpk.backup";

/** Separador de path de Windows, coherente con el resto del dominio. */
const DISK_SEPARATOR = "\\";

/**
 * Contrato de FS inyectable PROPIO de BackupManager (ver DECISION 5). Reune
 * las DOS operaciones minimas que el backup necesita: comprobar si el
 * pak01_dir.vpk actual existe y copiarlo al destino de backup.
 *
 * Es un puerto neutro que en produccion se implementa con node:fs/promises
 * y en los tests con un doble en memoria. Todas las rutas son absolutas en
 * formato Windows.
 */
export interface BackupFileSystem {
  /**
   * Indica si existe una ruta (archivo o directorio) en disco. Se usa para
   * decidir si hay un pak01_dir.vpk actual que respaldar. No debe lanzar
   * por "no existe": devuelve false en ese caso.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Copia sourcePath a destPath SOBRESCRIBIENDO si el destino ya existe.
   * La sobrescritura garantiza el unico nivel de backup: una copia nueva siempre
   * reemplaza a la anterior (AC 5.3). Si la copia falla (permisos, disco lleno,
   * etc.), la implementacion lanza; backupExisting deja que ese error se
   * propague sin atraparlo (AC 5.2 / DECISION 3).
   */
  copyFile(sourcePath: string, destPath: string): Promise<void>;
}

/**
 * Une un directorio y un nombre de archivo con el separador de Windows (DECISION 6).
 * Recorta cualquier separador final de dir para no duplicarlo.
 */
function joinWindowsPath(dir: string, filename: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  return `${trimmed}${DISK_SEPARATOR}${filename}`;
}

/**
 * BackupManager — gestiona el backup de un unico nivel del pak01_dir.vpk
 * existente en modsvs/ antes de que el orquestador lo sobrescriba
 * (Requirement 5, AC 5.1–5.3).
 *
 * Depende de un {@link BackupFileSystem} inyectado por constructor para ser
 * testeable sin disco real (mismo patron que MergeEngine, CollisionResolver
 * y AddonScanner).
 */
export class BackupManager {
  readonly #fs: BackupFileSystem;

  /**
   * @param fs FS inyectado para comprobar existencia y copiar sobrescribiendo.
   */
  constructor(fs: BackupFileSystem) {
    this.#fs = fs;
  }

  /**
   * Crea un backup del pak01_dir.vpk actual en modsvsFolder antes de que
   * el orquestador lo sobrescriba (AC 5.1, 5.2, 5.3).
   *
   * Flujo (ver DECISION 2):
   *   - Si NO existe el pak01_dir.vpk actual -> devuelve { created: false }
   *     sin tocar nada (primera instalacion; no es un fallo).
   *   - Si EXISTE -> copia a pak01_dir.vpk.backup en la misma carpeta,
   *     sobrescribiendo cualquier backup previo (AC 5.3).
   *       - Copia OK  -> devuelve { created: true, backupPath }.
   *       - Copia KO  -> propaga el error (el orquestador aborta, AC 5.2).
   *
   * @param modsvsFolder Ruta absoluta (Windows) de la carpeta modsvs/.
   * @returns {@link BackupResult} con created: false si no habia nada que
   *   respaldar, o created: true con backupPath si el backup se creo.
   * @throws El error nativo del FS si copyFile falla (EACCES, EPERM, etc.),
   *   para que el orquestador pueda actuar en consecuencia (AC 5.2).
   */
  async backupExisting(modsvsFolder: string): Promise<BackupResult> {
    const sourcePath = joinWindowsPath(modsvsFolder, SOURCE_FILENAME);
    const exists = await this.#fs.exists(sourcePath);

    if (!exists) {
      // Primera instalacion (o pak01_dir.vpk borrado): no hay nada que respaldar.
      // No es un fallo: devuelve no-op exitoso (DECISION 2).
      return { created: false };
    }

    // Existe un pak01_dir.vpk actual: copiarlo al backup (sobrescribiendo el
    // previo si existiera, garantizando el unico nivel — AC 5.3). Si copyFile
    // lanza, el error sube al orquestador tal cual (DECISION 3 / AC 5.2).
    const backupPath = joinWindowsPath(modsvsFolder, BACKUP_FILENAME);
    await this.#fs.copyFile(sourcePath, backupPath);

    return { created: true, backupPath };
  }
}
