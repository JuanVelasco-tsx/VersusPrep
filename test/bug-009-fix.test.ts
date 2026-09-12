import { describe, expect, test } from "vitest";

import { MergeOrchestrator, PathDetector } from "../src/main/domain/index.js";
import type { OrchestratorHarness } from "./helpers/orchestrator-doubles.js";
import type {
  AddonManifestEntry,
  FileReadResult,
  FileSystemProbe,
  ManualPathProvider,
  ManualPathRequest,
  ManualPathResponse,
  RegistryReader,
} from "../src/main/domain/index.js";
import {
  TEST_PATHS,
  buildOrchestrator,
} from "./helpers/orchestrator-doubles.js";

/**
 * BUG-009 — UNIT TESTS CONCRETOS del fix (tarea 7 del spec
 * `.kiro/specs/bug-009-merge-no-crea-modsvs`).
 *
 * A diferencia de los property tests (tareas 5 y 6), acá se fijan EJEMPLOS
 * concretos y edge cases puntuales del fix ya aplicado:
 *
 *   1. Orden de `ensureDir`: `#materialize` crea `<gameRoot>\modsvs` ANTES del backup.
 *   2. Instalación fresca: `installTarget` y `backupPath` cuelgan de `<gameRoot>\modsvs`.
 *   3. `PathDetector` ya NO pide `modsvs` como ruta preexistente (fresca sin modsvs).
 *   4. EACCES/EPERM al crear `modsvs` dispara el manejo reactivo (status "elevating").
 *   5. Regresión del bug pegajoso: `detect()` re-deriva `modsvsFolder = <gameRoot>\modsvs`.
 *
 * Reutiliza los dobles compartidos (`test/helpers/orchestrator-doubles.ts`) para
 * los casos del orquestador y el patrón de mocks de `test/path-detector.test.ts`
 * (Registry/Fs/Manual) para los de detección.
 *
 * Requisitos cubiertos: 2.1, 2.2, 2.3, 2.4, 3.3, 3.7.
 */

// ---------------------------------------------------------------------------
// Utilidades de ruta Windows (mismas convenciones que el dominio).
// ---------------------------------------------------------------------------

const DISK_SEP = "\\";

/** Directorio contenedor de una ruta Windows (`parentDir`). */
function parentDir(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = trimmed.lastIndexOf(DISK_SEP);
  return idx <= 0 ? trimmed : trimmed.slice(0, idx);
}

// `TEST_PATHS.modsvsFolder` ya es `<gameRoot>\modsvs` (corregido para BUG-009).
const MODSVS = TEST_PATHS.modsvsFolder;
const INSTALL_TARGET = `${MODSVS}${DISK_SEP}pak01_dir.vpk`;
const BACKUP_TARGET = `${MODSVS}${DISK_SEP}pak01_dir.vpk.backup`;

/** Un Active_Set candidato mínimo (un addon con priorityOrder 0). */
const ENTRIES: AddonManifestEntry[] = [{ addonId: "a", priorityOrder: 0 }];

/**
 * `buildOrchestrator` devuelve solo los dobles y las `deps`; el MergeOrchestrator
 * real se construye acá a partir de ellas (mismo criterio que los tests que usan
 * los dobles compartidos).
 */
function orchestratorFrom(h: OrchestratorHarness): MergeOrchestrator {
  return new MergeOrchestrator(h.deps);
}

// ===========================================================================
// CASO 1 — Orden de ensureDir: modsvs se crea ANTES del paso de backup.
//
// Requisitos: 2.1 (crear modsvs antes de respaldar e instalar).
// ===========================================================================

describe("BUG-009 caso 1) ensureDir(<gameRoot>\\modsvs) ocurre ANTES del backup", () => {
  test("modsvs está en ensuredDirs y su índice precede al del paso 'backup'", async () => {
    // backupFs.existing=true para que el BackupManager copie y registre "backup"
    // en el log: sólo así el orden relativo modsvs -> backup es observable
    // (con existing=false el backup es un no-op y no registra nada).
    const h = buildOrchestrator({ scannedIds: ["a"] });
    h.backupFs.existing = true;

    const result = await orchestratorFrom(h).applyActiveSet(ENTRIES);
    expect(result.status).toBe("success");

    // La carpeta modsvs debe haberse creado.
    expect(h.fs.ensuredDirs).toContain(MODSVS);

    // El ensureDir(modsvs) debe registrarse ANTES del paso "backup".
    // `ensureDirLogIndex` captura la posición del log en el instante del ensureDir;
    // el "backup" se agrega al log cuando BackupManager copia.
    const modsvsIndex = h.fs.ensureDirLogIndex.get(MODSVS);
    const backupIndex = h.log.indexOf("backup");
    expect(modsvsIndex).toBeDefined();
    expect(backupIndex).toBeGreaterThanOrEqual(0);
    expect(modsvsIndex as number).toBeLessThanOrEqual(backupIndex);
  });
});

// ===========================================================================
// CASO 2 — Instalación fresca: install y backup bajo <gameRoot>\modsvs.
//
// El doble `ensureDir` es siempre no-op, así que modela tanto "modsvs existe"
// como "no existe": para la instalación fresca alcanza el flujo normal.
//
// Requisitos: 2.1, 2.2, 2.4.
// ===========================================================================

describe("BUG-009 caso 2) install y backup cuelgan de <gameRoot>\\modsvs, nunca de la raíz", () => {
  test("installDest = <gameRoot>\\modsvs\\pak01_dir.vpk", async () => {
    const h = buildOrchestrator({ scannedIds: ["a"] });

    const result = await orchestratorFrom(h).applyActiveSet(ENTRIES);
    expect(result.status).toBe("success");

    expect(h.fs.installDest).toBe(INSTALL_TARGET);
    expect(parentDir(h.fs.installDest as string)).toBe(MODSVS);
  });

  test("backupDest = <gameRoot>\\modsvs\\pak01_dir.vpk.backup", async () => {
    // existing=true para que el backup copie y registre su destino.
    const h = buildOrchestrator({ scannedIds: ["a"] });
    h.backupFs.existing = true;

    const result = await orchestratorFrom(h).applyActiveSet(ENTRIES);
    expect(result.status).toBe("success");

    expect(h.backupFs.backupDest).toBe(BACKUP_TARGET);
    expect(parentDir(h.backupFs.backupDest as string)).toBe(MODSVS);
  });
});

// ===========================================================================
// CASO 4 — EACCES/EPERM al crear modsvs dispara el manejo reactivo.
//
// El fix envuelve `ensureDir(modsvsFolder)` en `#writeStep`, así que un error de
// permisos NO aborta con failure: pasa por `handleWriteFailure`, que devuelve
// `elevated-handoff` y el orquestador retorna `status: "elevating"`.
//
// Requisitos: 3.3 (manejo reactivo de permisos preservado).
// ===========================================================================

describe("BUG-009 caso 4) EACCES/EPERM al crear modsvs -> status 'elevating' (no aborta)", () => {
  test("ensureDir(modsvs) lanza EACCES y el resultado es 'elevating'", async () => {
    const h = buildOrchestrator({ scannedIds: ["a"] });
    // El doble compartido lanza SOLO cuando el dir es el modsvsFolder (el workDir
    // sigue siendo no-op).
    h.fs.throwOnEnsureDir(MODSVS, () => {
      const err = new Error("permiso denegado al crear modsvs") as NodeJS.ErrnoException;
      err.code = "EACCES";
      return err;
    });
    // El ElevationService, ante un fallo de permisos, cede el trabajo a la
    // instancia elevada (elevated-handoff).
    h.elevation.handleWriteFailureOutcome = { kind: "elevated-handoff" };

    const result = await orchestratorFrom(h).applyActiveSet(ENTRIES);

    expect(result.status).toBe("elevating");
    // Se manejó reactivamente (no se abortó con failure).
    expect(h.elevation.log).toContain("handleWriteFailure");
    // No se llegó a instalar ni a persistir el manifest (se cortó en la creación).
    expect(h.fs.installDest).toBeNull();
    expect(h.log).not.toContain("saveManifest");
  });

  test("también con EPERM el resultado es 'elevating'", async () => {
    const h = buildOrchestrator({ scannedIds: ["a"] });
    h.fs.throwOnEnsureDir(MODSVS, () => {
      const err = new Error("operación no permitida al crear modsvs") as NodeJS.ErrnoException;
      err.code = "EPERM";
      return err;
    });
    h.elevation.handleWriteFailureOutcome = { kind: "elevated-handoff" };

    const result = await orchestratorFrom(h).applyActiveSet(ENTRIES);

    expect(result.status).toBe("elevating");
    expect(h.elevation.log).toContain("handleWriteFailure");
  });
});

// ===========================================================================
// Casos 3 y 5 — a nivel PathDetector.detect() (patrón de path-detector.test.ts).
// ===========================================================================

const STEAM = "C:\\Program Files (x86)\\Steam";
const LIB = "D:\\SteamLibrary";
const GAME_ROOT = "D:\\SteamLibrary\\steamapps\\common\\Left 4 Dead 2";
const L4D2_DIR = `${GAME_ROOT}\\left4dead2`;
const WORKSHOP = `${L4D2_DIR}\\addons\\workshop`;
const VPK_TOOL = `${GAME_ROOT}\\bin\\vpk.exe`;
const GAMEINFO = `${L4D2_DIR}\\gameinfo.txt`;
const EXPECTED_MODSVS = `${GAME_ROOT}\\modsvs`;
const VDF_PATH = `${STEAM}\\steamapps\\libraryfolders.vdf`;

/** VDF con L4D2 (550) en la biblioteca D:. */
function vdfWithL4D2OnD(): string {
  return `
"libraryfolders"
{
    "0" { "path" "${STEAM.replace(/\\/g, "\\\\")}" "apps" { "440" "1" } }
    "1" { "path" "${LIB.replace(/\\/g, "\\\\")}" "apps" { "550" "2" } }
}
`;
}

/** RegistryReader mockeado: devuelve un SteamPath fijo. */
class MockRegistry implements RegistryReader {
  constructor(private readonly value: string | null) {}
  async readValue(): Promise<string | null> {
    return this.value;
  }
}

/** FS en memoria: set de rutas existentes + contenidos de archivos de texto. */
class MockFs implements FileSystemProbe {
  #existing: Set<string>;
  #files: Map<string, string>;
  constructor(existing: Iterable<string> = [], files: Iterable<[string, string]> = []) {
    this.#existing = new Set(existing);
    this.#files = new Map(files);
  }
  async readTextFile(path: string): Promise<FileReadResult> {
    const content = this.#files.get(path);
    return content === undefined ? { ok: false } : { ok: true, content };
  }
  async exists(path: string): Promise<boolean> {
    return this.#existing.has(path);
  }
}

/**
 * ManualPathProvider que registra sus requests y respondería con la RAÍZ del
 * juego SI se pidiera `modsvsFolder` (el desvío del bug). Con el fix NO debe
 * llegar a pedirse `modsvsFolder`, así que ese camino nunca se ejercita.
 */
class RootChoosingManual implements ManualPathProvider {
  readonly requests: ManualPathRequest[] = [];
  constructor(private readonly gameRoot: string) {}
  async requestPath(request: ManualPathRequest): Promise<ManualPathResponse> {
    this.requests.push(request);
    if (request.kind === "required-path" && request.pathKey === "modsvsFolder") {
      return { kind: "selected", path: this.gameRoot };
    }
    return { kind: "cancelled" };
  }
}

// ===========================================================================
// CASO 3 — Instalación fresca: PathDetector NO pide modsvs como preexistente.
//
// Las OTRAS 4 rutas requeridas existen; `<gameRoot>\modsvs` NO. Con el fix,
// `modsvsFolder` deja de estar en REQUIRED_PATH_KEYS, así que detect() resuelve
// ready sin marcarla faltante ni pedirla por ManualPathProvider.
//
// Requisitos: 2.3.
// ===========================================================================

describe("BUG-009 caso 3) PathDetector ya no pide modsvs en instalación fresca", () => {
  test("detect() = ready con modsvsFolder = <gameRoot>\\modsvs sin pedir modsvs manualmente", async () => {
    // Instalación fresca: existen las 4 rutas requeridas; `<gameRoot>\modsvs` NO.
    const fs = new MockFs(
      [GAME_ROOT, WORKSHOP, VPK_TOOL, GAMEINFO],
      [[VDF_PATH, vdfWithL4D2OnD()]],
    );
    const manual = new RootChoosingManual(GAME_ROOT);
    const detector = new PathDetector({
      registry: new MockRegistry(STEAM),
      fs,
      manual,
    });

    const result = await detector.detect();

    expect(result.kind).toBe("ready");
    const modsvsFolder =
      result.kind === "ready" ? result.paths.modsvsFolder : undefined;
    expect(modsvsFolder).toBe(EXPECTED_MODSVS);

    // NUNCA se pidió `modsvsFolder` vía selección manual.
    const askedForModsvs = manual.requests.some(
      (r) => r.kind === "required-path" && r.pathKey === "modsvsFolder",
    );
    expect(askedForModsvs).toBe(false);
  });
});

// ===========================================================================
// CASO 5 — Regresión del bug pegajoso: detect() re-deriva modsvsFolder.
//
// El "valor persistido previo" (p. ej. modsvsFolder = <gameRoot>, el desvío del
// bug guardado en LocalStore) es IRRELEVANTE para detect(): detect() NO lee el
// store para derivar, re-deriva desde registro/VDF en cada corrida. Por eso, sin
// importar qué se hubiera persistido antes, el resultado ready.paths.modsvsFolder
// vuelve a ser <gameRoot>\modsvs. Esto es lo que corrige el valor pegajoso cuando
// el handler `detectPaths` re-persiste el resultado.
//
// Requisitos: 2.3 (re-derivación sin selección manual de modsvs).
// ===========================================================================

describe("BUG-009 caso 5) detect() re-deriva modsvsFolder = <gameRoot>\\modsvs (bug pegajoso)", () => {
  test("aun partiendo de un valor persistido incorrecto (<gameRoot>), detect() lo corrige", async () => {
    // Nota de diseño: detect() no consulta el LocalStore para derivar rutas, así
    // que un `modsvsFolder = <gameRoot>` persistido de una sesión buggy no afecta
    // el resultado. Modelamos el escenario post-bug: en disco NO existe modsvs
    // (instalación fresca), sí las 4 requeridas. detect() re-deriva desde el VDF.
    const badPersisted = GAME_ROOT; // valor pegajoso previo (irrelevante para detect())
    expect(badPersisted).not.toBe(EXPECTED_MODSVS); // documenta que era incorrecto

    const fs = new MockFs(
      [GAME_ROOT, WORKSHOP, VPK_TOOL, GAMEINFO],
      [[VDF_PATH, vdfWithL4D2OnD()]],
    );
    const manual = new RootChoosingManual(GAME_ROOT);
    const detector = new PathDetector({
      registry: new MockRegistry(STEAM),
      fs,
      manual,
    });

    const result = await detector.detect();

    // El resultado re-derivado corrige el valor pegajoso: <gameRoot>\modsvs.
    expect(result.kind).toBe("ready");
    const modsvsFolder =
      result.kind === "ready" ? result.paths.modsvsFolder : undefined;
    expect(modsvsFolder).toBe(EXPECTED_MODSVS);
    expect(modsvsFolder).not.toBe(badPersisted);
  });
});
