import type { FileCollision } from "../../main/domain/index.js";
import type { ApplyState, PreviewState } from "./ActiveSetPanel.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import styles from "./MergeSummaryPanel.module.css";

interface MergeSummaryPanelProps {
  entryCount: number;
  previewState: PreviewState;
  applyState: ApplyState;
  /**
   * Snapshot en memoria addonId->titulo (mismo `getTitles()` que ya carga
   * `ActiveSetPanel`, ver P-24/BUG-001). Se usa SOLO para mostrar nombres
   * legibles en vez de Workshop IDs crudos (P-34); un id ausente cae al id
   * crudo, mismo criterio de fallback que el resto de la app.
   */
  titles: Record<string, string>;
  onApply: () => void;
  onDiscard: () => void;
}

/** Titulo legible de un addonId via el snapshot de `getTitles()`, o el id crudo si no esta cacheado. */
function nameFor(titles: Record<string, string>, addonId: string): string {
  return titles[addonId] ?? addonId;
}

/** addonIds distintos que participan en al menos una colision (ganadores y perdedores). */
function collidingAddonIds(collisions: readonly FileCollision[]): Set<string> {
  const ids = new Set<string>();
  for (const collision of collisions) {
    for (const contributor of collision.contributors) {
      ids.add(contributor);
    }
  }
  return ids;
}

/**
 * Seccion de colisiones (P-34): "Sin colisiones" si no hubo ninguna; si hubo,
 * un resumen agregado en lenguaje llano (cuantos addons distintos comparten
 * archivos) mas el detalle archivo-por-archivo COLAPSADO por defecto detras
 * de un `<details>` nativo, con el ganador identificado por NOMBRE.
 */
function CollisionsSection({
  collisions,
  titles,
}: {
  collisions: readonly FileCollision[];
  titles: Record<string, string>;
}) {
  if (collisions.length === 0) {
    return <p className={styles.line}>Sin colisiones.</p>;
  }
  const collidingCount = collidingAddonIds(collisions).size;
  return (
    <>
      <p className={styles.line}>
        {collidingCount} de tus addons comparten archivos — se aplicó el que tiene más prioridad
        en cada caso.
      </p>
      <details className={styles.details}>
        <summary className={styles.detailsSummary}>Ver detalle técnico</summary>
        <ul className={styles.list}>
          {collisions.map((collision) => (
            <li key={collision.relativePath} className={styles.listItem}>
              {collision.relativePath} (gana {nameFor(titles, collision.winner)})
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

/**
 * Aside "Resumen de fusion" (mockup 1b, simplificado en P-34): cuantos addons
 * activos hay, un resumen en lenguaje llano de las colisiones (identificando
 * addons por NOMBRE, nunca por Workshop ID crudo) y addons no disponibles del
 * preview actual, mas los botones Aplicar/Descartar. Puramente presentacional
 * - `ActiveSetPanel` es el dueno del estado y de las llamadas a
 * `previewActiveSet`/`applyActiveSet`.
 *
 * P-34 (captura real de QA): el resumen tecnico anterior ("N addon(s) en la
 * cadena" / "N archivo(s) a empaquetar" + lista completa scrolleable de cada
 * archivo en colision por Workshop ID) era ruido tecnico incluso para
 * usuarios avanzados. Ahora el conteo simple ("Tenés N addons activos") es lo
 * unico que se muestra siempre; el detalle archivo-por-archivo (por NOMBRE, no
 * por ID) queda colapsado detras de un `<details>` nativo ("Ver detalle
 * técnico"), cerrado por defecto.
 */
export function MergeSummaryPanel({
  entryCount,
  previewState,
  applyState,
  titles,
  onApply,
  onDiscard,
}: MergeSummaryPanelProps) {
  const isApplying = applyState.phase === "applying";

  return (
    <aside className={styles.summary}>
      <h2 className={styles.heading}>Resumen de fusion</h2>
      <p className={styles.line}>
        Tenés {entryCount} addon{entryCount === 1 ? "" : "s"} activo{entryCount === 1 ? "" : "s"}.
      </p>

      {previewState.phase === "loading" && <LoadingIndicator message="Calculando preview..." />}
      {previewState.phase === "error" && (
        <p className={styles.error}>Error de preview: {previewState.message}</p>
      )}

      {previewState.phase === "ready" && previewState.preview.kind === "addon-missing" && (
        <p className={styles.error}>
          El addon {nameFor(titles, previewState.preview.addonId)} ya no esta en la Workshop_Folder.
        </p>
      )}

      {previewState.phase === "ready" && previewState.preview.kind === "ready" && (
        <>
          <CollisionsSection
            collisions={previewState.preview.report.collisions}
            titles={titles}
          />

          {previewState.preview.unavailable.length > 0 && (
            <>
              <p className={styles.line}>No disponibles:</p>
              <ul className={styles.list}>
                {previewState.preview.unavailable.map((entry) => (
                  <li key={entry.addonId} className={styles.listItem}>
                    {nameFor(titles, entry.addonId)}: {entry.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.applyButton}
          disabled={entryCount === 0 || isApplying}
          onClick={onApply}
        >
          {isApplying ? "Aplicando..." : "Aplicar"}
        </button>
        <button
          type="button"
          className={styles.discardButton}
          disabled={isApplying}
          onClick={onDiscard}
        >
          Descartar
        </button>
      </div>
    </aside>
  );
}
