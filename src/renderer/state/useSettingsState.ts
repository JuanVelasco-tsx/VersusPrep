/**
 * Estado compartido de la pantalla Configuración (README `2d`, rediseño Paso
 * 6/8) — mismo criterio de arquitectura confirmado en el Paso 3
 * (`useActiveSetState.ts`): el shell tiene DOS regiones simultáneas (centro
 * con las filas de `GamePaths`, panel derecho con "Estado de detección") que
 * necesitan el MISMO `paths`/`busyField`/`notice`, así que el estado se
 * levanta a un hook invocado UNA vez en `App.tsx` en vez de vivir dentro de
 * `SettingsPanel` (que perdería ese estado en cada remontaje al cambiar de
 * pestaña, y no podría compartirlo con el panel derecho de todos modos).
 *
 * A diferencia de `useActiveSetState`, acá no hace falta la garantía de "no
 * remonta nunca durante la vida del proceso": ninguna OTRA vista consume este
 * estado (solo "settings" tiene panel derecho propio alimentado por él), así
 * que perderlo al salir de Configuración y volver a entrar es aceptable —
 * `getPaths()` es una lectura barata y no hay debounce/preview en curso que
 * se pueda perder a mitad de camino.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { SettablePathField } from "../../main/app/ipc-contract.js";
import type { GamePaths, PathDetectionResult } from "../../main/domain/index.js";
import { getWillNeedElevation } from "../components/OperationOverlay.js";

export type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; paths: GamePaths | null }
  | { phase: "error"; message: string };

export interface SettingsState {
  loadState: LoadState;
  busyField: SettablePathField | null;
  redetecting: boolean;
  notice: string | null;
  /**
   * `true` si esta sesión va a pedir permisos de administrador en la primera
   * fusión (misma heurística ya existente que usa `OperationOverlay`/
   * `AddonRow` — ver `getWillNeedElevation`, NO se reinventa acá).
   */
  showPermissionWarning: boolean;
  handleChange: (field: SettablePathField) => void;
  handleRedetect: () => void;
  handleOpenGameFolder: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido.";
}

export function useSettingsState(): SettingsState {
  const [loadState, setLoadState] = useState<LoadState>({ phase: "loading" });
  const [busyField, setBusyField] = useState<SettablePathField | null>(null);
  const [redetecting, setRedetecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPermissionWarning, setShowPermissionWarning] = useState(false);

  // Guard contra setState tras desmontaje, mismo patrón que ya usaban
  // AddonList/ActiveSetPanel/SettingsPanel antes de este paso.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const load = useCallback(() => {
    window.l4d2Api
      .getPaths()
      .then((paths) => {
        if (isMounted.current) setLoadState({ phase: "ready", paths });
      })
      .catch((error: unknown) => {
        if (isMounted.current) setLoadState({ phase: "error", message: errorMessage(error) });
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getWillNeedElevation()
      .then((value) => {
        if (isMounted.current) setShowPermissionWarning(value);
      })
      .catch(() => {
        // Best-effort, mismo criterio que el resto de los consumidores de
        // getWillNeedElevation: sin el aviso ámbar, no bloquea la pantalla.
      });
  }, []);

  const handleChange = (field: SettablePathField): void => {
    setNotice(null);
    setBusyField(field);
    window.l4d2Api
      .setManualPath(field)
      .then((result) => {
        if (!isMounted.current) return;
        if (result.kind === "selected") {
          setLoadState({ phase: "ready", paths: result.paths });
        }
      })
      .catch((error: unknown) => {
        if (isMounted.current) setNotice(errorMessage(error));
      })
      .finally(() => {
        if (isMounted.current) setBusyField(null);
      });
  };

  const handleRedetect = (): void => {
    setNotice(null);
    setRedetecting(true);
    window.l4d2Api
      .detectPaths()
      .then((result: PathDetectionResult) => {
        if (!isMounted.current) return;
        if (result.kind === "ready") {
          setLoadState({ phase: "ready", paths: result.paths });
        } else {
          setNotice(`No se pudo completar la detección automática (${result.reason}).`);
        }
      })
      .catch((error: unknown) => {
        if (isMounted.current) setNotice(errorMessage(error));
      })
      .finally(() => {
        if (isMounted.current) setRedetecting(false);
      });
  };

  const handleOpenGameFolder = (): void => {
    window.l4d2Api
      .openGameFolder()
      .then((result) => {
        if (!isMounted.current) return;
        if (result.kind === "failed") {
          setNotice(`No se pudo abrir la carpeta del juego (${result.error}).`);
        } else if (result.kind === "no-path") {
          setNotice("Todavía no hay una carpeta del juego detectada.");
        }
      })
      .catch((error: unknown) => {
        if (isMounted.current) setNotice(errorMessage(error));
      });
  };

  return {
    loadState,
    busyField,
    redetecting,
    notice,
    showPermissionWarning,
    handleChange,
    handleRedetect,
    handleOpenGameFolder,
  };
}
