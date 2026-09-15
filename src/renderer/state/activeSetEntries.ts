/**
 * Lógica PURA de manipulación de `AddonManifestEntry[]` para el Active_Set
 * candidato de "Activos" (rediseño Paso 3/8, extraída de `ActiveSetPanel.tsx`
 * al lift de estado hacia `useActiveSetState`). Mismo motivo que
 * `pendingSelection.ts`/`presetSwitcher.ts` — testeable sin jsdom (no hay
 * infraestructura de eso en este proyecto todavía, ver Context/02-pendientes.md).
 */
import type { ActiveSetPreview, AddonManifestEntry } from "../../main/domain/index.js";
import type { CollisionSummary } from "../components/PriorityRow.js";

/**
 * Renormaliza `priorityOrder` a la posición en el array (0, 1, 2, ...). Ver
 * DECISIÓN original en `ActiveSetPanel.tsx` (antes de este Paso 3): el
 * `MergeOrchestrator` solo le importa el orden RELATIVO ascendente, nunca el
 * valor absoluto — renormalizar a posición secuencial preserva ese orden sin
 * necesitar huecos ni conservar los valores originales.
 */
export function withSequentialPriority(entries: AddonManifestEntry[]): AddonManifestEntry[] {
  return entries.map((entry, index) => ({ ...entry, priorityOrder: index }));
}

/** Copia de `entries` ordenada ascendente por `priorityOrder`. */
export function sortedByPriority(entries: AddonManifestEntry[]): AddonManifestEntry[] {
  return [...entries].sort((a, b) => a.priorityOrder - b.priorityOrder);
}

/**
 * Intercambia las posiciones `i`/`j` de `entries` (nuevo array). Con
 * `noUncheckedIndexedAccess`, un acceso indexado puede ser `undefined`; los
 * llamadores (`moveUp`/`moveDown` en `ActiveSetPanel.tsx`) ya validan que
 * `i`/`j` están en rango, así que el chequeo de abajo nunca debería
 * disparar — se mantiene igual para que el compilador lo garantice sin
 * recurrir a `!`.
 */
export function swap(entries: AddonManifestEntry[], i: number, j: number): AddonManifestEntry[] {
  const a = entries[i];
  const b = entries[j];
  if (a === undefined || b === undefined) return entries;
  const next = [...entries];
  next[i] = b;
  next[j] = a;
  return next;
}

/**
 * `true` si `a`/`b` representan el MISMO Active_Set candidato: mismos
 * `addonId` en el mismo ORDEN (el `priorityOrder` en sí no se compara — tras
 * `withSequentialPriority` es siempre 0,1,2..., así que comparar el orden de
 * los ids alcanza y es más barato). Usado por `useActiveSetState` para
 * derivar el hallazgo "Cambios sin aplicar" del panel derecho (README `2a`,
 * Paso 3/8): compara el candidato en memoria contra el último baseline
 * persistido (carga inicial, o tras un Aplicar/Descartar exitoso).
 */
export function entriesEqualByOrder(
  a: readonly AddonManifestEntry[],
  b: readonly AddonManifestEntry[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, index) => entry.addonId === b[index]?.addonId);
}

/**
 * Cuenta, por addonId, cuántos archivos gana/pierde en las colisiones de
 * `preview` (`FileCollision.winner` vs. `contributors`). Vacío si no hay
 * preview listo todavía. Extraída de `ActiveSetPanel.tsx` (Paso 3/8, sin
 * cambios de lógica) porque ahora la consume TAMBIÉN `AddonList.tsx` — el
 * chip "⇄ N" y el texto "comparte N archivos" de Biblioteca (README `2a`)
 * usan el MISMO preview compartido (`useActiveSetState`) que ya alimentaba
 * solo a Activos, para no tener dos previews independientes desincronizables.
 */
export function buildCollisionSummaries(
  preview: ActiveSetPreview | null,
  entries: readonly AddonManifestEntry[],
): Record<string, CollisionSummary> {
  const summaries: Record<string, CollisionSummary> = {};
  if (preview === null || preview.kind !== "ready") return summaries;

  for (const entry of entries) {
    summaries[entry.addonId] = { wins: 0, losses: 0 };
  }
  for (const collision of preview.report.collisions) {
    for (const contributor of collision.contributors) {
      const summary = summaries[contributor];
      if (summary === undefined) continue;
      if (collision.winner === contributor) {
        summary.wins += 1;
      } else {
        summary.losses += 1;
      }
    }
  }
  return summaries;
}
