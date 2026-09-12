import fc from "fast-check";
import { expect } from "vitest";

import { MergeOrchestrator } from "../src/main/domain/index.js";
import type { AddonManifestEntry, GamePaths } from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";
import { buildOrchestrator } from "./helpers/orchestrator-doubles.js";

/**
 * BUG-009 — Preservation Checking (Property 2).
 *
 * Feature: l4d2-versus-addon-manager, Property 2: Comportamiento con `modsvs` ya
 * resuelto e inputs no-buggy (`¬C(X)`).
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**
 *
 * OBJETIVO: para CUALQUIER input NO-buggy (`¬C(X)`) —es decir, con `modsvs` ya
 * correctamente resuelto y presente, `modsvsFolder = <gameRoot>\modsvs`— el fix NO
 * altera el comportamiento observable de la materialización respecto de lo esperado.
 *
 * MATIZ (por qué NO se compara la secuencia literal de eventos de progreso):
 * El design.md planteaba "comparar la secuencia de llamadas F (sin fix) vs F' (con
 * fix) y asertar que es IDÉNTICA". Pero (a) el fix YA está aplicado en el código
 * (no hay un F "sin fix" disponible en runtime sin revertir), y (b) el fix cambió A
 * PROPÓSITO la secuencia del canal de PROGRESO (agregó un `#emit("backup")` extra
 * antes del `ensureDir(modsvsFolder)`). Ese cambio de progreso se ajusta en la
 * tarea 8. Por eso acá NO se compara la secuencia de eventos de progreso; la
 * preservación relevante es sobre el comportamiento OBSERVABLE DE LAS ESCRITURAS Y
 * EL RESULTADO cuando `modsvs` ya existe.
 *
 * Property 2 verificada (para cualquier Active_Set válido y gameRoot válido, con
 * `modsvs` YA presente / caso ya funcional `¬C(X)`):
 *   1. La operación termina en status "success".
 *   2. El orden de las ESCRITURAS REALES se preserva:
 *        backup -> install -> gameinfo -> saveManifest
 *      usando el log cronológico de los dobles compartidos (que registran
 *      "backup"/"install"/"gameinfo"/"saveManifest").
 *   3. El destino de install sigue siendo `<gameRoot>\modsvs\pak01_dir.vpk` y el de
 *      backup `<gameRoot>\modsvs\pak01_dir.vpk.backup` (bajo `<gameRoot>\modsvs`,
 *      igual que siempre).
 *   4. El `ensureDir(modsvsFolder)` que agrega el fix es un NO-OP idempotente
 *      cuando `modsvs` ya existe: no cambia el resultado ni el orden observable de
 *      backup/install/gameinfo/saveManifest, ni produce un fallo.
 *
 * NOTA sobre el doble: en `FakeOrchestratorFs`, `ensureDir` SIEMPRE es un no-op (no
 * distingue "existente" de "no existente" y NO escribe en el log cronológico). Esto
 * MODELA fielmente el caso `¬C(X)` (modsvs ya presente): la creación no tiene
 * efecto observable y no falla. Por eso el orden del log (backup/install/gameinfo/
 * saveManifest) es exactamente el que habría sin el `ensureDir` extra.
 *
 * Se varía el Active_Set (cantidad y orden de addons) y el gameRoot, y se confirma
 * que backup -> install -> gameinfo -> saveManifest se preserva para TODOS.
 */

// ---------------------------------------------------------------------------
// Utilidades de ruta Windows (misma convención literal que el dominio: `\`).
// ---------------------------------------------------------------------------

const DISK_SEP = "\\";
const INSTALLED_VPK_NAME = "pak01_dir.vpk";
const BACKUP_SUFFIX = ".backup";

/** Une un directorio con un segmento usando `\` sin duplicar separadores. */
function joinWindows(dir: string, segment: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  const seg = segment.replace(/^[\\/]+/, "");
  return `${trimmed}${DISK_SEP}${seg}`;
}

/** Directorio contenedor de una ruta Windows (`parentDir`). */
function parentDir(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = trimmed.lastIndexOf(DISK_SEP);
  return idx <= 0 ? trimmed : trimmed.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Arbitraries: cualquier `gameRoot` Windows válido con `GamePaths` derivado con la
// MISMA topología que `PathDetector.derivePaths` (modsvsFolder = <gameRoot>\modsvs)
// y cualquier Active_Set válido (cantidad/orden de addons presentes en el escaneo).
// ---------------------------------------------------------------------------

/** Letra de unidad A..Z. */
const driveLetterArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 25 })
  .map((n) => String.fromCharCode(65 + n));

/**
 * Segmento de ruta simple y seguro para Windows: letras/dígitos, guiones, espacios
 * y puntos internos; sin separadores ni caracteres reservados.
 */
const segmentArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,11}[A-Za-z0-9]$/)
  .filter((s) => s.length >= 2);

/** `gameRoot` = `<Drive>:\<seg>\<seg>...` con 1..4 segmentos. */
const gameRootArb: fc.Arbitrary<string> = fc
  .tuple(driveLetterArb, fc.array(segmentArb, { minLength: 1, maxLength: 4 }))
  .map(([drive, segments]) => `${drive}:${DISK_SEP}${segments.join(DISK_SEP)}`);

/** Identificador de addon (dígitos, como los Workshop IDs). */
const addonIdArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 9_999_999 })
  .map((n) => String(n));

/**
 * Active_Set válido: 1..6 addons con ids ÚNICOS. Se devuelve la lista de ids en el
 * orden generado; el `priorityOrder` respeta ese orden (índice). Se exige al menos
 * 1 addon para que el backup/instalar/gameinfo/saveManifest ocurran (un Active_Set
 * vacío es un caso aparte fuera del scope de esta property).
 */
const activeSetArb: fc.Arbitrary<string[]> = fc
  .uniqueArray(addonIdArb, { minLength: 1, maxLength: 6 });

/** Deriva `GamePaths` con la topología exacta de `derivePaths`/`#detectFromGameRoot`. */
function derivePathsForTest(gameRoot: string): GamePaths {
  const left4dead2Dir = joinWindows(gameRoot, "left4dead2");
  return {
    steamPath: `${gameRoot.slice(0, 2)}${DISK_SEP}Steam`,
    gameRoot,
    left4dead2Dir,
    workshopFolder: joinWindows(joinWindows(left4dead2Dir, "addons"), "workshop"),
    vpkToolPath: joinWindows(joinWindows(gameRoot, "bin"), "vpk.exe"),
    gameInfoFile: joinWindows(left4dead2Dir, "gameinfo.txt"),
    modsvsFolder: joinWindows(gameRoot, "modsvs"),
  };
}

/** Filtra el log cronológico a los pasos de ESCRITURA REAL, en orden de aparición. */
function writeSteps(log: readonly string[]): string[] {
  const relevant = new Set(["backup", "install", "gameinfo", "saveManifest"]);
  return log.filter((step) => relevant.has(step));
}

// ---------------------------------------------------------------------------
// Property 2 — Preservation Checking.
// ---------------------------------------------------------------------------

propertyTest(
  2,
  "Comportamiento con modsvs ya resuelto e inputs no-buggy",
  fc.asyncProperty(
    gameRootArb,
    activeSetArb,
    async (gameRoot, activeSetIds) => {
      const paths = derivePathsForTest(gameRoot);
      const expectedModsvs = joinWindows(gameRoot, "modsvs");

      // Active_Set: los ids se generan únicos; el priorityOrder respeta el orden
      // generado (variamos cantidad y orden). Todos presentes en el escaneo para
      // no fallar por "addon ausente" (DECISIÓN 5 del orquestador).
      const entries: AddonManifestEntry[] = activeSetIds.map((addonId, i) => ({
        addonId,
        priorityOrder: i,
      }));

      const harness = buildOrchestrator({ scannedIds: activeSetIds });
      // Override de rutas por-iteración con el gameRoot generado (los dobles usan
      // un TEST_PATHS fijo; acá inyectamos la topología derivada `¬C(X)`).
      harness.deps.paths = paths;
      // `modsvs` YA presente / caso ya funcional (`¬C(X)`): en el doble, `ensureDir`
      // es SIEMPRE no-op, lo que MODELA que la carpeta ya existe (la creación no
      // tiene efecto observable ni falla). Además `sourceExists=true` para que el
      // paso "backup" sea observable en el log (copia el .backup y lo registra).
      harness.backupFs.existing = true;

      const orchestrator = new MergeOrchestrator(harness.deps);
      const result = await orchestrator.applyActiveSet(entries);

      // (1) La operación termina en success.
      expect(result.status).toBe("success");

      // (2) El orden de las ESCRITURAS REALES se preserva exactamente:
      //     backup -> install -> gameinfo -> saveManifest.
      expect(writeSteps(harness.log)).toEqual([
        "backup",
        "install",
        "gameinfo",
        "saveManifest",
      ]);

      // (3) Destinos bajo <gameRoot>\modsvs, igual que siempre:
      //     install -> <gameRoot>\modsvs\pak01_dir.vpk
      //     backup  -> <gameRoot>\modsvs\pak01_dir.vpk.backup
      const expectedInstall = joinWindows(expectedModsvs, INSTALLED_VPK_NAME);
      const expectedBackup = joinWindows(
        expectedModsvs,
        `${INSTALLED_VPK_NAME}${BACKUP_SUFFIX}`,
      );
      expect(harness.fs.installDest).toBe(expectedInstall);
      expect(harness.backupFs.backupDest).toBe(expectedBackup);
      expect(parentDir(harness.fs.installDest as string)).toBe(expectedModsvs);
      expect(parentDir(harness.backupFs.backupDest as string)).toBe(
        expectedModsvs,
      );

      // (4) El ensureDir(modsvsFolder) del fix es un NO-OP idempotente con `modsvs`
      //     ya presente: NO aparece en el log de escrituras reales (no altera el
      //     orden observable) y no produjo un fallo (result.status === "success").
      //     Se registró en `ensuredDirs` (el fix lo invoca) pero SIN contaminar el
      //     log cronológico, confirmando que su presencia no cambia nada.
      expect(harness.fs.ensuredDirs).toContain(expectedModsvs);
      expect(harness.log).not.toContain(`ensureDir:${expectedModsvs}`);
      // El log de escrituras reales tiene EXACTAMENTE los 4 pasos esperados, ni uno
      // más: el ensureDir extra no agregó ningún paso observable de escritura.
      expect(writeSteps(harness.log)).toHaveLength(4);
    },
  ),
  { numRuns: 100 },
);
