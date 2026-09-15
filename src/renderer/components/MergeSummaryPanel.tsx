import type { ReactNode } from "react";

import type { FileCollision } from "../../main/domain/index.js";
import { isApplyButtonDisabled } from "../state/activeSetEntries.js";
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
  /**
   * `true` en Activos (README `2b`, Paso 4/8): kicker "Resumen de fusión" en
   * vez de "Estado del preset", leyenda de la cifra sin el sufijo "de
   * fusión" (ya está en el kicker), y las colisiones/no-disponibles se
   * muestran como CAJAS A ANCHO COMPLETO con copy extendido (ganador por
   * nombre, disclosure de archivos, aviso explícito de P-19) en vez de los
   * list-items compactos de Biblioteca (`2a`). El botón "Aplicar cambios"
   * queda `disabled` con `preview.unavailable.length > 0` en AMBOS modos
   * (cierra P-19, no es exclusivo de este modo) — eso ya estaba desde el
   * Paso 3, sin cambios acá.
   */
  detailed?: boolean;
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
 * Cuerpo de la caja cian de colisiones en modo `detailed` (README `2b`):
 * "Se aplica el de más prioridad en cada archivo: **{ganador}**." SOLO
 * cuando TODAS las colisiones tienen el MISMO `winner` (caso típico: un
 * addon casi siempre gana o pierde TODAS sus colisiones contra el mismo
 * rival, ver `PriorityRow.tsx#collisionLabel`) — nombrar un ganador
 * específico cuando en realidad hay varios distintos sería una afirmación
 * falsa, así que ese caso cae al copy genérico sin nombre (igual al de
 * Biblioteca).
 */
function collisionBoxBody(
  collisions: readonly FileCollision[],
  titles: Record<string, string>,
  onGoToActive: (() => void) | undefined,
): ReactNode {
  const winners = new Set(collisions.map((collision) => collision.winner));
  if (winners.size === 1) {
    const [winnerId] = winners;
    return (
      <>
        Se aplica el de más prioridad en cada archivo: <strong>{nameFor(titles, winnerId!)}</strong>.
      </>
    );
  }
  return onGoToActive ? (
    <>
      Gana el de mayor prioridad en cada archivo.{" "}
      <button type="button" className={styles.link} onClick={onGoToActive}>
        Podés cambiar el orden en Activos.
      </button>
    </>
  ) : (
    "Gana el de mayor prioridad en cada archivo."
  );
}

/** Copy pluralizado de la caja roja "No se puede aplicar todavía" (README `2b`, cierra P-19). */
function unavailableBoxBody(count: number): string {
  if (count === 1) {
    return (
      "1 addon del preset no se puede leer. La fusión falla completa si lo dejás: " +
      "sacalo de la lista o reinstalalo desde Steam."
    );
  }
  return (
    `${count} addons del preset no se pueden leer. La fusión falla completa si los dejás: ` +
    "sacalos de la lista o reinstalalos desde Steam."
  );
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
  detailed = false,
}: MergeSummaryPanelProps) {
  const isApplying = applyState.phase === "applying";
  const preview = previewState.phase === "ready" ? previewState.preview : null;
  const collisions = preview !== null && preview.kind === "ready" ? preview.report.collisions : [];
  const unavailable = preview !== null && preview.kind === "ready" ? preview.unavailable : [];
  const hasUnavailable = unavailable.length > 0;
  // Misma función que testea activeSetEntries.test.ts — ver ese archivo y
  // el docblock de `isApplyButtonDisabled` (cierra P-19).
  const applyDisabled = isApplyButtonDisabled({ entryCount, isApplying, preview });

  // Modo compacto (Biblioteca, README `2a`): lista de hallazgos con punto de
  // color + título + explicación. Sin uso en modo `detailed` (Activos usa
  // las cajas a ancho completo de más abajo en su lugar, ver README `2b`).
  const findings: Finding[] = [];
  if (!detailed) {
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

    if (hasUnappliedChanges) {
      findings.push({
        id: "unapplied",
        dotClassName: styles.dotAccent,
        title: "Cambios sin aplicar",
        body: "El preset activo tiene cambios que todavía no se instalaron.",
      });
    }
  }

  return (
    <aside className={styles.summary}>
      <span className={styles.kicker}>{detailed ? "Resumen de fusión" : "Estado del preset"}</span>
      <div className={styles.metric}>
        <span className={styles.metricNumber}>{entryCount}</span>
        <span className={styles.metricLegend}>
          addon{entryCount === 1 ? "" : "s"} en la cadena{detailed ? "" : " de fusión"}
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

      {!detailed && findings.length > 0 && (
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

      {detailed && collisions.length > 0 && (
        <div className={styles.boxCollide}>
          <p className={styles.boxTitle}>
            {collidingAddonIds(collisions).size} addon{collidingAddonIds(collisions).size === 1 ? "" : "s"} comparten{" "}
            {collisions.length} archivo{collisions.length === 1 ? "" : "s"}
          </p>
          <p className={styles.boxBody}>{collisionBoxBody(collisions, titles, onGoToActive)}</p>
          <details className={styles.boxDetails}>
            <summary className={styles.boxDisclosure}>
              Ver los {collisions.length} archivo{collisions.length === 1 ? "" : "s"} ▾
            </summary>
            <ul className={styles.detailsList}>
              {collisions.map((collision) => (
                <li key={collision.relativePath} className={styles.detailsItem}>
                  {collision.relativePath} (gana {nameFor(titles, collision.winner)})
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {detailed && hasUnavailable && (
        <div className={styles.boxUnavailable}>
          <p className={styles.boxTitleDanger}>No se puede aplicar todavía</p>
          <p className={styles.boxBodyDanger}>{unavailableBoxBody(unavailable.length)}</p>
        </div>
      )}

      <div className={styles.footer}>
        <p className={styles.explainer}>
          Al aplicar se fusionan los VPK en <code className={styles.code}>pak01_dir.vpk</code> y se
          instala en <code className={styles.code}>modsvs\</code>. Windows puede pedirte permisos.
        </p>
        <button
          type="button"
          className={styles.applyButton}
          disabled={applyDisabled}
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
