import { useEffect, useRef, useState } from "react";

import { buildCollisionSummaries, swap, withSequentialPriority } from "../state/activeSetEntries.js";
import type { ActiveSetState } from "../state/useActiveSetState.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { PriorityRow } from "./PriorityRow.js";
import styles from "./ActiveSetPanel.module.css";

/** Duración del highlight efímero de la fila recién movida (README `2b`: "~1.2s"). */
const JUST_MOVED_MS = 1200;

/**
 * Panel "Activos" (Seccion 21.2 UI): muestra el Active_Set instalado con
 * reordenamiento de Priority_Order por flechas compactas, tarjetas
 * separadas (README `2b`, Paso 4/8 — antes filas de tabla). Integracion
 * DESACOPLADA de `AddonList`/`AddonRow` (decision cerrada, opcion B - ver
 * Context/05-plan-seccion-21-restante.md) para TODO lo propio de esta
 * pantalla (reordenamiento, PriorityRow) — sigue sin compartir esa parte
 * con Biblioteca.
 *
 * REDISEÑO Paso 3/8 (decision de arquitectura confirmada con el usuario):
 * `entries`/`previewState`/`applyState`/`titles` YA NO son dueños de este
 * componente — se reciben como prop (`activeSetState`, de
 * `useActiveSetState`, montado UNA vez en `App.tsx`, compartido con el
 * panel derecho "Resumen de fusión" para que sea persistente entre
 * Biblioteca y Activos).
 *
 * REDISEÑO Paso 4/8: agrega la cabecera "Orden de prioridad" + el highlight
 * efímero de la fila recién movida (`lastMoved`, UI-only — README "State
 * Management": vive ACÁ, no en `useActiveSetState`, porque es exclusivo de
 * esta pantalla, igual que `moveUp`/`moveDown`/`PriorityRow` siempre lo
 * fueron) + la acción "Sacar" de la fila no disponible.
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

  // Highlight efímero (~1.2s) de la fila recién movida (README 2b). Guarda
  // TANTO el addonId como la dirección (para el texto "recién subido/bajado
  // un puesto") - se limpia solo por timeout, o de inmediato si esa misma
  // fila se saca via "Sacar" (ver handleRemove).
  const [lastMoved, setLastMoved] = useState<{ addonId: string; direction: "up" | "down" } | null>(
    null,
  );
  const lastMovedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (lastMovedTimer.current !== null) clearTimeout(lastMovedTimer.current);
    };
  }, []);

  const flashMoved = (addonId: string, direction: "up" | "down"): void => {
    setLastMoved({ addonId, direction });
    if (lastMovedTimer.current !== null) clearTimeout(lastMovedTimer.current);
    lastMovedTimer.current = setTimeout(() => setLastMoved(null), JUST_MOVED_MS);
  };

  // moveUp/moveDown: MISMA lógica de siempre (withSequentialPriority(swap(...)),
  // sin tocar) — lo único nuevo es disparar el highlight efímero de arriba.
  const moveUp = (index: number): void => {
    if (index === 0) return;
    const moved = entries[index];
    setEntries(withSequentialPriority(swap(entries, index - 1, index)));
    if (moved !== undefined) flashMoved(moved.addonId, "up");
  };

  const moveDown = (index: number): void => {
    if (index === entries.length - 1) return;
    const moved = entries[index];
    setEntries(withSequentialPriority(swap(entries, index, index + 1)));
    if (moved !== undefined) flashMoved(moved.addonId, "down");
  };

  /**
   * "Sacar" (README `2b`, columna 5 de la fila no disponible): quita el
   * addon del candidato EN MEMORIA, mismo criterio que `moveUp`/`moveDown` —
   * no llama IPC directo, recién se persiste con "Aplicar" (coherente con
   * que esta pantalla entera edita un candidato local hasta que se aplica).
   */
  const handleRemove = (addonId: string): void => {
    setEntries(withSequentialPriority(entries.filter((entry) => entry.addonId !== addonId)));
    // Si la fila sacada era la que tenía el highlight efímero, lo limpia de
    // una: no tiene sentido resaltar una fila que ya no está.
    setLastMoved((prev) => (prev?.addonId === addonId ? null : prev));
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
      <header className={styles.header}>
        <h1 className={styles.title}>Orden de prioridad</h1>
        <p className={styles.subtitle}>
          Cuando dos addons traen el mismo archivo, gana el que está <strong>más abajo</strong> en
          esta lista. Usá las flechas para subir o bajar un puesto.
        </p>
      </header>
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
            justMoved={lastMoved?.addonId === entry.addonId ? lastMoved.direction : null}
            onMoveUp={() => moveUp(index)}
            onMoveDown={() => moveDown(index)}
            onRemove={() => handleRemove(entry.addonId)}
          />
        ))}
      </ul>
    </div>
  );
}
