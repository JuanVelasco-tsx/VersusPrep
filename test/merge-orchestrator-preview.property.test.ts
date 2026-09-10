import fc from "fast-check";
import { expect, test } from "vitest";

import { MergeEngine, MergeOrchestrator, resolveMerge } from "../src/main/domain/index.js";
import type {
  AddonContribution,
  AddonManifestEntry,
  CollisionResolver,
  ExtractedRoot,
  MergeFileSystem,
  MergeReport,
  VpkTool,
} from "../src/main/domain/index.js";
import { propertyName } from "./helpers/property.js";
import { buildOrchestrator } from "./helpers/orchestrator-doubles.js";

/**
 * Property test NUEVO (Sección 21.2, capacidad agregada fuera del scope
 * original — ver `Context/04-historial-decisiones.md`): **Property 16**, no
 * contemplada entre las 15 formalizadas originalmente en `design.md`. Agregada
 * ahí y a `tasks.md` (Correctness Properties) junto con este test.
 *
 * Feature: l4d2-versus-addon-manager, Property 16: Preview y apply reportan
 * las mismas colisiones para el mismo Active_Set
 * **Validates:** el contrato de `MergeOrchestrator.previewActiveSet` (Sección
 * 21.2) frente a `applyActiveSet` (Requirements 6.7, 7.1, 7.2).
 *
 * Invariante: para CUALQUIER Active_Set candidato (sin addons cuyo `list()`
 * falle, para no ensuciar la comparación con el best-effort de DECISIÓN 7) y
 * CUALQUIER contenido de VPK por addon, `previewActiveSet(entries).report`
 * SHALL ser idéntico a `applyActiveSet(entries).report`, y
 * `previewActiveSet(entries).fileCount` SHALL ser igual a la cantidad de paths
 * únicos que reporta la fusión real.
 *
 * ---------------------------------------------------------------------------
 * QUÉ UNIDAD REAL SE PRUEBA vs. QUÉ MODELA EL TEST
 *
 * A diferencia de `merge-orchestrator.property.test.ts` (Property 13), que usa
 * el `FakeMergeEngine` de `orchestrator-doubles.ts` (devuelve un `MergeReport`
 * fijo, sin ejecutar lógica real), ESTE test conecta un `MergeEngine` REAL a un
 * `VpkTool` fake que expone, por addonId, el MISMO listado de paths para AMBOS
 * caminos. Con un `FakeMergeEngine` la comparación preview-vs-apply sería
 * trivial (compararía la misma constante contra sí misma); con un `MergeEngine`
 * real, `previewActiveSet` atraviesa `MergeEngine.preview` (list → resolveMerge)
 * y `applyActiveSet` atraviesa `MergeEngine.merge` (list → extract fake →
 * `CollisionResolver.mergeInto` fake, que SINTETIZA las mismas contribuciones
 * desde el mismo listado y delega en el MISMO `resolveMerge` puro de
 * `collision-core.ts`, Property 11). `extract`/`pack`/`ensureDir` son no-ops que
 * NO tocan disco: lo que se compara es que las DOS rutas de orquestación
 * (preview vs. apply) construyan las mismas `AddonContribution` a partir de la
 * misma fuente de datos (`VpkTool.list`), no que `resolveMerge` sea correcto
 * (eso ya lo prueba la Property 11).
 * ---------------------------------------------------------------------------
 */

/** Paths internos de VPK de ejemplo, deliberadamente pocos para maximizar colisiones. */
const PATH_POOL = [
  "materials/a.vmt",
  "materials/b.vmt",
  "models/c.mdl",
  "scripts/vscripts/d.nut",
  "sound/e.wav",
] as const;

const addonIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 6 });
const listingArb: fc.Arbitrary<string[]> = fc.uniqueArray(fc.constantFrom(...PATH_POOL), {
  minLength: 0,
  maxLength: PATH_POOL.length,
});

/** Un Active_Set candidato con addonIds ÚNICOS, cada uno con su Priority_Order y su listado de VPK. */
const scenarioArb: fc.Arbitrary<{
  entries: AddonManifestEntry[];
  listings: Map<string, string[]>;
}> = fc
  .uniqueArray(fc.tuple(addonIdArb, fc.integer({ min: 0, max: 50 }), listingArb), {
    minLength: 0,
    maxLength: 6,
    selector: (tuple) => tuple[0],
  })
  .map((tuples) => ({
    entries: tuples.map(([addonId, priorityOrder]) => ({ addonId, priorityOrder })),
    listings: new Map(tuples.map(([addonId, , paths]) => [addonId, paths])),
  }));

/** Doble estructural de VpkTool: list() devuelve el listado fijo por addonId; extract/pack son no-ops. */
class FakeVpkTool {
  constructor(private readonly listings: ReadonlyMap<string, string[]>) {}
  list(_vpkPath: string, addonId: string): Promise<string[]> {
    return Promise.resolve(this.listings.get(addonId) ?? []);
  }
  extract(): Promise<void> {
    return Promise.resolve();
  }
  pack(): Promise<string> {
    return Promise.resolve("C:\\work\\pak01_dir.vpk");
  }
}

/** No crea nada: MergeEngine.merge() solo lo usa para el workDir de extracción. */
const NOOP_FS: MergeFileSystem = { ensureDir: () => Promise.resolve() };

/**
 * CollisionResolver fake que NO camina disco: sintetiza las `AddonContribution`
 * desde el MISMO `listings` que usa `FakeVpkTool.list`, y delega en el `resolveMerge`
 * puro REAL (el mismo que usa `MergeEngine.preview`) para producir el `MergeReport`.
 */
class ContributionCollisionResolver {
  constructor(private readonly listings: ReadonlyMap<string, string[]>) {}
  mergeInto(_destDir: string, extractedRoots: readonly ExtractedRoot[]): Promise<MergeReport> {
    const contributions: AddonContribution[] = extractedRoots.map((root) => ({
      addonId: root.addonId,
      relativePaths: this.listings.get(root.addonId) ?? [],
    }));
    return Promise.resolve(resolveMerge(contributions).report);
  }
}

test(
  propertyName(16, "Preview y apply reportan las mismas colisiones para el mismo Active_Set"),
  async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ entries, listings }) => {
        const h = buildOrchestrator({ scannedIds: entries.map((e) => e.addonId) });
        const mergeEngine = new MergeEngine(
          new FakeVpkTool(listings) as unknown as VpkTool,
          NOOP_FS,
          new ContributionCollisionResolver(listings) as unknown as CollisionResolver,
        );
        const orch = new MergeOrchestrator({ ...h.deps, mergeEngine });

        const preview = await orch.previewActiveSet(entries);
        const applied = await orch.applyActiveSet(entries);

        expect(preview.kind).toBe("ready");
        expect(applied.status).toBe("success");
        if (preview.kind !== "ready" || applied.status !== "success") return;

        // INVARIANTE: mismas colisiones por las dos rutas independientes.
        expect(preview.report).toEqual(applied.report ?? { collisions: [] });

        // El fileCount del preview coincide con la cantidad de paths únicos
        // reales (unión de todos los listados, tal como los reporta resolveMerge).
        const expectedFileCount = resolveMerge(
          entries.map((e) => ({
            addonId: e.addonId,
            relativePaths: listings.get(e.addonId) ?? [],
          })),
        ).winners.size;
        expect(preview.fileCount).toBe(expectedFileCount);
      }),
      { numRuns: 100 },
    );
  },
);
