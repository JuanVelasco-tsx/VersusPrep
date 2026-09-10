import type { ApplyState, PreviewState } from "./ActiveSetPanel.js";
import styles from "./MergeSummaryPanel.module.css";

interface MergeSummaryPanelProps {
  entryCount: number;
  previewState: PreviewState;
  applyState: ApplyState;
  onApply: () => void;
  onDiscard: () => void;
}

/** Traduce el resultado de "Aplicar" a un mensaje corto (texto simple, sin progreso paso a paso - eso es 21.4). */
function applyResultMessage(applyState: ApplyState): { text: string; isError: boolean } | null {
  if (applyState.phase === "error") {
    return { text: applyState.message, isError: true };
  }
  if (applyState.phase !== "done") return null;

  const result = applyState.result;
  if (result.status === "success") {
    return { text: "Aplicado correctamente.", isError: false };
  }
  if (result.status === "elevating") {
    return {
      text: "Se solicito elevacion de permisos; la operacion continua en una instancia elevada.",
      isError: false,
    };
  }
  return { text: result.error, isError: true };
}

/**
 * Aside "Resumen de fusion" (mockup 1b): addons en la cadena, archivos a
 * empaquetar, colisiones y addons no disponibles del preview actual, mas los
 * botones Aplicar/Descartar. Puramente presentacional - `ActiveSetPanel` es
 * el dueno del estado y de las llamadas a `previewActiveSet`/`applyActiveSet`.
 */
export function MergeSummaryPanel({
  entryCount,
  previewState,
  applyState,
  onApply,
  onDiscard,
}: MergeSummaryPanelProps) {
  const isApplying = applyState.phase === "applying";
  const resultMessage = applyResultMessage(applyState);

  return (
    <aside className={styles.summary}>
      <h2 className={styles.heading}>Resumen de fusion</h2>
      <p className={styles.line}>{entryCount} addon(s) en la cadena.</p>

      {previewState.phase === "loading" && (
        <p className={styles.message}>Calculando preview...</p>
      )}
      {previewState.phase === "error" && (
        <p className={styles.error}>Error de preview: {previewState.message}</p>
      )}

      {previewState.phase === "ready" && previewState.preview.kind === "addon-missing" && (
        <p className={styles.error}>
          El addon {previewState.preview.addonId} ya no esta en la Workshop_Folder.
        </p>
      )}

      {previewState.phase === "ready" && previewState.preview.kind === "ready" && (
        <>
          <p className={styles.line}>{previewState.preview.fileCount} archivo(s) a empaquetar.</p>

          {previewState.preview.report.collisions.length === 0 && (
            <p className={styles.line}>Sin colisiones.</p>
          )}
          {previewState.preview.report.collisions.length > 0 && (
            <ul className={styles.list}>
              {previewState.preview.report.collisions.map((collision) => (
                <li key={collision.relativePath} className={styles.listItem}>
                  {collision.relativePath} (gana {collision.winner})
                </li>
              ))}
            </ul>
          )}

          {previewState.preview.unavailable.length > 0 && (
            <>
              <p className={styles.line}>No disponibles:</p>
              <ul className={styles.list}>
                {previewState.preview.unavailable.map((entry) => (
                  <li key={entry.addonId} className={styles.listItem}>
                    {entry.addonId}: {entry.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {resultMessage !== null && (
        <p className={resultMessage.isError ? styles.error : styles.success}>
          {resultMessage.text}
        </p>
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
