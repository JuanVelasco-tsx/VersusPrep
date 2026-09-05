/**
 * Tipos de dominio compartidos del L4D2 Versus Addon Manager.
 *
 * Este módulo concentra las firmas EXACTAS derivadas del design.md (Núcleo
 * Validado, Requisitos 1-9). Es la fuente de verdad de las estructuras de datos
 * que atraviesan las capas (dominio, aplicación/orquestación, IPC/preload).
 *
 * Nota de scope (Tarea 1): aquí SOLO viven los tipos. La implementación de los
 * componentes (PathDetector, VpkTool, MergeEngine, etc.) corresponde a tareas
 * posteriores.
 */

// ---------------------------------------------------------------------------
// Requirement 1 — Detección de rutas (PathDetector)
// ---------------------------------------------------------------------------

/**
 * Conjunto de rutas de Steam y de la instalación de L4D2, derivadas y
 * verificadas contra disco. Todas son rutas absolutas en formato Windows.
 */
export interface GamePaths {
  steamPath: string;
  /** `<lib>\steamapps\common\Left 4 Dead 2` */
  gameRoot: string;
  /** `<gameRoot>\left4dead2` */
  left4dead2Dir: string;
  /** `<left4dead2Dir>\addons\workshop` */
  workshopFolder: string;
  /** `<gameRoot>\bin\vpk.exe` */
  vpkToolPath: string;
  /** `<left4dead2Dir>\gameinfo.txt` */
  gameInfoFile: string;
  /** `<left4dead2Dir>\modsvs` */
  modsvsFolder: string;
}

/**
 * Entrada parseada de `libraryfolders.vdf` (formato KeyValues de Valve).
 *
 * Decisión de representación (documentada): el diseño solo necesita, por
 * biblioteca, (a) su `path` en disco y (b) el conjunto de AppIDs presentes en
 * su bloque `apps`, para poder seleccionar la primera biblioteca que contiene
 * la clave `550` (L4D2) en orden de aparición (AC 1.5). Por eso `apps` se
 * modela como un `string[]` de AppIDs (las claves del bloque `apps`), que es la
 * información mínima suficiente. El orden del array preserva el orden de
 * aparición en el archivo, coherente con la selección "primera biblioteca".
 */
export interface LibraryEntry {
  /** Ruta en disco de la biblioteca (puede estar en otro disco que Steam). */
  path: string;
  /** AppIDs presentes en el bloque `apps` de esta biblioteca (p. ej. "550"). */
  apps: string[];
}

// ---------------------------------------------------------------------------
// Requirement 2 — Escaneo de la Workshop_Folder (AddonScanner)
// ---------------------------------------------------------------------------

/**
 * Metadata opcional leída del `addoninfo.txt` interno del VPK. Su lectura no
 * bloquea el escaneo si falta o falla (AC 2.5).
 *
 * Nota (AC 3.4): esta forma NO expone `addonContent_Script`. La clasificación
 * VScript se hace SIEMPRE inspeccionando el listado real del VPK, nunca ese flag.
 */
export interface AddonInfo {
  title?: string;
  author?: string;
  description?: string;
}

/**
 * Un addon detectado en la Workshop_Folder. `<id>.vpk` se trata como Addon `<id>`.
 */
export interface ScannedAddon {
  /** `<id>` extraído del nombre de archivo `<id>.vpk`. */
  id: string;
  vpkPath: string;
  /** Ruta de `<id>.jpg` junto al VPK si existe; `null` en caso contrario. */
  coverPath: string | null;
  /** Metadata leída del `addoninfo.txt` interno; `null` si no disponible. */
  info: AddonInfo | null;
}

// ---------------------------------------------------------------------------
// Requirement 3 — Clasificación VScript (VScriptDetector)
// ---------------------------------------------------------------------------

/**
 * Resultado de clasificar un addon como incompatible con Versus por contener
 * VScripts.
 *
 * - `nut-in-vscripts`: se halló un `.nut` bajo `scripts/vscripts/` (VScript_Addon).
 * - `listing-failed`: `vpk l` falló; se clasifica como VScript_Addon por precaución (AC 3.5).
 * - `clean`: no hay `.nut` bajo `scripts/vscripts/`; el addon es apto.
 */
export interface VScriptClassification {
  addonId: string;
  isVScriptAddon: boolean;
  reason: "nut-in-vscripts" | "listing-failed" | "clean";
}

// ---------------------------------------------------------------------------
// Requirement 7 / 6 — Fusión y resolución de colisiones
// ---------------------------------------------------------------------------

/** Carpeta raíz donde quedó extraído el contenido de un addon. */
export interface ExtractedRoot {
  addonId: string;
  rootDir: string;
}

/** Una colisión de archivos entre addons y su ganador según Priority_Order. */
export interface FileCollision {
  relativePath: string;
  /** addonIds que aportaron un archivo en esta ruta relativa. */
  contributors: string[];
  /** addonId cuyo archivo prevaleció ("el último del Priority_Order gana"). */
  winner: string;
}

/** Reporte de la fusión: colisiones detectadas durante el merge. */
export interface MergeReport {
  collisions: FileCollision[];
}

// ---------------------------------------------------------------------------
// Requirement 8 — Persistencia del Active_Set (LocalStore)
// ---------------------------------------------------------------------------

/**
 * Entrada del Addon_Manifest. El manifest NO registra archivos individuales por
 * addon; solo `{ addonId, priorityOrder }`, suficiente para reconstruir el
 * Merged_Package mediante una fusión completa desde cero.
 */
export interface AddonManifestEntry {
  addonId: string;
  priorityOrder: number;
}

// ---------------------------------------------------------------------------
// Requirement 9 — Elevación UAC bajo demanda (ElevationService)
// ---------------------------------------------------------------------------

/**
 * Operación pendiente que se transfiere a la instancia elevada. Lleva SOLO lo
 * mínimo (tipo + handle): la instancia elevada rehidrata el Active_Set candidato
 * leyendo el estado de sesión pendiente del LocalStore, no de la línea de comando.
 */
export interface PendingOperation {
  type: "applyActiveSet" | "addAddon" | "removeAddon";
  /** Identifica el estado de sesión pendiente persistido en el LocalStore. */
  resumeHandle: string;
}

/**
 * Resultado de la decisión/mecanismo de elevación.
 *
 * - `already-writable`: no hacía falta elevar (o ya se está elevado).
 * - `elevated-handoff`: se relanzó elevado; esta instancia cede el trabajo.
 * - `denied`: el usuario canceló el prompt UAC.
 */
export type ElevationOutcome =
  | { kind: "already-writable" }
  | { kind: "elevated-handoff" }
  | { kind: "denied"; reason: string };

// ---------------------------------------------------------------------------
// Capa de aplicación — Resultado de operaciones del orquestador
// ---------------------------------------------------------------------------

/**
 * Resultado de una operación del MergeOrchestrator (applyActiveSet / addAddon /
 * removeAddon).
 *
 * Decisión de forma (documentada): se usa una unión discriminada por el campo
 * `ok`. En éxito, se expone opcionalmente el `MergeReport` (colisiones) y las
 * entradas finales del Active_Set instalado, útiles para que la UI refleje el
 * resultado. En fallo, se expone un `error` legible y, cuando aplica, el
 * `addonId` que causó el fallo (p. ej. una extracción que devolvió exit ≠ éxito),
 * para trazabilidad y mensajes de usuario precisos (AC 6.12).
 */
export type OperationResult =
  | {
      ok: true;
      report?: MergeReport;
      installedManifest?: AddonManifestEntry[];
    }
  | {
      ok: false;
      error: string;
      addonId?: string;
    };
