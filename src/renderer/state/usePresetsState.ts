/**
 * Estado compartido de presets (lista + preset activo + mutaciones),
 * rediseño Paso 5/8. Extraído de `PresetSwitcher.tsx` (que hasta el Paso 4
 * era dueño de TODO esto) al dividir esa pantalla en dos partes (README
 * "Files": "se divide: el bloque de preset activo del riel + una pantalla
 * PresetsPanel nueva"):
 *
 * - El bloque del riel (`PresetSwitcher.tsx`) es PERSISTENTE — nunca se
 *   desmonta, vive fuera de `{view === ... &&}` — y solo necesita LEER
 *   `presets`/`activePresetId` para su kicker/nombre/meta.
 * - `PresetsPanel.tsx` (pantalla nueva, `view === "presets"`) SÍ se
 *   monta/desmonta al cambiar de vista, y es donde viven las mutaciones
 *   (activar/crear/renombrar/borrar).
 *
 * Mismo problema de fondo que `useActiveSetState` (Paso 3, arquitectura ya
 * confirmada con el usuario): si cada uno tuviera su PROPIO fetch
 * independiente, una mutación hecha en `PresetsPanel` (activar, renombrar
 * el preset activo, borrar) dejaría al bloque del riel mostrando datos
 * viejos hasta su próximo remontaje. Este hook, montado UNA vez en
 * `App.tsx` (igual patrón: llamada incondicional, nunca remonta), es la
 * ÚNICA fuente de verdad para ambos — aplica el MISMO patrón ya aprobado en
 * el Paso 3, no una decisión de arquitectura nueva.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { Preset } from "../../main/domain/index.js";
import { publishOperation, subscribeOperation } from "../components/OperationOverlay.js";
import { isPresetActivationEvent } from "./presetActivation.js";
import { createAndActivatePreset } from "./presetSwitcher.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido.";
}

export type PresetsLoadState =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "error"; message: string };

export interface PresetsState {
  loadState: PresetsLoadState;
  presets: Preset[];
  activePresetId: string | null;
  /** `true` mientras hay una mutación (activar/crear/renombrar/borrar) en curso. */
  busy: boolean;
  /** Mensaje de error de la ÚLTIMA mutación que falló; `null` si no hay ninguno pendiente de mostrar. */
  notice: string | null;
  clearNotice: () => void;
  handleSwitch: (id: string) => void;
  handleCreate: (name: string, description?: string) => void;
  handleRename: (id: string, newName: string) => void;
  handleDelete: (id: string) => void;
}

export function usePresetsState(): PresetsState {
  const [loadState, setLoadState] = useState<PresetsLoadState>({ phase: "loading" });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
  // AddonList/ActiveSetPanel/SettingsPanel/PresetSwitcher de antes). Al
  // vivir en un hook que se monta UNA sola vez para toda la vida del
  // proceso (ver docblock de arriba), este guard alcanza sin necesitar un
  // flag threadeado desde App.tsx.
  const hasStarted = useRef(false);
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    load();
  }, [load]);

  // Red de seguridad: si alguna vez otro origen publica un switch exitoso
  // por fuera de `handleSwitch`/`handleCreate` de este mismo hook, igual se
  // refleja acá. Hoy este hook es el ÚNICO que dispara "switch" (a
  // diferencia de antes del Paso 5, cuando PresetSwitcher lo hacía por su
  // cuenta), pero mantiene la simetría con el mismo patrón que ya usan
  // AddonList/ActiveSetPanel (`isPresetActivationEvent`).
  useEffect(() => {
    return subscribeOperation((event) => {
      if (!isPresetActivationEvent(event)) return;
      load();
    });
  }, [load]);

  const handleSwitch = useCallback((id: string): void => {
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
  }, []);

  /** Igual comportamiento que ya tenía `PresetSwitcher` (P-30 Paso 5): crear deja el preset activo (ver `createAndActivatePreset`). */
  const handleCreate = useCallback(
    (name: string, description?: string): void => {
      setNotice(null);
      setBusy(true);
      publishOperation({ type: "start", kind: "switch", label: "Creando preset..." });
      const api = {
        createPreset: (n: string, d?: string) => window.l4d2Api.createPreset(n, undefined, d),
        switchActivePreset: (id: string) => window.l4d2Api.switchActivePreset(id),
      };
      createAndActivatePreset(api, name, description)
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
    },
    [load],
  );

  /** Reemplaza al `window.prompt()` de antes del Paso 5 — ver `PresetsPanel.tsx`/`CreatePresetModal.tsx` (modo "rename"). */
  const handleRename = useCallback(
    (id: string, newName: string): void => {
      setNotice(null);
      setBusy(true);
      window.l4d2Api
        .renamePreset(id, newName)
        .then(() => {
          if (isMounted.current) load();
        })
        .catch((error: unknown) => {
          if (isMounted.current) setNotice(errorMessage(error));
        })
        .finally(() => {
          if (isMounted.current) setBusy(false);
        });
    },
    [load],
  );

  /** El `window.confirm()` de "¿Borrar...?" vive en `PresetsPanel.tsx` (componente), no acá — mismo criterio que `AddonRow.tsx#handleForce` para confirmaciones nativas. */
  const handleDelete = useCallback(
    (id: string): void => {
      setNotice(null);
      setBusy(true);
      window.l4d2Api
        .deletePreset(id)
        .then(() => {
          if (isMounted.current) load();
        })
        .catch((error: unknown) => {
          if (isMounted.current) setNotice(errorMessage(error));
        })
        .finally(() => {
          if (isMounted.current) setBusy(false);
        });
    },
    [load],
  );

  return {
    loadState,
    presets,
    activePresetId,
    busy,
    notice,
    clearNotice: () => setNotice(null),
    handleSwitch,
    handleCreate,
    handleRename,
    handleDelete,
  };
}
