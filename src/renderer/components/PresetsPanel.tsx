import { useState } from "react";

import type { Preset } from "../../main/domain/index.js";
import { canDeletePreset } from "../state/presetSwitcher.js";
import type { PresetsState } from "../state/usePresetsState.js";
import { CreatePresetModal } from "./CreatePresetModal.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import styles from "./PresetsPanel.module.css";

/**
 * Pantalla "Presets" (README `2c`, rediseño Paso 5/8) — reemplaza la barra
 * inline con `<select>` + `window.prompt()` que vivía en `PresetSwitcher`
 * hasta el Paso 4. Layout de una sola columna (sin panel derecho, README:
 * "riel + una sola columna de contenido"). Puramente presentacional — el
 * dueño del estado y de las llamadas a la API es `presetsState`
 * (`usePresetsState`, montado en `App.tsx`, compartido con el bloque del
 * riel para que ambos reflejen siempre los mismos datos, ver ese hook).
 *
 * SIN "Duplicar": no existe en el backend (`ipc-contract.ts` no tiene una
 * operación de copiar un preset) — no se agrega ningún botón para eso, ni
 * acá ni en el modal de creación (ver `CreatePresetModal.tsx`, que tampoco
 * tiene el checkbox de "copiar addons del preset activo" del mock viejo/
 * superado).
 *
 * Columna 2 de cada tarjeta (README): "N addons" SIN el "estado de
 * aplicación" ("aplicado hace 2 días" / "nunca aplicado"). `Preset` no
 * trackea NINGÚN timestamp de cuándo se aplicó por última vez (ver
 * `types.ts`) y el README es explícito en "State Management": "Ningún
 * estado ni canal IPC nuevo" — mostrar esa frase sería inventar un dato que
 * no existe. Mismo criterio ya aplicado en el Paso 3 para la meta del
 * bloque del riel.
 */
interface PresetsPanelProps {
  presetsState: PresetsState;
}

export function PresetsPanel({ presetsState }: PresetsPanelProps) {
  const {
    loadState,
    presets,
    activePresetId,
    busy,
    notice,
    clearNotice,
    handleSwitch,
    handleCreate,
    handleRename,
    handleDelete,
  } = presetsState;

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Preset | null>(null);

  if (loadState.phase === "error") {
    return (
      <p className={styles.message}>No se pudieron cargar los presets: {loadState.message}</p>
    );
  }

  const handleDeleteClick = (preset: Preset): void => {
    const confirmed = window.confirm(
      `¿Borrar el preset "${preset.name}"? Esta acción no se puede deshacer.`,
    );
    if (confirmed) handleDelete(preset.id);
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1 className={styles.title}>Presets</h1>
          <p className={styles.subtitle}>
            Cambiar de preset vuelve a fusionar e instalar. Puede pedir permisos de Windows.
          </p>
        </div>
        <button
          type="button"
          className={styles.newButton}
          disabled={busy || loadState.phase === "loading"}
          onClick={() => setCreating(true)}
        >
          Nuevo preset
        </button>
      </header>

      {notice !== null && (
        <p className={styles.notice}>
          {notice}{" "}
          <button type="button" className={styles.noticeDismiss} onClick={clearNotice}>
            Cerrar
          </button>
        </p>
      )}

      {loadState.phase === "loading" && <LoadingIndicator message="Cargando presets..." />}

      {loadState.phase === "ready" && (
        <ul className={styles.list}>
          {presets.map((preset) => {
            const isActive = preset.id === activePresetId;
            return (
              <li key={preset.id} className={isActive ? styles.cardActive : styles.card}>
                <div className={styles.info}>
                  <span className={styles.name}>
                    {preset.name}
                    {isActive && <span className={styles.activeBadge}>● Activo</span>}
                  </span>
                  {preset.description !== null && preset.description !== "" && (
                    <span className={styles.description}>{preset.description}</span>
                  )}
                </div>

                <div className={styles.status}>
                  <span className={styles.count}>
                    {preset.entries.length} addon{preset.entries.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className={styles.actions}>
                  {!isActive && (
                    <button
                      type="button"
                      className={styles.activateButton}
                      disabled={busy}
                      onClick={() => handleSwitch(preset.id)}
                    >
                      Activar
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.renameButton}
                    disabled={busy}
                    onClick={() => setRenaming(preset)}
                  >
                    Renombrar
                  </button>
                  {canDeletePreset(preset.id, activePresetId) && (
                    <button
                      type="button"
                      className={styles.deleteButton}
                      disabled={busy}
                      onClick={() => handleDeleteClick(preset)}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.footnote}>
        Un preset guarda qué addons entran y en qué orden de prioridad. El preset activo es el
        que está instalado en el juego ahora mismo.
      </p>

      {creating && (
        <CreatePresetModal
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={(name, description) => {
            setCreating(false);
            handleCreate(name, description);
          }}
        />
      )}

      {renaming !== null && (
        <CreatePresetModal
          mode="rename"
          initialName={renaming.name}
          busy={busy}
          onCancel={() => setRenaming(null)}
          onSubmit={(name) => {
            const id = renaming.id;
            setRenaming(null);
            handleRename(id, name);
          }}
        />
      )}
    </div>
  );
}
