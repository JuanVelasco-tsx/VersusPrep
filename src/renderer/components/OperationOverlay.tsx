import { useEffect, useState } from "react";

import type { OperationResult } from "../../main/domain/index.js";
import styles from "./OperationOverlay.module.css";

export type OperationKind = "apply" | "add" | "remove";

export type OperationEvent =
  | { type: "start"; kind: OperationKind }
  | { type: "result"; kind: OperationKind; result: OperationResult };

type OperationListener = (event: OperationEvent) => void;

const listeners = new Set<OperationListener>();

/**
 * Publica un evento de una operacion de escritura del Active_Set (apply/add/
 * remove) a quien este suscripto. Pub-sub MINIMO a nivel de modulo (un Set de
 * listeners), sin Context/Provider a proposito - este overlay es transversal
 * a toda la app (no vive dentro del arbol de ningun panel en particular), asi
 * que no tiene sentido forzarlo por el mismo camino de props/Context que
 * AddonList/ActiveSetPanel usan (o no usan) para sus propios datos.
 */
export function publishOperation(event: OperationEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

/**
 * Suscribe un listener a los eventos de operacion; devuelve la funcion de
 * desuscripcion. EXPORTADA (no privada al componente): ademas de
 * `OperationOverlay`, la va a reusar `AddonRow` mas adelante para saber si
 * hay una operacion de OTRO origen en curso y deshabilitarse mientras tanto -
 * evita que dos operaciones de distinto origen compitan por el unico slot
 * visible del overlay.
 */
export function subscribeOperation(listener: OperationListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Estado local del overlay (union discriminada por `phase`, mismo estilo que el resto de la UI). */
type OverlayState =
  | { phase: "hidden" }
  | { phase: "running"; kind: OperationKind }
  | { phase: "result"; kind: OperationKind; result: OperationResult };

const RUNNING_LABELS: Record<OperationKind, string> = {
  apply: "Aplicando cambios...",
  add: "Agregando addon...",
  remove: "Quitando addon...",
};

/**
 * Overlay MODAL BLOQUEANTE de progreso/resultado para las 3 operaciones de
 * escritura del Active_Set (apply/add/remove) - Seccion 21.4. A diferencia de
 * `TrustNotices` (informativo, no bloqueante), este SI bloquea la interaccion
 * con el resto de la app mientras una operacion esta en curso (backdrop de
 * pantalla completa, sin boton de cerrar en el estado "running"). Se monta
 * UNA SOLA VEZ en `App.tsx`, fuera del condicional de vista, para cubrir
 * tanto al panel "Activos" como a `AddonRow` (biblioteca) por igual.
 *
 * DELIBERADO: el backdrop en "running" no tiene onClick ni handler de Escape
 * para cerrarse - la operacion real sigue corriendo en el main process aunque
 * el modal desaparezca, asi que cerrarlo antes de tiempo dejaria el
 * checkbox/boton de origen en un estado optimista sin resultado que lo resuelva.
 */
export function OperationOverlay() {
  const [state, setState] = useState<OverlayState>({ phase: "hidden" });

  useEffect(() => {
    return subscribeOperation((event) => {
      if (event.type === "start") {
        setState({ phase: "running", kind: event.kind });
      } else {
        setState({ phase: "result", kind: event.kind, result: event.result });
      }
    });
  }, []);

  if (state.phase === "hidden") return null;

  const handleClose = (): void => setState({ phase: "hidden" });

  return (
    <div className={styles.backdrop}>
      <div className={styles.modal}>
        {state.phase === "running" && (
          <p className={styles.message}>{RUNNING_LABELS[state.kind]}</p>
        )}

        {state.phase === "result" && state.result.status === "success" && (
          <>
            <p className={styles.message}>Operacion completada correctamente.</p>
            <button type="button" className={styles.closeButton} onClick={handleClose}>
              Cerrar
            </button>
          </>
        )}

        {state.phase === "result" && state.result.status === "failure" && (
          <>
            <p className={styles.error}>{state.result.error}</p>
            <button type="button" className={styles.closeButton} onClick={handleClose}>
              Cerrar
            </button>
          </>
        )}

        {state.phase === "result" && state.result.status === "elevating" && (
          <p className={styles.message}>
            Se requieren permisos de administrador para continuar. La aplicacion se va a
            reiniciar en breve.
          </p>
        )}
      </div>
    </div>
  );
}
