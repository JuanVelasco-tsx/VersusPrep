import type { PresetsState } from "../state/usePresetsState.js";
import styles from "./PresetSwitcher.module.css";

/**
 * Bloque "preset activo" del riel izquierdo (P-30, Paso 5 — cierra P-30;
 * reubicado en el rediseño Paso 2/8; simplificado a solo-lectura en el
 * Paso 5/8). Vive en el riel de `App.tsx`, dentro del shell de tres
 * columnas: no navega a una vista propia — actúa como resumen persistente
 * del preset activo, y "Cambiar preset ▾" navega a `PresetsPanel` (README
 * "Files": "Conectá el nav/botón 'Cambiar preset ▾' del riel para que
 * navegue a esta pantalla").
 *
 * REDISEÑO Paso 5/8: hasta el Paso 4, este componente era dueño de TODO el
 * estado y las mutaciones de presets (cargar, activar, crear, renombrar,
 * borrar) detrás de un `<select>` que expandía "Cambiar preset ▾". Ahora
 * "Presets" es una pantalla propia (`PresetsPanel.tsx`, README `2c`) — este
 * bloque queda PURAMENTE presentacional (kicker/nombre/meta + un botón que
 * navega), consumiendo `presetsState` (de `usePresetsState`, compartido con
 * `PresetsPanel` para que ambos reflejen SIEMPRE los mismos datos — ver el
 * docblock de ese hook para el porqué).
 */
interface PresetSwitcherProps {
  presetsState: PresetsState;
  /** Navega a la pantalla "Presets" (`App.tsx`, `setView("presets")`). */
  onOpenPresets: () => void;
}

export function PresetSwitcher({ presetsState, onOpenPresets }: PresetSwitcherProps) {
  const { loadState, presets, activePresetId } = presetsState;

  if (loadState.phase === "loading") return null;
  if (loadState.phase === "error") {
    return <p className={styles.notice}>No se pudieron cargar los presets: {loadState.message}</p>;
  }

  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? null;

  return (
    <div className={styles.block}>
      <span className={styles.kicker}>Preset activo</span>
      <span className={styles.name}>{activePreset?.name ?? "Sin preset activo"}</span>
      <span className={styles.meta}>
        {activePreset === null
          ? "—"
          : `${activePreset.entries.length} addon${activePreset.entries.length === 1 ? "" : "s"}`}
      </span>
      <button type="button" className={styles.changeButton} onClick={onOpenPresets}>
        Cambiar preset ▾
      </button>
    </div>
  );
}
