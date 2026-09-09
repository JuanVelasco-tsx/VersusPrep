import fc from "fast-check";
import { expect } from "vitest";

import { MergeOrchestrator } from "../src/main/domain/index.js";
import { propertyName } from "./helpers/property.js";
import {
  buildOrchestrator,
  type MergeCall,
} from "./helpers/orchestrator-doubles.js";
import type { AddonManifestEntry } from "../src/main/domain/index.js";
import { test } from "vitest";

/**
 * Property test de la Sección 18 (Tarea 18.3).
 *
 * Feature: l4d2-versus-addon-manager, Property 13: Agregar o quitar equivale a una
 * fusión completa desde cero
 * **Validates: Requirements 8.3, 8.4, 8.5**
 *
 * Invariante: para CUALQUIER Active_Set instalado inicial y CUALQUIER operación
 * de add/remove sobre él, el conjunto de addons (y su orden ASCENDENTE por
 * Priority_Order) que el MergeOrchestrator pasa a `MergeEngine.merge` al ejecutar
 * `addAddon`/`removeAddon` es IDÉNTICO al que pasa al ejecutar `applyActiveSet`
 * directamente con el Active_Set FINAL ya resuelto. Es decir: add/remove NO son
 * operaciones incrementales sobre el `.vpk`, sino una fusión completa desde cero
 * del conjunto final (Req 8.3-8.5).
 *
 * ---------------------------------------------------------------------------
 * QUÉ UNIDAD REAL SE PRUEBA vs. QUÉ MODELA EL TEST
 *
 * La unidad de producción bajo prueba es `MergeOrchestrator` (addAddon/removeAddon
 * vs applyActiveSet). `MergeEngine`, `BackupManager`, `GameInfoEditor`,
 * `ProcessGuard`, `ElevationService`, `AddonScanner` y el FS están MOCKEADOS en
 * memoria (dobles), y el doble de MergeEngine REGISTRA con qué `orderedAddons` se
 * lo invocó. El test compara esos argumentos entre los dos caminos; no ejecuta
 * `vpk.exe` ni toca disco. El "Active_Set final resuelto" para el brazo
 * `applyActiveSet` se computa con la MISMA regla inferida que documenta el
 * orquestador (upsert para add, filtro para remove), desde una fuente
 * independiente del código bajo prueba.
 * ---------------------------------------------------------------------------
 */

/** addonId corto y único-friendly. */
const addonIdArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 6 });

/** Un Active_Set instalado inicial con addonIds ÚNICOS. */
const manifestArb: fc.Arbitrary<AddonManifestEntry[]> = fc
  .uniqueArray(addonIdArb, { minLength: 0, maxLength: 6 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc
          .integer({ min: 0, max: 50 })
          .map((priorityOrder) => ({ addonId: id, priorityOrder })),
      ),
    ),
  )
  .map((entries) => entries as AddonManifestEntry[]);

type Op =
  | { kind: "add"; addonId: string; priorityOrder: number }
  | { kind: "remove"; addonId: string };

/** Regla inferida (misma que documenta el orquestador) para resolver el final. */
function resolveFinal(current: AddonManifestEntry[], op: Op): AddonManifestEntry[] {
  if (op.kind === "add") {
    const next = current.filter((e) => e.addonId !== op.addonId);
    next.push({ addonId: op.addonId, priorityOrder: op.priorityOrder });
    return next;
  }
  return current.filter((e) => e.addonId !== op.addonId);
}

/** Ordena por priorityOrder ascendente para comparar contra la llamada a merge. */
function orderedIds(entries: AddonManifestEntry[]): string[] {
  return [...entries].sort((a, b) => a.priorityOrder - b.priorityOrder).map((e) => e.addonId);
}

const scenarioArb = manifestArb.chain((manifest) => {
  const known = manifest.map((e) => e.addonId);
  // El op puede referirse a un addon ya presente (reubica/quita) o a uno nuevo.
  const targetIdArb =
    known.length > 0
      ? fc.oneof(fc.constantFrom(...known), addonIdArb)
      : addonIdArb;
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant("add" as const),
      addonId: targetIdArb,
      priorityOrder: fc.integer({ min: 0, max: 50 }),
    }),
    fc.record({ kind: fc.constant("remove" as const), addonId: targetIdArb }),
  );
  return fc.record({ manifest: fc.constant(manifest), op: opArb });
});

test(
  propertyName(13, "Agregar o quitar equivale a una fusión completa desde cero"),
  async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ manifest, op }) => {
        const finalSet = resolveFinal(manifest, op);
        const expectedOrderedIds = orderedIds(finalSet);

        // TODOS los addonIds que puedan aparecer deben estar en el escaneo, para
        // que el orquestador no falle por "addon ausente" (DECISIÓN 5). Reunimos
        // los del manifest, el del op y los del set final.
        const allIds = new Set<string>([
          ...manifest.map((e) => e.addonId),
          ...finalSet.map((e) => e.addonId),
          op.addonId,
        ]);

        // --- Brazo 1: add/remove sobre el manifest instalado ---
        const armA = buildOrchestrator({
          installedManifest: manifest,
          scannedIds: [...allIds],
        });
        const orchA = new MergeOrchestrator(armA.deps);
        const resA =
          op.kind === "add"
            ? await orchA.addAddon(op.addonId, op.priorityOrder)
            : await orchA.removeAddon(op.addonId);

        // --- Brazo 2: applyActiveSet con el Active_Set final resuelto ---
        const armB = buildOrchestrator({
          installedManifest: manifest,
          scannedIds: [...allIds],
        });
        const orchB = new MergeOrchestrator(armB.deps);
        const resB = await orchB.applyActiveSet(finalSet);

        // Ambos deben tener éxito y haber llamado a merge exactamente una vez.
        expect(resA.status).toBe("success");
        expect(resB.status).toBe("success");
        expect(armA.mergeCalls.length).toBe(1);
        expect(armB.mergeCalls.length).toBe(1);

        // INVARIANTE: los addons (en orden ascendente) pasados a merge coinciden.
        const idsA = mergeCallIds(armA.mergeCalls[0]);
        const idsB = mergeCallIds(armB.mergeCalls[0]);
        expect(idsA).toEqual(expectedOrderedIds);
        expect(idsB).toEqual(expectedOrderedIds);
        expect(idsA).toEqual(idsB);
        return true;
      }),
      { numRuns: 100 },
    );
  },
);

function mergeCallIds(call: MergeCall | undefined): string[] {
  if (call === undefined) return [];
  return call.orderedAddons.map((a) => a.id);
}