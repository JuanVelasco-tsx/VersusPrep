import { useEffect, useRef, useState } from "react";

import type {
  ActiveSetPreview,
  AddonManifestEntry,
  OperationResult,
  ScannedAddon,
} from "../../main/domain/index.js";
import { MergeSummaryPanel } from "./MergeSummaryPanel.js";
import { publishOperation } from "./OperationOverlay.js";
import { PriorityRow, type CollisionSummary } from "./PriorityRow.js";
import styles from "./ActiveSetPanel.module.css";

const PREVIEW_DEBOUNCE_MS = 350;

/**
 * Estado de carga inicial del panel (misma union discriminada por `phase` que
 * `AddonList`). Carga `getActiveSet()` (Active_Set persistido) y
 * `scanAddons()` en paralelo: el segundo solo se usa para resolver titulos
 * legibles por `addonId` (esta pantalla no necesita nada mas del escaneo).
 */
type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; titles: Record<string, string> }
  | { phase: "error"; message: string };

/** Estado del preview de solo lectura (`previewActiveSet`), debounced. */
export type PreviewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; preview: ActiveSetPreview }
  | { phase: "error"; message: string };

/** Estado del resultado de "Aplicar" (`applyActiveSet`). */
export type ApplyState =
  | { phase: "idle" }
  | { phase: "applying" }
  | { phase: "done"; result: OperationResult }
  | { phase: "error"; message: string };

/**
 * Renormaliza `priorityOrder` a la posicion en el array (0, 1, 2, ...). El
 * reordenamiento de este panel es solo con flechas (mover una posicion arriba
 * o abajo), nunca "insertar en una posicion arbitraria" - no hace falta
 * preservar los valores de `priorityOrder` originales del manifest, alcanza
 * con que el ORDEN relativo quede reflejado. Se aplica cada vez que el orden
 * local cambia, para que el array local siga siendo la unica fuente de verdad
 * del Priority_Order candidato (lo que se manda a preview/apply).
 *
 * DECISION: estos valores renormalizados (0, 1, 2, ...) son los que se
 * PERSISTEN tal cual al llamar `applyActiveSet` (via `entries`) - pisan
 * cualquier `priorityOrder` previo del manifest, incluido el `Date.now()`
 * que usa el checkbox "Incluir" de `AddonRow` para addAddon (ver DECISION en
 * AddonRow.tsx). Es intencional: al `MergeOrchestrator` solo le importa el
 * ORDEN RELATIVO ascendente entre addons ("el ultimo del Priority_Order
 * gana"), nunca el valor absoluto de `priorityOrder` - renormalizar a
 * posicion secuencial preserva ese orden relativo sin necesidad de calcular
 * huecos ni de conservar los valores originales (que de todos modos son
 * arbitrarios/no-semanticos, ver Date.now() en AddonRow).
 */
function withSequentialPriority(entries: AddonManifestEntry[]): AddonManifestEntry[] {
  return entries.map((entry, index) => ({ ...entry, priorityOrder: index }));
}

function sortedByPriority(entries: AddonManifestEntry[]): AddonManifestEntry[] {
  return [...entries].sort((a, b) => a.priorityOrder - b.priorityOrder);
}

/**
 * Intercambia las posiciones `i`/`j` de `entries` (nuevo array). Con
 * `noUncheckedIndexedAccess`, un acceso indexado puede ser `undefined`; los
 * llamadores (`moveUp`/`moveDown`) ya validan que `i`/`j` estan en rango, asi
 * que el chequeo de abajo nunca deberia disparar - se mantiene igual para que
 * el compilador lo garantice sin recurrir a `!`.
 */
function swap(entries: AddonManifestEntry[], i: number, j: number): AddonManifestEntry[] {
  const a = entries[i];
  const b = entries[j];
  if (a === undefined || b === undefined) return entries;
  const next = [...entries];
  next[i] = b;
  next[j] = a;
  return next;
}

function titleFor(addon: ScannedAddon): string {
  return addon.info?.title ?? addon.id;
}

/**
 * Cuenta, por addonId, cuantos archivos gana/pierde en las colisiones del
 * preview actual (`FileCollision.winner` vs. `contributors`). Vacio si no hay
 * preview listo todavia.
 */
function buildCollisionSummaries(
  preview: ActiveSetPreview | null,
  entries: AddonManifestEntry[],
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

/**
 * Panel "Activos" (Seccion 21.2 UI): muestra el Active_Set instalado con
 * reordenamiento de Priority_Order por flechas compactas (mockup "2b"), un
 * preview de solo lectura debounced, y el cableado minimo de Aplicar/
 * Descartar. Integracion DESACOPLADA de `AddonList`/`AddonRow` (decision
 * cerrada, opcion B - ver Context/05-plan-seccion-21-restante.md): este panel
 * no comparte estado con la biblioteca, refetchea su propio `getActiveSet()`
 * cada vez que se muestra.
 */
export function ActiveSetPanel() {
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [entries, setEntries] = useState<AddonManifestEntry[]>([]);
  const [previewState, setPreviewState] = useState<PreviewState>({ phase: "idle" });
  const [applyState, setApplyState] = useState<ApplyState>({ phase: "idle" });

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const [activeSet, scanned] = await Promise.all([
          window.l4d2Api.getActiveSet(),
          window.l4d2Api.scanAddons(),
        ]);
        if (!isMounted.current) return;

        const titles: Record<string, string> = {};
        for (const addon of scanned) {
          titles[addon.id] = titleFor(addon);
        }

        setEntries(withSequentialPriority(sortedByPriority(activeSet)));
        setLoadState({ phase: "ready", titles });
      } catch (error) {
        if (!isMounted.current) return;
        const message = error instanceof Error ? error.message : "Error desconocido.";
        setLoadState({ phase: "error", message });
      }
    }

    void load();
  }, []);

  // Preview debounced (300-400ms): se recalcula cada vez que `entries` cambia
  // (carga inicial incluida), para no disparar una llamada IPC por cada click
  // de flecha mientras el usuario reordena rapido (mitigacion de P-20 -
  // previewActiveSet reescanea toda la Workshop_Folder - no lo arregla, solo
  // evita spamearlo).
  useEffect(() => {
    if (loadState.phase !== "ready") return;

    if (entries.length === 0) {
      setPreviewState({
        phase: "ready",
        preview: { kind: "ready", report: { collisions: [] }, fileCount: 0, unavailable: [] },
      });
      return;
    }

    setPreviewState({ phase: "loading" });
    const timer = setTimeout(() => {
      window.l4d2Api
        .previewActiveSet(entries)
        .then((preview) => {
          if (!isMounted.current) return;
          setPreviewState({ phase: "ready", preview });
        })
        .catch((error: unknown) => {
          if (!isMounted.current) return;
          const message = error instanceof Error ? error.message : "Error desconocido.";
          setPreviewState({ phase: "error", message });
        });
    }, PREVIEW_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [entries, loadState.phase]);

  const moveUp = (index: number): void => {
    if (index === 0) return;
    setEntries(withSequentialPriority(swap(entries, index - 1, index)));
  };

  const moveDown = (index: number): void => {
    if (index === entries.length - 1) return;
    setEntries(withSequentialPriority(swap(entries, index, index + 1)));
  };

  // El feedback real de "Aplicar" ahora vive en OperationOverlay (21.4, modal
  // bloqueante compartido por apply/add/remove) - publishOperation ANTES de
  // la llamada (para que el overlay se muestre en "running" de inmediato) y
  // con el resultado final, sea cual sea su status. `applyState` local sigue
  // existiendo solo para derivar `isApplying` (deshabilitar los botones de
  // MergeSummaryPanel mientras la operacion esta en curso).
  const handleApply = (): void => {
    setApplyState({ phase: "applying" });
    publishOperation({ type: "start", kind: "apply" });
    window.l4d2Api
      .applyActiveSet(entries)
      .then((result) => {
        publishOperation({ type: "result", kind: "apply", result });
        if (!isMounted.current) return;
        setApplyState({ phase: "done", result });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Error desconocido.";
        // Rechazo de la promesa de IPC (no un OperationResult con status
        // "failure" normal) - se traduce igual a un resultado del overlay
        // para no dejarlo colgado en "running" para siempre, ya que ahora es
        // el UNICO feedback visible de "Aplicar".
        publishOperation({ type: "result", kind: "apply", result: { status: "failure", error: message } });
        if (!isMounted.current) return;
        setApplyState({ phase: "error", message });
      });
  };

  // "Descartar": vuelve a pedir el Active_Set persistido, sin tocar `loadState`
  // (los titulos ya resueltos siguen siendo validos - no cambio el escaneo).
  const handleDiscard = (): void => {
    setApplyState({ phase: "idle" });
    window.l4d2Api
      .getActiveSet()
      .then((activeSet) => {
        if (!isMounted.current) return;
        setEntries(withSequentialPriority(sortedByPriority(activeSet)));
      })
      .catch((error: unknown) => {
        if (!isMounted.current) return;
        const message = error instanceof Error ? error.message : "Error desconocido.";
        setPreviewState({ phase: "error", message });
      });
  };

  if (loadState.phase === "loading") {
    return <p className={styles.message}>Cargando Active_Set...</p>;
  }

  if (loadState.phase === "error") {
    return <p className={styles.message}>Error: {loadState.message}</p>;
  }

  const { titles } = loadState;
  const preview = previewState.phase === "ready" ? previewState.preview : null;
  const collisionSummaries = buildCollisionSummaries(preview, entries);
  const unavailableIds = new Set(
    preview !== null && preview.kind === "ready" ? preview.unavailable.map((u) => u.addonId) : [],
  );

  return (
    <div className={styles.panel}>
      <ul className={styles.list}>
        {entries.length === 0 && <li className={styles.message}>El Active_Set esta vacio.</li>}
        {entries.map((entry, index) => (
          <PriorityRow
            key={entry.addonId}
            title={titles[entry.addonId] ?? entry.addonId}
            index={index}
            total={entries.length}
            collisionSummary={collisionSummaries[entry.addonId] ?? null}
            unavailable={unavailableIds.has(entry.addonId)}
            onMoveUp={() => moveUp(index)}
            onMoveDown={() => moveDown(index)}
          />
        ))}
      </ul>
      <MergeSummaryPanel
        entryCount={entries.length}
        previewState={previewState}
        applyState={applyState}
        onApply={handleApply}
        onDiscard={handleDiscard}
      />
    </div>
  );
}
