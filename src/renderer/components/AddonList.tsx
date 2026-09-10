import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PathDetectionFailureReason,
  ScannedAddon,
  VScriptClassification,
} from "../../main/domain/index.js";
import { AddonRow } from "./AddonRow.js";
import styles from "./AddonList.module.css";

/**
 * Estado de carga de la lista (Bloque 2, Tarea 21.1), como union discriminada
 * por `phase` (mismo estilo que `PathDetectionResult`/`OperationResult` del
 * dominio): hace estructuralmente imposible representar combinaciones
 * invalidas (p. ej. "ready" sin addons todavia resueltos).
 *
 * `classifications` solo tiene entrada para los addons cuya clasificacion YA
 * resolvio; la ausencia de entrada (ver `AddonList`, lookup con `?? "pending"`)
 * es el estado "pending" de cada fila.
 */
type LoadState =
  | { phase: "detecting-paths" }
  | { phase: "needs-manual"; reason: PathDetectionFailureReason }
  | { phase: "scanning-addons" }
  | {
      phase: "ready";
      addons: ScannedAddon[];
      classifications: Record<string, VScriptClassification>;
    }
  | { phase: "error"; message: string };

const REASON_MESSAGES: Record<PathDetectionFailureReason, string> = {
  "steam-not-installed": "No se detecto una instalacion de Steam.",
  "library-folders-unreadable":
    "No se pudo leer la configuracion de bibliotecas de Steam.",
  "l4d2-not-in-libraries":
    "Left 4 Dead 2 no esta instalado en ninguna biblioteca de Steam detectada.",
  "required-path-missing": "Faltan una o mas rutas requeridas del juego.",
};

export function AddonList() {
  const [state, setState] = useState<LoadState>({ phase: "detecting-paths" });

  // Guard contra el doble-montaje de StrictMode en dev: detectPaths() puede
  // disparar un dialogo nativo REAL (ManualPathProvider de produccion, ver
  // path-detector.ts #verifyThenManual) para cada ruta requerida que falte.
  // Sin este guard, StrictMode invoca el efecto dos veces al montar y el
  // usuario veria el mismo dialogo nativo duplicado. NOTA: este guard es SOLO
  // para el montaje; el boton "Reintentar deteccion" (21.3) NO pasa por aca,
  // llama a runDetection() directo (es una accion explicita del usuario).
  const hasStarted = useRef(false);

  // Guard de desmontaje REAL, en un ref APARTE (no una `let` local al mismo
  // closure que arranca `load()`). BUG YA PISADO UNA VEZ: con `cancelled`
  // como variable local de la MISMA invocacion del efecto que `hasStarted`
  // deja avanzar, el ciclo mount->cleanup->remount de StrictMode ejecuta el
  // cleanup de ESA misma invocacion (la unica que realmente llama a
  // `load()`), pisando su propio `cancelled` a `true` antes de que la
  // promesa de IPC resuelva - el resultado quedaba descartado SIEMPRE y la
  // UI se quedaba colgada en "Detectando..." para siempre (confirmado: una
  // llamada directa a detectPaths() via CDP resolvia bien; el bug era de
  // este componente, no del IPC). Al vivir en un ref propio, actualizado por
  // un efecto DISTINTO (mount/cleanup/remount de este efecto se resuelve de
  // sincrono, antes de que la promesa de red/IPC del otro efecto complete),
  // el valor final ya esta asentado en `true` para cuando `load()` continua.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Flujo de deteccion completo (detectPaths -> scanAddons -> classifyVScript),
  // extraido para poder REUSARLO: lo dispara el efecto de montaje (una sola vez,
  // via hasStarted) y tambien el boton "Reintentar deteccion" de la rama
  // needs-manual (21.3, opcion A: reutiliza los dialogos nativos ya existentes
  // en path-detector.ts, sin construir seleccion manual nueva en el renderer).
  //
  // NO necesita un guard `retrying` aparte contra doble-click: al setear
  // `phase: "detecting-paths"` como PRIMER paso (antes de cualquier await), la
  // rama needs-manual -y con ella el boton- deja de renderizarse por el propio
  // chequeo `if (state.phase === "needs-manual")`, asi que el boton no esta
  // disponible mientras la deteccion esta en curso.
  const runDetection = useCallback(async (): Promise<void> => {
    setState({ phase: "detecting-paths" });
    try {
      const detection = await window.l4d2Api.detectPaths();
      if (!isMounted.current) return;

      if (detection.kind === "needs-manual") {
        setState({ phase: "needs-manual", reason: detection.reason });
        return;
      }

      setState({ phase: "scanning-addons" });
      const addons = await window.l4d2Api.scanAddons();
      if (!isMounted.current) return;

      // Pinta la lista YA (todas las filas en "pending" de VScript);
      // classifyVScript resuelve en paralelo y actualiza despues.
      setState({ phase: "ready", addons, classifications: {} });

      const classifications = await window.l4d2Api.classifyVScript(addons);
      if (!isMounted.current) return;

      const byId: Record<string, VScriptClassification> = {};
      for (const classification of classifications) {
        byId[classification.addonId] = classification;
      }
      setState({ phase: "ready", addons, classifications: byId });
    } catch (error) {
      if (!isMounted.current) return;
      const message = error instanceof Error ? error.message : "Error desconocido.";
      setState({ phase: "error", message });
    }
  }, []);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    void runDetection();
  }, [runDetection]);

  if (state.phase === "detecting-paths") {
    return <p className={styles.message}>Detectando rutas del juego...</p>;
  }

  if (state.phase === "needs-manual") {
    return (
      <div className={styles.message}>
        <p>
          No se pudieron detectar las rutas del juego automáticamente:{" "}
          {REASON_MESSAGES[state.reason]}
        </p>
        <button
          type="button"
          className={styles.retryButton}
          onClick={() => void runDetection()}
        >
          Reintentar detección
        </button>
      </div>
    );
  }

  if (state.phase === "scanning-addons") {
    return <p className={styles.message}>Escaneando addons...</p>;
  }

  if (state.phase === "error") {
    return <p className={styles.message}>Error: {state.message}</p>;
  }

  if (state.addons.length === 0) {
    return <p className={styles.message}>No se encontraron addons en la Workshop_Folder.</p>;
  }

  return (
    <ul className={styles.list}>
      {state.addons.map((addon) => (
        <AddonRow
          key={addon.id}
          addon={addon}
          classification={state.classifications[addon.id] ?? "pending"}
        />
      ))}
    </ul>
  );
}
