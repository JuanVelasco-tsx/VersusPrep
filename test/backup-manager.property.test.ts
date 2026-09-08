import fc from "fast-check";

import { BackupManager } from "../src/main/domain/index.js";
import type { BackupFileSystem, BackupResult } from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * Property test del backup de un único nivel de BackupManager (Tarea 12.2).
 *
 * Property 7: Backup previo a toda sobrescritura, con un único nivel
 * **Validates: Requirements 5.1, 5.3**
 *
 * Para CUALQUIER secuencia de instalaciones que sobrescriban el Merged_Package
 * en `modsvs/`, debe cumplirse:
 *
 *   (a) BACKUP PREVIO (AC 5.1): en cada paso de la secuencia donde YA existía un
 *       `pak01_dir.vpk` actual, el Backup de ese archivo debe existir ANTES de
 *       que la instalación pise (sobrescriba) el `pak01_dir.vpk` actual. Es
 *       decir: el orden observado es siempre backup-antes-de-pisar, nunca al
 *       revés ni sin backup.
 *   (b) UN ÚNICO NIVEL (AC 5.3): en CUALQUIER punto de la secuencia hay a lo
 *       sumo UN nivel de Backup. Nunca se acumula un `pak01_dir.vpk.backup.backup`
 *       ni copias numeradas/versionadas del backup: el conjunto de archivos de
 *       backup del `modsvs/` tiene siempre cardinalidad <= 1 y, cuando existe,
 *       es exactamente `pak01_dir.vpk.backup`.
 *
 * ---------------------------------------------------------------------------
 * QUÉ UNIDAD REAL SE PRUEBA vs. QUÉ ES ORQUESTACIÓN SIMULADA DEL TEST
 *
 * La ÚNICA unidad de producción bajo prueba es `BackupManager.backupExisting`.
 * Todo lo demás del ciclo —en particular el paso de "INSTALAR" (sobrescribir el
 * `pak01_dir.vpk` de `modsvs/` con el nuevo Merged_Package fusionado)— NO es
 * responsabilidad de BackupManager: vive en el `MergeOrchestrator` (Tarea 18,
 * todavía NO implementada; ver el diagrama de secuencia 3 de design.md, pasos
 * "backupExisting -> merge -> instalar en modsvs/").
 *
 * Este test SIMULA ese ciclo completo "backup -> instalar" ÚNICAMENTE como
 * parte del MODELO de la propiedad, para poder observar el invariante (a) —que
 * exige razonar sobre el ORDEN entre "crear el backup" y "pisar el actual", un
 * orden que BackupManager por sí solo no materializa porque no instala nada—.
 * El paso de "instalar" del test (sobrescribir la entrada del FS en memoria
 * correspondiente a `pak01_dir.vpk`) es un STAND-IN del futuro orquestador, no
 * una llamada a código de BackupManager. Se deja explícito para que quede claro
 * que la propiedad NO afirma que BackupManager instale: afirma que, EN EL ORDEN
 * en que el orquestador invocará `backupExisting` ANTES de instalar, el backup
 * queda creado antes de la sobrescritura y nunca se acumula más de un nivel.
 *
 * El invariante (b), en cambio, depende SOLO de `backupExisting` (nombre de
 * destino fijo `pak01_dir.vpk.backup`, sobrescritura), y se verifica sobre el
 * estado del FS tras cada `backupExisting` real.
 * ---------------------------------------------------------------------------
 *
 * ESTRATEGIA DE GENERACIÓN
 *
 * Se genera un ESCENARIO con:
 *   - `startsWithExisting`: boolean. Si es `true`, el `modsvs/` arranca con un
 *     `pak01_dir.vpk` preinstalado (simula una instalación previa del usuario,
 *     hecha a mano o por una corrida anterior). Si es `false`, arranca vacío
 *     (primera instalación): el primer paso NO tendrá un actual que respaldar.
 *   - `steps`: un array de 1..8 pasos. Cada paso lleva un `contentTag` (string
 *     arbitrario) que identifica el contenido del NUEVO `pak01_dir.vpk` que ese
 *     paso instala, permitiendo distinguir versiones y verificar (a) por
 *     contenido, no solo por presencia. Se generan secuencias de longitud
 *     variable (no un caso aislado) para ejercitar la ACUMULACIÓN a lo largo de
 *     múltiples sobrescrituras (clave para (b)).
 *
 * Cada paso del modelo hace, EN ESTE ORDEN (el orden que garantizará el
 * orquestador real de la tarea 18):
 *   1. `result = await manager.backupExisting(MODSVS)`  (UNIDAD REAL).
 *   2. Verifica (a): si antes del paso había un `pak01_dir.vpk` actual, entonces
 *      (i) `result.created === true`, (ii) el backup existe en el FS con el
 *      contenido que tenía el actual ANTES de instalar, y (iii) el `backupPath`
 *      es `pak01_dir.vpk.backup`. Si NO había actual, `result.created === false`
 *      y no se creó backup (no había nada que respaldar; no es fallo).
 *   3. INSTALAR (orquestación SIMULADA): sobrescribe la entrada de
 *      `pak01_dir.vpk` en el FS con el `contentTag` del paso.
 *   4. Verifica (b): el conjunto de archivos "*.backup*" del `modsvs/` tiene a
 *      lo sumo un elemento y, si hay uno, es exactamente `pak01_dir.vpk.backup`.
 *
 * NO se reimplementa la lógica de BackupManager en el test: el punto (a) usa el
 * `result` real y el estado real del FS tras la llamada; el punto (b) inspecciona
 * el estado real del FS. El modelo solo aporta el paso "instalar" (stand-in del
 * orquestador) para poder observar el orden.
 * ---------------------------------------------------------------------------
 */

/** Carpeta modsvs/ del escenario (ruta Windows, coherente con el resto). */
const MODSVS = "C:\\Game\\left4dead2\\modsvs";
/** Ruta del Merged_Package actual instalado. */
const SOURCE = "C:\\Game\\left4dead2\\modsvs\\pak01_dir.vpk";
/** Ruta del único backup permitido (nombre fijo). */
const BACKUP = "C:\\Game\\left4dead2\\modsvs\\pak01_dir.vpk.backup";

/**
 * FS en memoria para BackupManager, adaptado a SECUENCIAS. Modela el contenido
 * de cada archivo (no solo su presencia) con un Map ruta->contenido, para poder
 * verificar el invariante (a) por CONTENIDO: que el backup guarde exactamente lo
 * que tenía el `pak01_dir.vpk` actual ANTES de que la instalación lo pisara.
 *
 * Es equivalente al MockFs de `test/backup-manager.test.ts` (misma interfaz
 * `BackupFileSystem`: exists + copyFile), pero con contenido en vez de un Set de
 * presencia, porque el property test necesita distinguir versiones del paquete a
 * lo largo de la secuencia. `copyFile` sobrescribe (semántica de la única copia
 * de backup, AC 5.3).
 */
class SequenceFs implements BackupFileSystem {
  /** ruta -> contenido actual del archivo. La ausencia de clave = no existe. */
  readonly files = new Map<string, string>();

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }

  copyFile(sourcePath: string, destPath: string): Promise<void> {
    const content = this.files.get(sourcePath);
    if (content === undefined) {
      // BackupManager solo llama copyFile tras comprobar exists(source)===true,
      // así que esto no debería ocurrir; se modela como fallo defensivo para que
      // cualquier violación de esa precondición rompa el test en vez de pasar en
      // silencio.
      return Promise.reject(new Error(`copyFile de origen inexistente: ${sourcePath}`));
    }
    this.files.set(destPath, content); // sobrescribe: única copia de backup
    return Promise.resolve();
  }

  /** Rutas de archivos de backup presentes (cualquiera que contenga ".backup"). */
  backupPaths(): string[] {
    return [...this.files.keys()].filter((p) => p.includes(".backup"));
  }
}

/** Un paso de la secuencia: instala una versión identificada por `contentTag`. */
interface Step {
  /** Contenido del nuevo pak01_dir.vpk que este paso instala. */
  contentTag: string;
}

/**
 * Escenario completo: si el modsvs/ arranca con un paquete preexistente y la
 * secuencia de instalaciones a aplicar.
 */
interface Scenario {
  startsWithExisting: boolean;
  /** Contenido inicial del pak01_dir.vpk si `startsWithExisting` es true. */
  initialContentTag: string;
  steps: Step[];
}

/** Tag de contenido arbitrario (distingue versiones del paquete). */
const contentTagArb: fc.Arbitrary<string> = fc.string({ minLength: 0, maxLength: 24 });

const stepArb: fc.Arbitrary<Step> = fc.record({ contentTag: contentTagArb });

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  startsWithExisting: fc.boolean(),
  initialContentTag: contentTagArb,
  // Secuencias de 1..8 pasos: NO un caso aislado; ejercita la acumulación.
  steps: fc.array(stepArb, { minLength: 1, maxLength: 8 }),
});

propertyTest(
  7,
  "Backup previo a toda sobrescritura, con un único nivel",
  fc.asyncProperty(scenarioArb, async (scenario) => {
    const fs = new SequenceFs();
    const manager = new BackupManager(fs);

    // Estado inicial del modsvs/ (simula instalación previa del usuario o vacío).
    if (scenario.startsWithExisting) {
      fs.files.set(SOURCE, `initial:${scenario.initialContentTag}`);
    }

    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      if (step === undefined) return false; // defensivo; el array es denso.

      // Snapshot del actual ANTES de backup+instalar (para verificar (a) por
      // contenido). `undefined` si no había un pak01_dir.vpk actual.
      const currentBefore = fs.files.get(SOURCE);
      const hadCurrent = currentBefore !== undefined;

      // --- UNIDAD REAL bajo prueba ---
      const result: BackupResult = await manager.backupExisting(MODSVS);

      // (a) BACKUP PREVIO (AC 5.1): si había un actual, el backup debe existir
      // AHORA (antes de instalar) con el contenido del actual previo, y el
      // result debe reflejarlo. Si no había actual, es un no-op exitoso.
      if (hadCurrent) {
        if (!result.created) return false;
        if (result.backupPath !== BACKUP) return false;
        if (!fs.files.has(BACKUP)) return false;
        // El backup guarda EXACTAMENTE lo que tenía el actual antes de instalar.
        if (fs.files.get(BACKUP) !== currentBefore) return false;
      } else {
        if (result.created) return false;
        // No se creó backup en este paso por no haber actual. (No se afirma
        // ausencia global de backup: un paso previo pudo dejar uno; ver (b).)
      }

      // (b) UN ÚNICO NIVEL (AC 5.3), verificado JUSTO TRAS EL BACKUP y ANTES de
      // instalar: nunca hay más de un archivo de backup, y si hay uno es el de
      // nombre fijo (no un .backup.backup ni versionado).
      const backupsAfterBackup = fs.backupPaths();
      if (backupsAfterBackup.length > 1) return false;
      if (backupsAfterBackup.length === 1 && backupsAfterBackup[0] !== BACKUP) return false;

      // --- ORQUESTACIÓN SIMULADA (stand-in del MergeOrchestrator, tarea 18) ---
      // INSTALAR: pisar el pak01_dir.vpk actual con el nuevo contenido del paso.
      // Esto NO es BackupManager; es el paso que el orquestador hará DESPUÉS del
      // backup. Se hace aquí solo para modelar el orden y habilitar (a) en el
      // siguiente paso de la secuencia.
      fs.files.set(SOURCE, `step${i}:${step.contentTag}`);

      // (b) de nuevo, TRAS instalar: la instalación no debe haber creado un
      // segundo nivel de backup (no lo hace, pero se comprueba para blindar el
      // invariante sobre TODO punto de la secuencia).
      const backupsAfterInstall = fs.backupPaths();
      if (backupsAfterInstall.length > 1) return false;
      if (backupsAfterInstall.length === 1 && backupsAfterInstall[0] !== BACKUP) return false;
    }

    return true;
  }),
);