import type { SettablePathField } from "../../main/app/ipc-contract.js";
import type { PathDetectionFailureReason, RequiredPathKey } from "../../main/domain/index.js";
import { computeFirstLaunchChecklist } from "../state/firstLaunchChecklist.js";
import { useOnboardingState } from "../state/useOnboardingState.js";
import { MISSING_FIELD_ACTION, MISSING_FIELD_BODY, MISSING_FIELD_LABEL } from "../state/requiredPathCopy.js";
import { CONDENSED_NOTICES } from "./TrustNotices.js";
import { REASON_MESSAGES } from "./AddonList.js";
import styles from "./FirstLaunchScreen.module.css";

/**
 * Pantalla de "Primer arranque" (README `2e`, rediseño Paso 8/8) — reemplaza
 * el `LoadingIndicator` genérico + los avisos fijos de la franja superior
 * que mostraba la app hasta este paso. Se monta en `App.tsx` en lugar del
 * shell de tres columnas (sin riel, "lo único que importa es la detección")
 * mientras `!onboardingSeen`; una vez que el flujo termina (detección+
 * escaneo exitosos, o "Entrar de todos modos"), `onComplete` le devuelve el
 * control a `App.tsx`, que monta el shell normal — donde `AddonList` hace su
 * PROPIA detección de siempre (esta pantalla no le pasa nada, ver
 * `useOnboardingState.ts`).
 *
 * Dos estados (mismo componente, misma columna centrada de 560px):
 *  - "detecting": checklist con progreso real de escaneo (única
 *    instrumentación nueva de este paso, `ScanProgressEvent`) + caja de 3
 *    avisos condensados.
 *  - "needs-manual": copy específico por `PathDetectionFailureReason`. Solo
 *    `required-path-missing` tiene la caja roja de acción + "Entrar de
 *    todos modos" (los otros tres reasons implican que ni Steam ni la
 *    biblioteca se resolvieron — no hay nada que "entrar a ver" todavía, así
 *    que solo ofrecen reintentar, mismo copy que ya usa `AddonList.tsx`).
 */
export function FirstLaunchScreen({ onComplete }: { onComplete: () => void }) {
  const { screen, showNotices, onAcknowledgeNotices, onRetryDetection, onPickManualPath, onEnterAnyway } =
    useOnboardingState(onComplete);

  return (
    <div className={styles.screen}>
      <div className={styles.column}>
        <div className={styles.brand}>
          <span className={styles.brandDot} aria-hidden="true" />
          <span className={styles.brandText}>
            <span className={styles.brandName}>Versus Addon Manager</span>
            <span className={styles.brandSub}>Primer arranque</span>
          </span>
        </div>

        {screen.phase === "detecting" && (
          <DetectingView
            pathsResolved={screen.pathsResolved}
            scanDone={screen.scanDone}
            scanTotal={screen.scanTotal}
            showNotices={showNotices}
            onAcknowledgeNotices={onAcknowledgeNotices}
          />
        )}

        {screen.phase === "needs-manual" && (
          <NeedsManualView
            reason={screen.reason}
            missingField={screen.missingField}
            steamAndGameRootResolved={screen.steamAndGameRootResolved}
            busyField={screen.busyField}
            notice={screen.notice}
            onRetryDetection={onRetryDetection}
            onPickManualPath={onPickManualPath}
            onEnterAnyway={onEnterAnyway}
          />
        )}
      </div>
    </div>
  );
}

function DetectingView({
  pathsResolved,
  scanDone,
  scanTotal,
  showNotices,
  onAcknowledgeNotices,
}: {
  pathsResolved: boolean;
  scanDone: number | null;
  scanTotal: number | null;
  showNotices: boolean;
  onAcknowledgeNotices: (checked: boolean) => void;
}) {
  const rows = computeFirstLaunchChecklist(pathsResolved, scanDone, scanTotal);
  const doneCount = rows.filter((row) => row.state === "done").length;

  return (
    <>
      <h1 className={styles.title}>
        Buscando tu instalación
        <br />
        de Left 4 Dead 2
      </h1>
      <div className={styles.hairline} />

      <ul className={styles.checklist}>
        {rows.map((row) => (
          <li key={row.id} className={styles.checklistItem}>
            <span
              className={
                row.state === "done"
                  ? styles.rowIconDone
                  : row.state === "current"
                    ? styles.rowIconCurrent
                    : styles.rowIconPending
              }
            >
              {row.state === "done" ? "✓" : row.state === "current" ? "⟳" : "·"}
            </span>
            <span className={row.state === "current" ? styles.rowLabelCurrent : styles.rowLabel}>{row.label}</span>
            {row.detail !== null && <span className={styles.rowDetail}>{row.detail}</span>}
          </li>
        ))}
      </ul>

      <div className={styles.progressTrack}>
        <div className={styles.progressFill} style={{ width: `${(doneCount / rows.length) * 100}%` }} />
      </div>

      <p className={styles.note}>
        La primera vez puede tardar unos segundos: hay que abrir cada VPK para saber su nombre y si
        usa VScript.
      </p>

      {showNotices && <CondensedNoticesBox onAcknowledge={onAcknowledgeNotices} />}
    </>
  );
}

function CondensedNoticesBox({ onAcknowledge }: { onAcknowledge: (checked: boolean) => void }) {
  return (
    <div className={styles.noticesBox}>
      <p className={styles.noticesKicker}>Antes de empezar, tres cosas</p>
      <ul className={styles.noticesList}>
        {CONDENSED_NOTICES.map((notice) => (
          <li key={notice.id} className={styles.noticeItem}>
            <span className={notice.tone === "warning" ? styles.noticeMarkWarning : styles.noticeMarkInfo}>
              {notice.tone === "warning" ? "▲" : "●"}
            </span>
            <span className={styles.noticeText}>
              <span className={styles.noticeTitle}>{notice.title}</span>{" "}
              <span className={styles.noticeBody}>{notice.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <label className={styles.noticesCheckbox}>
        <input type="checkbox" onChange={(event) => onAcknowledge(event.target.checked)} />
        Entendido, no mostrar de nuevo al arrancar
      </label>
    </div>
  );
}

const NEEDS_MANUAL_TITLES: Record<PathDetectionFailureReason, [string, string]> = {
  "steam-not-installed": ["No encontramos tu instalación", "de Steam"],
  "library-folders-unreadable": ["No pudimos leer tu biblioteca", "de Steam"],
  "l4d2-not-in-libraries": ["No encontramos Left 4 Dead 2", "en tu biblioteca de Steam"],
  "required-path-missing": ["Falta una cosa para poder", "fusionar tus addons"],
};

function NeedsManualView({
  reason,
  missingField,
  steamAndGameRootResolved,
  busyField,
  notice,
  onRetryDetection,
  onPickManualPath,
  onEnterAnyway,
}: {
  reason: PathDetectionFailureReason;
  missingField: RequiredPathKey | null;
  steamAndGameRootResolved: boolean;
  busyField: SettablePathField | null;
  notice: string | null;
  onRetryDetection: () => void;
  onPickManualPath: (field: SettablePathField) => void;
  onEnterAnyway: () => void;
}) {
  const [line1, line2] = NEEDS_MANUAL_TITLES[reason];

  return (
    <>
      <h1 className={styles.title}>
        {line1}
        <br />
        {line2}
      </h1>
      <div className={styles.hairline} />

      {notice !== null && <p className={styles.errorNotice}>{notice}</p>}

      {reason === "required-path-missing" && steamAndGameRootResolved && (
        <ul className={styles.checklist}>
          <li className={styles.checklistItem}>
            <span className={styles.rowIconDone}>✓</span>
            <span className={styles.rowLabel}>Steam y la carpeta del juego</span>
            <span className={styles.rowDetail}>detectados</span>
          </li>
        </ul>
      )}

      {reason === "required-path-missing" && missingField !== null ? (
        <div className={styles.redBox}>
          <p className={styles.redBoxTitle}>✕ No encontramos {MISSING_FIELD_LABEL[missingField]}</p>
          <p className={styles.redBoxBody}>{MISSING_FIELD_BODY[missingField]}</p>
          <div className={styles.redBoxActions}>
            <button
              type="button"
              className={styles.redBoxButton}
              disabled={busyField !== null}
              onClick={() => onPickManualPath(missingField)}
            >
              {busyField === missingField ? "Eligiendo..." : MISSING_FIELD_ACTION[missingField]}
            </button>
            <button type="button" className={styles.ghostButton} onClick={onRetryDetection}>
              Volver a detectar
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className={styles.closingNote}>{REASON_MESSAGES[reason]}</p>
          <button type="button" className={styles.ghostButton} onClick={onRetryDetection}>
            Reintentar detección
          </button>
        </>
      )}

      {reason === "required-path-missing" && (
        <>
          <p className={styles.closingNote}>
            Podés entrar igual, pero hasta que exista esa ruta no vas a poder ver tu biblioteca ni
            aplicar cambios.
          </p>
          <button type="button" className={styles.enterAnywayButton} onClick={onEnterAnyway}>
            Entrar de todos modos
          </button>
        </>
      )}
    </>
  );
}
