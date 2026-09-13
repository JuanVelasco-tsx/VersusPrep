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
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function collisionTag(summary: CollisionSummary | null): string | null {
  if (summary === null) return null;
  const parts: string[] = [];
  if (summary.wins > 0) {
    parts.push(`gana ${summary.wins} archivo${summary.wins === 1 ? "" : "s"}`);
  }
  if (summary.losses > 0) {
    parts.push(`pierde ${summary.losses} archivo${summary.losses === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Fila compacta del Priority_Order (mockup "2b - Compacto con flechas"):
 * miniatura / posicion / titulo / tag de colision / flechas subir-bajar,
 * deshabilitadas en los extremos. Puramente presentacional - `ActiveSetPanel`
 * es el unico dueno del estado y de las llamadas a la API; esta fila solo
 * dispara los callbacks que le pasan.
 *
 * Miniatura de portada (P-35): reutiliza `AddonCover`, el mismo componente de
 * Biblioteca (`AddonRow`), en su variante compacta (`size="sm"`). A diferencia
 * de `AddonList` (que trae `ScannedAddon` completo del escaneo, con
 * `coverPath`), `ActiveSetPanel` solo carga `getActiveSet()` + `getTitles()` -
 * NO sabe de antemano si el addon tiene portada en disco. Por eso pasa
 * `hasCover` fijo en `true`: el `<img>` siempre se intenta, y si el archivo no
 * existe (`l4d2cover://` devuelve 404) el `onError` de `AddonCover` cae al
 * MISMO fallback de iniciales que usaria un `hasCover={false}` conocido -
 * comportamiento visual identico, sin necesitar traer el escaneo completo acá.
 */
export function PriorityRow({
  addonId,
  title,
  index,
  total,
  collisionSummary,
  unavailable,
  onMoveUp,
  onMoveDown,
}: PriorityRowProps) {
  const tag = collisionTag(collisionSummary);

  return (
    <li className={styles.row}>
      <AddonCover addonId={addonId} hasCover title={title} size="sm" />
      <span className={styles.position}>{index + 1}</span>
      <span className={styles.title}>{title}</span>
      {unavailable && <span className={styles.tagUnavailable}>no disponible</span>}
      {!unavailable && tag !== null && <span className={styles.tag}>{tag}</span>}
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
    </li>
  );
}
