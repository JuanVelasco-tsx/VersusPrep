import { useCallback, useEffect, useRef, useState } from "react";

import type { Preset } from "../../main/domain/index.js";
import { canDeletePreset, createAndActivatePreset } from "../state/presetSwitcher.js";
import { CreatePresetModal } from "./CreatePresetModal.js";
import { publishOperation } from "./OperationOverlay.js";
import styles from "./PresetSwitcher.module.css";

/**
 * Bloque "preset activo" del riel izquierdo (P-30, Paso 5 — cierra P-30;
 * reubicado en el rediseño Paso 2/8). Vive en el riel de `App.tsx`, dentro
 * del shell de tres columnas: no navega a una vista propia, actúa DIRECTO
 * sobre el preset activo, y Biblioteca/Activos ya reflejan ese cambio solos
 * (Paso 4.5, `getActiveSet`/`addAddon`/`removeAddon`/`applyActiveSet` ya
 * operan sobre el preset activo) — este componente no necesita comunicarse
 * con `AddonList`/`ActiveSetPanel` para nada.
 *
 * REUBICACIÓN (rediseño Paso 2/8): antes era una barra inline SIEMPRE
 * visible con un `<select>` (`.bar`, arriba de las pestañas). Ahora es un
 * bloque compacto (kicker/nombre/meta + botón "Cambiar preset ▾") que
 * expande el `<select>`/"Nuevo preset"/"Gestionar presets" existentes bajo
 * demanda (`expanded`, estado puramente de UI) — MISMA lógica de carga/
 * switch/creación/renombrado/borrado que ya existía, solo cambia el
 * contenedor visual. La pantalla dedicada de gestión (README `2c`, sin el
 * modo `managing` inline) es un componente NUEVO del Paso 5 — este bloque
 * no se toca de nuevo ahí, solo deja de ser la única forma de gestionar.
 *
 * `onPresetsChange` (nuevo, opcional) reporta `presets`/`activePresetId` a
 * `App.tsx` cada vez que cambian, para que el contador del item "Activos"/
 * "Presets" del nav (riel) no dispare su propia llamada redundante a
 * `listPresets()`/`getActivePresetId()` — la única fuente de esos datos
 * sigue siendo el `load()` de este componente.
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

interface PresetSwitcherProps {
  /** Notifica a `App.tsx` la lista de presets y el id activo, tal cual `load()` los resolvió. */
  onPresetsChange?: (presets: Preset[], activePresetId: string | null) => void;
}

export function PresetSwitcher({ onPresetsChange }: PresetSwitcherProps) {
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  /** `true` mientras el modal de "Nuevo preset" está abierto (bug/feature post Paso 5). */
  const [creating, setCreating] = useState(false);
  /** `true` mientras el bloque muestra el selector/"Nuevo preset"/"Gestionar" (rediseño Paso 2/8, puramente UI). */
  const [expanded, setExpanded] = useState(false);

  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Reporta presets/activePresetId a App.tsx en cada cambio (ver doc de
  // `onPresetsChange` arriba) - efecto aparte del `load()` de abajo porque
  // tambien debe dispararse tras `handleSwitch`/`handleCreateSubmit` (que
  // actualizan `activePresetId` sin volver a llamar `load()`).
  useEffect(() => {
    onPresetsChange?.(presets, activePresetId);
  }, [presets, activePresetId, onPresetsChange]);

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
      <button
        type="button"
        className={styles.changeButton}
        disabled={busy}
        onClick={() => setExpanded((prev) => !prev)}
      >
        Cambiar preset {expanded ? "▴" : "▾"}
      </button>

      {expanded && (
        <div className={styles.expanded}>
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
                    {preset.id === activePresetId && (
                      <span className={styles.activeBadge}> (activo)</span>
                    )}
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
      )}
    </div>
  );
}
