import { AddonCover } from "./AddonCover.js";
import styles from "./PriorityRow.module.css";

/** Cuantos archivos gana/pierde este addon en las colisiones del preview actual. */
export interface CollisionSummary {
  wins: number;
  losses: number;
}

interface PriorityRowProps {
  addonId: string;
  title: string;
  index: number;
  total: number;
  collisionSummary: CollisionSummary | null;
  unavailable: boolean;
  /**
   * `"up"`/`"down"` si esta fila se acaba de mover con esa flecha (feedback
   * efímero ~1.2s, ver `ActiveSetPanel.tsx`); `null` en cualquier otro caso.
   * Determina el highlight blurple + la meta "recién subido/bajado un
   * puesto" (README `2b`).
   */
  justMoved: "up" | "down" | null;
  onMoveUp: () => void;
  onMoveDown: () => void;
  /**
   * Quita esta fila del candidato EN MEMORIA (README `2b`: acción "Sacar"
   * para la fila no disponible, en vez de flechas). NO llama IPC directo —
   * mismo criterio que `moveUp`/`moveDown`, edita `entries` en memoria;
   * recién se persiste con "Aplicar".
   */
  onRemove: () => void;
}

/**
 * Elige la etiqueta de colisión de ESTA fila (README `2b`, columna 4): "Gana
 * N archivos" si `wins > 0` (se prioriza mostrar la victoria cuando el addon
 * tuviera ambas — caso raro no cubierto explícitamente por el README, ya que
 * el ganador de cada archivo depende solo del Priority_Order relativo entre
 * los MISMOS contribuyentes, así que un addon casi siempre gana o pierde
 * TODAS sus colisiones contra el mismo rival, rara vez ambas), si no "Pierde
 * N archivos" si `losses > 0`, si no `null` (sin colisiones → "Sin
 * conflictos", resuelto por el llamador).
 */
function collisionLabel(summary: CollisionSummary | null): string | null {
  if (summary === null) return null;
  if (summary.wins > 0) return `Gana ${summary.wins} archivo${summary.wins === 1 ? "" : "s"}`;
  if (summary.losses > 0) return `Pierde ${summary.losses} archivo${summary.losses === 1 ? "" : "s"}`;
  return null;
}

/**
 * Fila compacta del Priority_Order — tarjeta separada (README `2b`, Paso
 * 4/8; antes fila de tabla). Puramente presentacional - `ActiveSetPanel` es
 * el único dueño del estado y de las llamadas a la API; esta fila solo
 * dispara los callbacks que le pasan.
 *
 * SIN ARRASTRE (remarcado a propósito en el README): no hay drag handle, no
 * hay `draggable`, no hay copy que mencione arrastrar — se mantiene
 * EXACTAMENTE la interacción de siempre (flechas ↑/↓). Es una regresión
 * fácil de reintroducir sin querer si se copia el patrón de otra lista, así
 * que quede claro: NO agregar drag & drop acá.
 *
 * SIN columna de "autor" (el README pide título + autor en la columna 3):
 * `ActiveSetPanel`/`useActiveSetState` solo tienen `getTitles()` (snapshot
 * addonId→título, BUG-001) — ningún autor. Agregar esa columna necesitaría
 * un canal IPC nuevo, y el README es explícito en "State Management":
 * "Ningún estado ni canal IPC nuevo". Se omite la línea de autor en vez de
 * inventar el dato (por eso la meta "recién subido/bajado un puesto" del
 * README, que en el mock aparece como "vexlar · recién subido un puesto",
 * queda acá SOLA, sin el nombre de autor que la precede en el mock).
 *
 * Portada 40×40 (P-35/README "Medidas fijas del layout": "portada de
 * prioridad 40px", igual que la de Biblioteca) — usa el tamaño DEFAULT de
 * `AddonCover` (ya no `size="sm"`/32px: la fila dejó de ser "una sola línea
 * de tabla" y pasó a tarjeta con su propio padding, hay lugar de sobra).
 * `hasCover` fijo en `true`: `ActiveSetPanel` solo carga `getActiveSet()` +
 * `getTitles()`, NO sabe de antemano si el addon tiene portada en disco. El
 * `<img>` siempre se intenta, y si el archivo no existe (`l4d2cover://`
 * devuelve 404) el `onError` de `AddonCover` cae al MISMO fallback de
 * iniciales que usaría un `hasCover={false}` conocido — comportamiento
 * visual idéntico, sin necesitar traer el escaneo completo acá.
 */
export function PriorityRow({
  addonId,
  title,
  index,
  total,
  collisionSummary,
  unavailable,
  justMoved,
  onMoveUp,
  onMoveDown,
  onRemove,
}: PriorityRowProps) {
  const label = collisionLabel(collisionSummary);

  return (
    <li className={justMoved !== null ? `${styles.row} ${styles.rowMoved}` : styles.row}>
      <span className={justMoved !== null ? styles.positionMoved : styles.position}>
        {index + 1}
      </span>
      <AddonCover addonId={addonId} hasCover title={title} />
      <div className={styles.info}>
        <span className={styles.title}>{title}</span>
        {justMoved !== null && (
          <span className={styles.movedMeta}>
            recién {justMoved === "up" ? "subido" : "bajado"} un puesto
          </span>
        )}
      </div>
      <div className={styles.tagArea}>
        {unavailable && <span className={styles.tagUnavailable}>✕ No disponible</span>}
        {!unavailable && label !== null && <span className={styles.tag}>{label}</span>}
        {!unavailable && label === null && (
          <span className={styles.tagNeutral}>Sin conflictos</span>
        )}
      </div>
      {unavailable ? (
        <button type="button" className={styles.removeButton} onClick={onRemove}>
          Sacar
        </button>
      ) : (
        <div className={styles.arrows}>
          <button
            type="button"
            className={styles.arrowButton}
            disabled={index === 0}
            onClick={onMoveUp}
            aria-label="Subir prioridad"
          >
            {"↑"}
          </button>
          <button
            type="button"
            className={styles.arrowButton}
            disabled={index === total - 1}
            onClick={onMoveDown}
            aria-label="Bajar prioridad"
          >
            {"↓"}
          </button>
        </div>
      )}
    </li>
  );
}
