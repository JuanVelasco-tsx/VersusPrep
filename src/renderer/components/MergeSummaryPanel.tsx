import type { ReactNode } from "react";

import type { FileCollision } from "../../main/domain/index.js";
import type { ApplyState, PreviewState } from "../state/useActiveSetState.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import styles from "./MergeSummaryPanel.module.css";

interface MergeSummaryPanelProps {
  entryCount: number;
  previewState: PreviewState;
  applyState: ApplyState;
  /** `true` si `entries` difiere del último baseline aplicado/descartado (ver `useActiveSetState`). */
  hasUnappliedChanges: boolean;
  /**
   * Snapshot en memoria addonId->titulo (mismo `getTitles()` que ya carga
   * `useActiveSetState`, ver P-24/BUG-001). Se usa SOLO para mostrar nombres
   * legibles en vez de Workshop IDs crudos (P-34); un id ausente cae al id
   * crudo, mismo criterio de fallback que el resto de la app.
   */
  titles: Record<string, string>;
  onApply: () => void;
  onDiscard: () => void;
  /**
   * Navega a "Activos" desde el hallazgo de colisiones (README `2a`: "Podés
   * cambiar el orden en Activos"). Opcional: sin esto, el texto se muestra
   * sin link (p. ej. si algún consumidor futuro no tiene noción de vistas).
   */
  onGoToActive?: () => void;
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

interface Finding {
  id: string;
  /** `string | undefined` (no `string`): así resuelve TS el acceso a un CSS Module bajo `noUncheckedIndexedAccess` — `className` de React ya acepta ese tipo. */
  dotClassName: string | undefined;
  title: string;
  body: ReactNode;
}

/**
 * Panel derecho "Estado del preset" (README `2a`, rediseño Paso 3/8) —
 * reemplaza al viejo "Resumen de fusión" de 280px que solo vivía dentro de
 * la pestaña Activos (P-34). Ahora es persistente: `App.tsx` lo monta en el
 * slot de panel derecho del shell para Biblioteca Y Activos, alimentado por
 * el MISMO `useActiveSetState` (ver ese hook). Sigue siendo puramente
 * presentacional — el dueño del estado y de las llamadas a
 * `previewActiveSet`/`applyActiveSet` es el hook, no este componente.
 *
 * Los "hallazgos" (colisiones / no disponible / cambios sin aplicar) son un
 * concepto NUEVO del rediseño: antes las colisiones se mostraban siempre
 * (aunque fuera "Sin colisiones") y no existía ningún indicador de "cambios
 * sin aplicar". Ahora la lista solo muestra los casos que APLICAN — ninguno
 * de los tres es garantía de que pase algo, así que la ausencia total de
 * hallazgos (lista vacía) es un estado válido y silencioso.
 */
export function MergeSummaryPanel({
  entryCount,
  previewState,
  applyState,
  hasUnappliedChanges,
  titles,
  onApply,
  onDiscard,
  onGoToActive,
}: MergeSummaryPanelProps) {
  const isApplying = applyState.phase === "applying";
  const preview = previewState.phase === "ready" ? previewState.preview : null;
  const hasUnavailable =
    preview !== null && preview.kind === "ready" && preview.unavailable.length > 0;

  const findings: Finding[] = [];

  if (preview !== null && preview.kind === "ready") {
    const { collisions } = preview.report;
    const { unavailable } = preview;

    if (collisions.length > 0) {
      const collidingCount = collidingAddonIds(collisions).size;
      findings.push({
        id: "collisions",
        dotClassName: styles.dotCollide,
        title: `${collidingCount} addon${collidingCount === 1 ? "" : "s"} comparten archivos`,
        body: (
          <>
            Gana el de mayor prioridad en cada archivo.{" "}
            {onGoToActive ? (
              <button type="button" className={styles.link} onClick={onGoToActive}>
                Podés cambiar el orden en Activos.
              </button>
            ) : (
              "Podés cambiar el orden en Activos."
            )}
            <details className={styles.details}>
              <summary className={styles.detailsSummary}>Ver detalle técnico</summary>
              <ul className={styles.detailsList}>
                {collisions.map((collision) => (
                  <li key={collision.relativePath} className={styles.detailsItem}>
                    {collision.relativePath} (gana {nameFor(titles, collision.winner)})
                  </li>
                ))}
              </ul>
            </details>
          </>
        ),
      });
    }

    if (unavailable.length > 0) {
      findings.push({
        id: "unavailable",
        dotClassName: styles.dotBlocked,
        title: `${unavailable.length} addon${unavailable.length === 1 ? "" : "s"} no disponible${unavailable.length === 1 ? "" : "s"}`,
        body: "Su VPK no se puede leer. Hay que sacarlo del preset o reinstalarlo antes de aplicar.",
      });
    }
  }

  if (hasUnappliedChanges) {
    findings.push({
      id: "unapplied",
      dotClassName: styles.dotAccent,
      title: "Cambios sin aplicar",
      body: "El preset activo tiene cambios que todavía no se instalaron.",
    });
  }

  return (
    <aside className={styles.summary}>
      <span className={styles.kicker}>Estado del preset</span>
      <div className={styles.metric}>
        <span className={styles.metricNumber}>{entryCount}</span>
        <span className={styles.metricLegend}>
          addon{entryCount === 1 ? "" : "s"} en la cadena de fusión
        </span>
      </div>
      <div className={styles.hairline} />

      {previewState.phase === "loading" && <LoadingIndicator message="Calculando preview..." />}
      {previewState.phase === "error" && (
        <p className={styles.error}>Error de preview: {previewState.message}</p>
      )}
      {preview !== null && preview.kind === "addon-missing" && (
        <p className={styles.error}>
          El addon {nameFor(titles, preview.addonId)} ya no esta en la Workshop_Folder.
        </p>
      )}

      {findings.length > 0 && (
        <ul className={styles.findings}>
          {findings.map((finding) => (
            <li key={finding.id} className={styles.finding}>
              <span className={finding.dotClassName} aria-hidden="true" />
              <div className={styles.findingText}>
                <span className={styles.findingTitle}>{finding.title}</span>
                <span className={styles.findingBody}>{finding.body}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.footer}>
        <p className={styles.explainer}>
          Al aplicar se fusionan los VPK en <code className={styles.code}>pak01_dir.vpk</code> y se
          instala en <code className={styles.code}>modsvs\</code>. Windows puede pedirte permisos.
        </p>
        <button
          type="button"
          className={styles.applyButton}
          disabled={entryCount === 0 || isApplying || hasUnavailable}
          onClick={onApply}
        >
          {isApplying ? "Aplicando..." : "Aplicar cambios"}
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
