/**
 * Estado compartido del Active_Set candidato (entries/preview/apply),
 * extraído de `ActiveSetPanel.tsx` al panel derecho persistente "Estado del
 * preset" del rediseño (README `2a`, Paso 3/8 — decisión de arquitectura
 * confirmada con el usuario, no asumida).
 *
 * POR QUÉ ESTE LIFT ERA NECESARIO: antes de este paso, `entries`/
 * `previewState`/`applyState`/`titles` vivían ENTERAMENTE dentro de
 * `ActiveSetPanel` (integración desacoplada, opción B) — ese panel se
 * remontaba desde cero cada vez que el usuario cambiaba de pestaña
 * (Biblioteca <-> Activos son ramas mutuamente excluyentes del JSX de
 * `App.tsx`), perdiendo el preview/orden en curso. El panel derecho nuevo
 * debe ser "persistente" (visible y funcional desde Biblioteca Y Activos
 * SIN perder ese estado al cambiar de vista) — opción B seguía siendo
 * correcta para todo lo DEMÁS (Biblioteca y Activos no comparten su lógica
 * de escaneo/selección propia), pero específicamente el Active_Set
 * candidato necesitaba un dueño que NO se remonte con la vista.
 *
 * GARANTÍA DE "NO REMONTA" (por qué esto es cierto, no solo una promesa en
 * un comentario): este hook se invoca de forma INCONDICIONAL en el cuerpo de
 * `App()` (`const activeSetState = useActiveSetState(pendingEntries);`),
 * NUNCA dentro de una rama condicional del tipo `{view === "active" && ...}`.
 * Por las reglas de Hooks de React, el estado de un hook vive atado a la
 * POSICIÓN de la llamada dentro del árbol de fibras del componente que lo
 * invoca: mientras `App` seguirá montado (nunca se desmonta — es la raíz),
 * una llamada a `useActiveSetState` que ocurre siempre, en el mismo lugar,
 * en cada render de `App`, NUNCA pierde su estado interno — remontar
 * requeriría que la LLAMADA misma desapareciera de un render al siguiente
 * (como pasa con `<ActiveSetPanel>`, que sí está detrás de `{view === ... &&}`
 * y por eso SÍ se remonta). Cambiar `view` solo hace que `App` re-renderice
 * y que otras ramas del JSX (`<AddonList>`, `<ActiveSetPanel>`, etc.)
 * aparezcan/desaparezcan — no afecta en absoluto a este hook ni a los
 * `useState`/`useEffect` que contiene.
 *
 * `ActiveSetPanel.tsx` deja de ser dueño de este estado: lo recibe como prop
 * (`ActiveSetState`) y sigue siendo dueño SOLO de `moveUp`/`moveDown`/
 * `PriorityRow` (exclusivo de Activos, sin cambios de lógica ni visuales en
 * este paso — eso es Paso 4). `MergeSummaryPanel` (panel derecho) se
 * alimenta del mismo estado desde `App.tsx`, para Biblioteca Y Activos.
 *
 * NOTA DE TESTING: no hay infraestructura para renderizar componentes React
 * en este proyecto (nada de jsdom/@testing-library — confirmado con el
 * usuario, decisión de NO agregarla en este paso). La garantía de "no
 * remonta" de arriba se verifica por LECTURA del código (el call site en
 * `App.tsx`), no con un test de render; lo que SÍ es testeable sin
 * renderizar (la lógica pura de `entries`) vive en `activeSetEntries.ts` y
 * su test.
 */
import { useEffect, useRef, useState } from "react";

import type {
  ActiveSetPreview,
  AddonManifestEntry,
  OperationResult,
} from "../../main/domain/index.js";
import { publishOperation, subscribeOperation } from "../components/OperationOverlay.js";
import { entriesEqualByOrder, sortedByPriority, withSequentialPriority } from "./activeSetEntries.js";
import { resolveActiveSetEntries } from "./pendingSelection.js";
import { isPresetActivationEvent } from "./presetActivation.js";

const PREVIEW_DEBOUNCE_MS = 350;

export type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; titles: Record<string, string> }
  | { phase: "error"; message: string };

export type PreviewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; preview: ActiveSetPreview }
  | { phase: "error"; message: string };

export type ApplyState =
  | { phase: "idle" }
  | { phase: "applying" }
  | { phase: "done"; result: OperationResult }
  | { phase: "error"; message: string };

export interface ActiveSetState {
  loadState: LoadState;
  entries: AddonManifestEntry[];
  setEntries: (entries: AddonManifestEntry[]) => void;
  previewState: PreviewState;
  applyState: ApplyState;
  /**
   * `true` si `entries` (el candidato en memoria) difiere del último
   * baseline persistido (carga inicial, o tras un Aplicar/Descartar
   * exitoso) — hallazgo "Cambios sin aplicar" del panel derecho (README
   * `2a`). Ver `entriesEqualByOrder`.
   */
  hasUnappliedChanges: boolean;
  handleApply: () => void;
  handleDiscard: () => void;
}

/**
 * `pendingEntries`: candidato de un relanzo elevado (BUG-007/BUG-013, ver
 * `App.tsx`) — igual semántica que antes tenía `ActiveSetPanel`, con
 * `resolveActiveSetEntries` decidiendo la fuente de la carga inicial. Ya NO
 * hace falta un flag de consumo separado threadeado desde `App.tsx`
 * (`onPendingConsumed`): antes existía porque `ActiveSetPanel` podía
 * remontar y perder su propio flag local; este hook nunca remonta (ver doc
 * de arriba), así que el guard `hasStarted` de abajo — el mismo patrón que
 * ya usan `AddonList`/`PresetSwitcher` para su propio montaje — alcanza para
 * garantizar que `pendingEntries` se consuma UNA sola vez en toda la vida
 * del proceso. El consumo de `pendingEntries` de `AddonList` (BUG-007, para
 * el checkbox "Incluir") es un concepto DISTINTO y no se toca acá.
 */
export function useActiveSetState(pendingEntries: AddonManifestEntry[] | null): ActiveSetState {
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [entries, setEntriesState] = useState<AddonManifestEntry[]>([]);
  const [baselineEntries, setBaselineEntries] = useState<AddonManifestEntry[]>([]);
  const [previewState, setPreviewState] = useState<PreviewState>({ phase: "idle" });
  const [applyState, setApplyState] = useState<ApplyState>({ phase: "idle" });

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const hasStarted = useRef(false);
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    async function load(): Promise<void> {
      try {
        const [activeSet, titles] = await Promise.all([
          window.l4d2Api.getActiveSet(),
          window.l4d2Api.getTitles(),
        ]);
        if (!isMounted.current) return;
        const entriesSource = resolveActiveSetEntries(activeSet, pendingEntries);
        const withPriority = withSequentialPriority(sortedByPriority(entriesSource));
        setEntriesState(withPriority);
        setBaselineEntries(withPriority);
        setLoadState({ phase: "ready", titles });
      } catch (error) {
        if (!isMounted.current) return;
        const message = error instanceof Error ? error.message : "Error desconocido.";
        setLoadState({ phase: "error", message });
      }
    }

    void load();
    // pendingEntries se lee UNA sola vez, intencionalmente (ver doc de la
    // funcion) — no entra en las deps del efecto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetch al activarse un preset distinto (mismo criterio que ya usaban
  // AddonList/ActiveSetPanel, ver isPresetActivationEvent): el nuevo
  // Active_Set pasa a ser tanto el candidato como el baseline (recien
  // cargado, sin cambios sin aplicar todavia).
  useEffect(() => {
    return subscribeOperation((event) => {
      if (!isPresetActivationEvent(event)) return;
      window.l4d2Api
        .getActiveSet()
        .then((activeSet) => {
          if (!isMounted.current) return;
          const withPriority = withSequentialPriority(sortedByPriority(activeSet));
          setEntriesState(withPriority);
          setBaselineEntries(withPriority);
          setApplyState({ phase: "idle" });
        })
        .catch(() => {
          // Best-effort, mismo criterio que antes: un remontaje/reintento
          // posterior lo recupera, no hace falta degradar todo a error.
        });
    });
  }, []);

  // Preview debounced (350ms): sin cambios de comportamiento respecto al
  // que tenia ActiveSetPanel, solo cambia de dueño.
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

  const handleApply = (): void => {
    setApplyState({ phase: "applying" });
    publishOperation({ type: "start", kind: "apply" });
    window.l4d2Api
      .applyActiveSet(entries)
      .then((result) => {
        publishOperation({ type: "result", kind: "apply", result });
        if (!isMounted.current) return;
        setApplyState({ phase: "done", result });
        // Aplicado con exito: el candidato actual pasa a ser el nuevo
        // baseline (ya no hay "cambios sin aplicar" contra si mismo).
        if (result.status === "success") setBaselineEntries(entries);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Error desconocido.";
        publishOperation({
          type: "result",
          kind: "apply",
          result: { status: "failure", error: message },
        });
        if (!isMounted.current) return;
        setApplyState({ phase: "error", message });
      });
  };

  const handleDiscard = (): void => {
    setApplyState({ phase: "idle" });
    window.l4d2Api
      .getActiveSet()
      .then((activeSet) => {
        if (!isMounted.current) return;
        const withPriority = withSequentialPriority(sortedByPriority(activeSet));
        setEntriesState(withPriority);
        setBaselineEntries(withPriority);
      })
      .catch((error: unknown) => {
        if (!isMounted.current) return;
        const message = error instanceof Error ? error.message : "Error desconocido.";
        setPreviewState({ phase: "error", message });
      });
  };

  return {
    loadState,
    entries,
    setEntries: setEntriesState,
    previewState,
    applyState,
    hasUnappliedChanges: !entriesEqualByOrder(entries, baselineEntries),
    handleApply,
    handleDiscard,
  };
}
