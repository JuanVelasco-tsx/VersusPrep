import type { GamePaths } from "../../main/domain/index.js";
import type { SettingsState } from "../state/useSettingsState.js";
import { computeDetectionStatus } from "../state/settingsDetectionStatus.js";
import styles from "./DetectionStatusPanel.module.css";

/**
 * "Estado de detección" (README `2d`, panel derecho de Configuración,
 * rediseño Paso 6/8). Vive dentro del slot de panel derecho del shell
 * (`App.module.css .rightPanel`) — este archivo solo define el contenido
 * interno, mismo criterio que `MergeSummaryPanel.tsx`.
 *
 * Recibe el `SettingsState` COMPARTIDO con `SettingsPanel` (levantado en
 * `App.tsx` vía `useSettingsState`, ver ese hook): la cifra y el checklist
 * necesitan el mismo `paths` que pinta el centro, y "Volver a detectar"
 * actualiza ese mismo estado para que ambas regiones se refresquen juntas.
 */
export function DetectionStatusPanel({ state }: { state: SettingsState }) {
  const { loadState, redetecting, showPermissionWarning, handleRedetect, handleOpenGameFolder } =
    state;

  const paths: GamePaths | null = loadState.phase === "ready" ? loadState.paths : null;
  const { resolvedCount, totalCount, checklist } = computeDetectionStatus(paths);
  const anyBusy = state.busyField !== null || redetecting;

  return (
    <div className={styles.panel}>
      <p className={styles.kicker}>Estado de detección</p>

      <div className={styles.metric}>
        <span className={styles.metricNumber}>{resolvedCount}</span>
        <span className={styles.metricTotal}>/{totalCount}</span>
        <span className={styles.metricLegend}>rutas resueltas</span>
      </div>

      <div className={styles.hairline} />

      <ul className={styles.checklist}>
        {checklist.map((item) => (
          <li key={item.label} className={styles.checklistItem}>
            <span className={item.ok ? styles.iconOk : styles.iconBad}>{item.ok ? "✓" : "✕"}</span>
            <span className={styles.checklistLabel}>{item.label}</span>
          </li>
        ))}
      </ul>

      {showPermissionWarning && (
        <p className={styles.warningBox}>
          Esta instalación va a pedir permisos de administrador en la primera fusión de cada
          sesión.
        </p>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.redetectButton}
          disabled={anyBusy}
          onClick={handleRedetect}
        >
          {redetecting ? "Detectando..." : "Volver a detectar"}
        </button>
        <button
          type="button"
          className={styles.openFolderButton}
          disabled={paths === null || paths.gameRoot === ""}
          onClick={handleOpenGameFolder}
        >
          Abrir carpeta del juego
        </button>
      </div>
    </div>
  );
}
