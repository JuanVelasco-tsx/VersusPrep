import { buildCollisionSummaries, swap, withSequentialPriority } from "../state/activeSetEntries.js";
import type { ActiveSetState } from "../state/useActiveSetState.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { PriorityRow } from "./PriorityRow.js";
import styles from "./ActiveSetPanel.module.css";

/**
 * Panel "Activos" (Seccion 21.2 UI): muestra el Active_Set instalado con
 * reordenamiento de Priority_Order por flechas compactas (mockup "2b").
 * Integracion DESACOPLADA de `AddonList`/`AddonRow` (decision cerrada,
 * opcion B - ver Context/05-plan-seccion-21-restante.md) para TODO lo propio
 * de esta pantalla (reordenamiento, PriorityRow) — sigue sin compartir esa
 * parte con Biblioteca.
 *
 * REDISEÑO Paso 3/8 (decision de arquitectura confirmada con el usuario):
 * `entries`/`previewState`/`applyState`/`titles` YA NO son dueños de este
 * componente — se recibe `activeSetState` (de `useActiveSetState`, montado
 * UNA vez en `App.tsx`, compartido con el panel derecho "Estado del preset"
 * para que sea persistente entre Biblioteca y Activos, ver ese hook para el
 * porque). Este panel sigue siendo dueño SOLO de `moveUp`/`moveDown`/
 * `PriorityRow` — sin cambios de logica ni de estilo en este paso (eso es
 * Paso 4). `MergeSummaryPanel` ya NO se renderiza aca: vive en el panel
 * derecho del shell (`App.tsx`), compartido con Biblioteca.
 */
interface ActiveSetPanelProps {
  /**
   * `true` si esta instancia arranco por un relanzo elevado con una sesion
   * pendiente (BUG-004 parte 2, ver el mismo prop en `AddonList`). Cambia el
   * mensaje de carga inicial a uno de continuidad ("Restaurando tu
   * selección...") en vez del texto tecnico habitual.
   */
  resuming: boolean;
  /** Estado compartido del Active_Set candidato (ver `useActiveSetState`). */
  activeSetState: ActiveSetState;
}

export function ActiveSetPanel({ resuming, activeSetState }: ActiveSetPanelProps) {
  const { loadState, entries, setEntries, previewState } = activeSetState;

  const moveUp = (index: number): void => {
    if (index === 0) return;
    setEntries(withSequentialPriority(swap(entries, index - 1, index)));
  };

  const moveDown = (index: number): void => {
    if (index === entries.length - 1) return;
    setEntries(withSequentialPriority(swap(entries, index, index + 1)));
  };

  if (loadState.phase === "loading") {
    return (
      <LoadingIndicator
        message={resuming ? "Restaurando tu selección..." : "Cargando Active_Set..."}
      />
    );
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
            addonId={entry.addonId}
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
    </div>
  );
}
