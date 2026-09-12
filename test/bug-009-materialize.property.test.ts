import fc from "fast-check";
import { expect } from "vitest";

import { MergeOrchestrator } from "../src/main/domain/index.js";
import type { AddonManifestEntry, GamePaths } from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";
import { buildOrchestrator } from "./helpers/orchestrator-doubles.js";

/**
 * BUG-009 — Fix Checking (Property 1).
 *
 * Feature: l4d2-versus-addon-manager, Property 1: El Merged_Package y su backup
 * quedan bajo `<gameRoot>\modsvs\`
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
 *
 * Garantía UNIVERSAL (mín. 100 iteraciones) del comportamiento correcto tras el
 * fix (tareas 2/3/4 ya aplicadas): para CUALQUIER `gameRoot` Windows válido, al
 * materializar una fusión (`applyActiveSet` → `#materialize`):
 *
 *   1. `parentDir(installTarget) === joinWindows(gameRoot, "modsvs")` — el
 *      `pak01_dir.vpk` instalado cuelga de `<gameRoot>\modsvs`, nunca de la raíz.
 *   2. `parentDir(backupPath) === joinWindows(gameRoot, "modsvs")` — el `.backup`
 *      cuelga de `<gameRoot>\modsvs` (con `sourceExists=true` para que
 *      `BackupManager` copie y registre el destino).
 *   3. `ensureDir(<gameRoot>\modsvs)` fue invocado ANTES del paso de backup.
 *
 * Reutiliza el patrón de arbitraries de `merge-orchestrator.property.test.ts` y los
 * dobles en memoria de `test/helpers/orchestrator-doubles.ts` (extendidos para
 * capturar `installDest`/`backupDest` y el orden de `ensureDir` vs. `backup`). NO
 * toca disco, `vpk.exe` ni procesos reales.
 */

// ---------------------------------------------------------------------------
// Utilidades de ruta Windows (misma convención literal que el dominio: `\`).
// ---------------------------------------------------------------------------

const DISK_SEP = "\\";

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
// Arbitrary: cualquier `gameRoot` Windows válido y su `GamePaths` derivado con la
// MISMA topología que `PathDetector.derivePaths` (modsvsFolder = <gameRoot>\modsvs,
// workshopFolder = <gameRoot>\left4dead2\addons\workshop, etc.).
// ---------------------------------------------------------------------------

/** Letra de unidad A..Z. */
const driveLetterArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 25 })
  .map((n) => String.fromCharCode(65 + n));

/**
 * Segmento de ruta simple y seguro para Windows: letras/dígitos, guiones, espacios
 * y puntos internos; sin separadores ni caracteres reservados. Se evita terminar
 * en espacio/punto (no relevante para la topología, mantiene el `parentDir` limpio).
 */
const segmentArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,11}[A-Za-z0-9]$/)
  .filter((s) => s.length >= 2);

/** `gameRoot` = `<Drive>:\<seg>\<seg>...` con 1..4 segmentos. */
const gameRootArb: fc.Arbitrary<string> = fc
  .tuple(driveLetterArb, fc.array(segmentArb, { minLength: 1, maxLength: 4 }))
  .map(([drive, segments]) => `${drive}:${DISK_SEP}${segments.join(DISK_SEP)}`);

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

// ---------------------------------------------------------------------------
// Property 1 — Fix Checking.
// ---------------------------------------------------------------------------

propertyTest(
  1,
  "El Merged_Package y su backup quedan bajo <gameRoot>\\modsvs",
  fc.asyncProperty(gameRootArb, async (gameRoot) => {
    const paths = derivePathsForTest(gameRoot);
    const expectedModsvs = joinWindows(gameRoot, "modsvs");

    // Un Active_Set mínimo con un addon presente en el escaneo (para no fallar por
    // "addon ausente", DECISIÓN 5 del orquestador).
    const entries: AddonManifestEntry[] = [{ addonId: "a", priorityOrder: 0 }];

    const harness = buildOrchestrator({ scannedIds: ["a"] });
    // Override de las rutas por-iteración con el gameRoot generado (los dobles
    // compartidos usan un TEST_PATHS fijo; acá inyectamos la topología derivada).
    harness.deps.paths = paths;
    // Que exista un pak01_dir.vpk previo para que el backup COPIE y registre su
    // destino (backupDest); si no existiera, sería no-op y no habría destino que
    // verificar (Property 1 exige asertar el contenedor del backup).
    harness.backupFs.existing = true;

    const orchestrator = new MergeOrchestrator(harness.deps);
    const result = await orchestrator.applyActiveSet(entries);

    expect(result.status).toBe("success");

    // (1) El .vpk instalado cuelga de <gameRoot>\modsvs.
    expect(harness.fs.installDest).not.toBeNull();
    expect(parentDir(harness.fs.installDest as string)).toBe(expectedModsvs);

    // (2) El .backup cuelga de <gameRoot>\modsvs.
    expect(harness.backupFs.backupDest).not.toBeNull();
    expect(parentDir(harness.backupFs.backupDest as string)).toBe(expectedModsvs);

    // (3) ensureDir(<gameRoot>\modsvs) se invocó, y ANTES del paso de backup.
    expect(harness.fs.ensuredDirs).toContain(expectedModsvs);
    const modsvsEnsureIdx = harness.fs.ensureDirLogIndex.get(expectedModsvs);
    const backupIdx = harness.log.indexOf("backup");
    expect(modsvsEnsureIdx).not.toBeUndefined();
    expect(backupIdx).toBeGreaterThanOrEqual(0);
    // El índice capturado al hacer ensureDir(modsvs) es la longitud del log ANTES
    // de registrarse "backup", por lo que debe ser <= al índice de "backup".
    expect(modsvsEnsureIdx as number).toBeLessThanOrEqual(backupIdx);
  }),
  { numRuns: 100 },
);
