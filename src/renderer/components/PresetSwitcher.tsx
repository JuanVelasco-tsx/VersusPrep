import { useCallback, useEffect, useRef, useState } from "react";

import type { Preset } from "../../main/domain/index.js";
import { canDeletePreset, createAndActivatePreset } from "../state/presetSwitcher.js";
import { CreatePresetModal } from "./CreatePresetModal.js";
import { publishOperation } from "./OperationOverlay.js";
import styles from "./PresetSwitcher.module.css";

/**
 * Selector de presets de la navegación (P-30, Paso 5 — cierra P-30). Vive en
 * el mismo lugar que las pestañas Biblioteca/Activos/Configuración
 * (`App.tsx`), pero es un componente aparte (no una cuarta pestaña): no
 * navega a una vista propia, actúa DIRECTO sobre el preset activo, y
 * Biblioteca/Activos ya reflejan ese cambio solos (Paso 4.5, `getActiveSet`/
 * `addAddon`/`removeAddon`/`applyActiveSet` ya operan sobre el preset
 * activo) — este componente no necesita comunicarse con `AddonList`/
 * `ActiveSetPanel` para nada.
 *
 * `switchActivePreset`/`createPreset` (vía `createAndActivatePreset`) son
 * operaciones de escritura que pueden disparar elevación UAC por el mismo
 * `merge:onProgress` que ya usan apply/add/remove — se reporta con el MISMO
 * `OperationOverlay` (`publishOperation`), sin un overlay nuevo.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido.";
}

type LoadState = { phase: "loading" } | { phase: "ready" } | { phase: "error"; message: string };

export function PresetSwitcher() {
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  /** `true` mientras el modal de "Nuevo preset" está abierto (bug/feature post Paso 5). */
  const [creating, setCreating] = useState(false);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    Promise.all([window.l4d2Api.listPresets(), window.l4d2Api.getActivePresetId()])
      .then(([list, activeId]) => {
        if (!isMounted.current) return;
        setPresets(list);
        setActivePresetId(activeId);
        setLoadState({ phase: "ready" });
      })
      .catch((error: unknown) => {
        if (!isMounted.current) return;
        setLoadState({ phase: "error", message: errorMessage(error) });
      });
  }, []);

  // Guard contra el doble-montaje de StrictMode en dev (mismo patron que
  // AddonList/ActiveSetPanel/SettingsPanel).
  const hasStarted = useRef(false);
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    load();
  }, [load]);

  const handleSwitch = (id: string): void => {
    if (id === activePresetId || busy) return;
    setNotice(null);
    setBusy(true);
    publishOperation({ type: "start", kind: "switch" });
    window.l4d2Api
      .switchActivePreset(id)
      .then((result) => {
        publishOperation({ type: "result", kind: "switch", result });
        if (!isMounted.current) return;
        if (result.status === "success") setActivePresetId(id);
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        publishOperation({
          type: "result",
          kind: "switch",
          result: { status: "failure", error: message },
        });
      })
      .finally(() => {
        if (isMounted.current) setBusy(false);
      });
  };

  /**
   * Confirmación del modal `CreatePresetModal` (bug/feature post Paso 5):
   * antes, "Nuevo preset" pedía el nombre con `window.prompt()` (sin
   * descripción, sin el aspecto del resto de la app). El adaptador `api` es
   * necesario porque `window.l4d2Api.createPreset` tiene `entries` como
   * segundo parámetro posicional (no `description`) — pasarlo TAL CUAL a
   * `createAndActivatePreset` mandaría la descripción al parámetro
   * equivocado sin que TypeScript lo marque (misma arity, tipos
   * estructuralmente compatibles).
   */
  const handleCreateSubmit = (name: string, description: string): void => {
    // Cierra el modal DE ENTRADA (no al terminar): la operación real que
    // sigue (createPreset + switchActivePreset) puede disparar elevación
    // UAC y ya tiene su propio indicador — el `OperationOverlay` compartido
    // (mismo criterio que `handleSwitch`, que tampoco muestra UI propia
    // mientras espera). Dejar el modal abierto detrás del overlay se vería
    // como si "Nuevo preset" hubiera quedado colgado.
    setCreating(false);
    setNotice(null);
    setBusy(true);
    publishOperation({ type: "start", kind: "switch", label: "Creando preset..." });
    const api = {
      createPreset: (n: string, d?: string) => window.l4d2Api.createPreset(n, undefined, d),
      switchActivePreset: (id: string) => window.l4d2Api.switchActivePreset(id),
    };
    createAndActivatePreset(api, name, description === "" ? undefined : description)
      .then(({ preset, switchResult }) => {
        publishOperation({ type: "result", kind: "switch", result: switchResult });
        if (!isMounted.current) return;
        if (switchResult.status === "success") setActivePresetId(preset.id);
        load();
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        publishOperation({
          type: "result",
          kind: "switch",
          result: { status: "failure", error: message },
        });
        if (isMounted.current) setNotice(message);
      })
      .finally(() => {
        if (isMounted.current) setBusy(false);
      });
  };

  const handleRename = (preset: Preset): void => {
    const newName = window.prompt("Nuevo nombre del preset:", preset.name);
    if (newName === null) return; // cancelado
    setNotice(null);
    setBusy(true);
    window.l4d2Api
      .renamePreset(preset.id, newName)
      .then(() => {
        if (isMounted.current) load();
      })
      .catch((error: unknown) => {
        if (isMounted.current) setNotice(errorMessage(error));
      })
      .finally(() => {
        if (isMounted.current) setBusy(false);
      });
  };

  const handleDelete = (preset: Preset): void => {
    const confirmed = window.confirm(`¿Borrar el preset "${preset.name}"? Esta acción no se puede deshacer.`);
    if (!confirmed) return;
    setNotice(null);
    setBusy(true);
    window.l4d2Api
      .deletePreset(preset.id)
      .then(() => {
        if (isMounted.current) load();
      })
      .catch((error: unknown) => {
        if (isMounted.current) setNotice(errorMessage(error));
      })
      .finally(() => {
        if (isMounted.current) setBusy(false);
      });
  };

  if (loadState.phase === "loading") return null;
  if (loadState.phase === "error") {
    return <p className={styles.notice}>No se pudieron cargar los presets: {loadState.message}</p>;
  }

  return (
    <div className={styles.bar}>
      <select
        className={styles.select}
        value={activePresetId ?? ""}
        disabled={busy}
        onChange={(event) => handleSwitch(event.target.value)}
      >
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={styles.button}
        disabled={busy}
        onClick={() => setCreating(true)}
      >
        Nuevo preset
      </button>

      {creating && (
        <CreatePresetModal
          busy={busy}
          onCancel={() => setCreating(false)}
          onSubmit={handleCreateSubmit}
        />
      )}

      <button
        type="button"
        className={styles.button}
        disabled={busy}
        onClick={() => setManaging((prev) => !prev)}
      >
        {managing ? "Ocultar gestión" : "Gestionar presets"}
      </button>

      {notice !== null && <p className={styles.notice}>{notice}</p>}

      {managing && (
        <ul className={styles.manageList}>
          {presets.map((preset) => (
            <li key={preset.id} className={styles.manageRow}>
              <span>
                {preset.name}
                {preset.id === activePresetId && <span className={styles.activeBadge}> (activo)</span>}
              </span>
              <span className={styles.manageActions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => handleRename(preset)}
                >
                  Renombrar
                </button>
                {canDeletePreset(preset.id, activePresetId) && (
                  <button
                    type="button"
                    className={styles.button}
                    disabled={busy}
                    onClick={() => handleDelete(preset)}
                  >
                    Eliminar
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
