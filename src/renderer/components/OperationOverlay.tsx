import { useEffect, useState } from "react";

import type { MergeProgressEvent, OperationResult } from "../../main/domain/index.js";
import { computeChecklist, computeProgressFraction } from "../state/operationChecklist.js";
import styles from "./OperationOverlay.module.css";

export type OperationKind = "apply" | "add" | "remove" | "switch";

/**
 * `label` en el evento "start" es OPCIONAL y pisa el texto fijo de
 * `RUNNING_LABELS` para ese `kind` (BUG-002, agregado en lote desde
 * Biblioteca): "Agregando addon..." no tiene sentido cuando la operacion en
 * curso son N addons a la vez, y `RUNNING_LABELS` es un `Record` estatico que
 * no puede llevar el conteo. Los llamadores existentes (apply/add/remove de a
 * uno) no lo pasan y siguen mostrando el texto fijo de siempre.
 */
export type OperationEvent =
  | { type: "start"; kind: OperationKind; label?: string }
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

let cachedWillNeedElevation: Promise<boolean> | null = null;

/**
 * Cacheado a nivel de modulo (mismo espiritu que el pub-sub de arriba): el
 * valor es FIJO para toda la sesion (`gameRoot` no cambia mientras la app
 * corre, ver `StartupOutcome.willNeedElevation` en composition-root.ts), asi
 * que una sola llamada IPC alcanza para toda la vida del renderer - evita que
 * cada `AddonRow` que se monta dispare su propia llamada redundante.
 */
export function getWillNeedElevation(): Promise<boolean> {
  if (cachedWillNeedElevation === null) {
    cachedWillNeedElevation = window.l4d2Api.willNeedElevation();
  }
  return cachedWillNeedElevation;
}

/**
 * Estado local del overlay (unión discriminada por `phase`). `"restarting"`
 * es un phase PROPIO desde el rediseño Paso 7/8 (antes se forzaba `"running"`
 * con un `label` que pisaba el texto — ver el comentario de BUG-004 más abajo
 * para el detalle histórico): el tratamiento visual del README (borde
 * `#4c5397` con gradiente índigo, contenido completamente distinto al
 * checklist de "running") ya no encaja como una variante de "running".
 */
type OverlayState =
  | { phase: "hidden" }
  | { phase: "running"; kind: OperationKind; label?: string; currentStep: MergeProgressEvent["step"] | null }
  | { phase: "restarting" }
  | { phase: "result"; kind: OperationKind; result: OperationResult };

const RUNNING_LABELS: Record<OperationKind, string> = {
  apply: "Aplicando cambios...",
  add: "Agregando addon...",
  remove: "Quitando addon...",
  switch: "Cambiando de preset...",
};

/** Kicker del estado de fallo (README: "cambiar el ámbar por el rojo hue 22... el ▲ por ✕"), por kind. */
const FAILURE_KICKERS: Record<OperationKind, string> = {
  apply: "No se pudo aplicar",
  add: "No se pudo agregar",
  remove: "No se pudo quitar",
  switch: "No se pudo cambiar de preset",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido.";
}

/**
 * Overlay MODAL BLOQUEANTE de progreso/resultado para las operaciones de
 * escritura del Active_Set (apply/add/remove, Seccion 21.4, y switch de
 * preset activo desde P-30 Paso 5 - las cuatro comparten el mismo canal
 * `merge:onProgress` y el mismo manejo de elevacion UAC, ver
 * `MergeOrchestrator`/`ipc-handlers.ts`, asi que no hace falta un overlay
 * aparte para el switch). A diferencia de `TrustNotices` (informativo, no
 * bloqueante), este SI bloquea la interaccion con el resto de la app mientras
 * una operacion esta en curso (backdrop de pantalla completa, sin boton de
 * cerrar en el estado "running"). Se monta UNA SOLA VEZ en `App.tsx`, fuera
 * del condicional de vista, para cubrir tanto al panel "Activos" como a
 * `AddonRow` (biblioteca) y al selector de presets por igual.
 *
 * DELIBERADO: el backdrop en "running"/"restarting" no tiene onClick ni
 * handler de Escape para cerrarse - la operacion real sigue corriendo en el
 * main process aunque el modal desaparezca, asi que cerrarlo antes de tiempo
 * dejaria el checkbox/boton de origen en un estado optimista sin resultado
 * que lo resuelva.
 *
 * REDISEÑO Paso 7/8 (README "1f"): el checklist de pasos ("en curso") usa
 * SOLO la granularidad real que ya emite `MergeOrchestrator` — ver
 * `operationChecklist.ts` para la decisión completa (confirmada contra el
 * código) de por qué el mock separa "Desempaquetando"/"Empaquetando" en dos
 * líneas con contador y acá quedan colapsadas en una sola, sin contador.
 */
export function OperationOverlay() {
  const [state, setState] = useState<OverlayState>({ phase: "hidden" });

  useEffect(() => {
    return subscribeOperation((event) => {
      if (event.type === "start") {
        setState(
          event.label === undefined
            ? { phase: "running", kind: event.kind, currentStep: null }
            : { phase: "running", kind: event.kind, label: event.label, currentStep: null },
        );
        return;
      }
      // (Paso 7/8) `status: "elevating"` y el step "restarting" (más abajo)
      // son el MISMO momento real (justo antes de que esta instancia sin
      // privilegios se cierre) — antes de este paso terminaban en vistas
      // DISTINTAS según cuál de los dos llegaba primero (un latente
      // inconsistencia de copy, nunca reportada como bug). Unificados en el
      // mismo phase "restarting" para que se vea siempre igual.
      if (event.result.status === "elevating") {
        setState({ phase: "restarting" });
        return;
      }
      setState({ phase: "result", kind: event.kind, result: event.result });
    });
  }, []);

  // BUG-004 (backend de Kiro cerrado en 8a7e009): `{ step: "restarting" }` lo
  // emite ElevationService por el mismo canal `merge:onProgress`, JUSTO ANTES
  // del relanzo `runas` - es decir, mientras esta instancia (todavia sin
  // privilegios) sigue viva pero está a punto de cerrarse. En cuanto llega,
  // el modal cambia a la vista de reinicio, EN VEZ de quedarse congelado en
  // el checklist hasta que la ventana se cierre sin aviso. Se fuerza el
  // cambio pase lo que pase con el estado previo del overlay: el HUECO
  // CONOCIDO de `AddonRow.tsx` (camino reactivo de elevacion, sin "start"
  // previo si la heuristica `willNeedElevation` se equivoco) puede llegar a
  // este punto con el overlay todavia en `"hidden"` - a diferencia de la
  // version anterior, el nuevo phase "restarting" no necesita un `kind`
  // placeholder para ese caso (su copy no depende del kind).
  useEffect(() => {
    return window.l4d2Api.onProgress((event) => {
      if (event.step === "restarting") {
        setState({ phase: "restarting" });
        return;
      }
      setState((prev) => (prev.phase === "running" ? { ...prev, currentStep: event.step } : prev));
    });
  }, []);

  if (state.phase === "hidden") return null;

  const handleClose = (): void => setState({ phase: "hidden" });

  // Extraído acá (en vez de leerlo inline dentro del botón de abajo) para que
  // el closure de `onClick` capture un `string` ya angosto, sin repetir el
  // discriminante `status === "failure"` ni recurrir a un non-null assertion.
  const failureAddonId =
    state.phase === "result" && state.result.status === "failure" ? state.result.addonId : undefined;

  const handleRemoveAndRetry = (addonId: string): void => {
    publishOperation({ type: "start", kind: "remove", label: "Sacando el addon y reintentando..." });
    window.l4d2Api
      .removeAddon(addonId)
      .then((result) => {
        publishOperation({ type: "result", kind: "remove", result });
      })
      .catch((error: unknown) => {
        publishOperation({
          type: "result",
          kind: "remove",
          result: { status: "failure", error: errorMessage(error) },
        });
      });
  };

  return (
    <div className={styles.backdrop}>
      {state.phase === "running" && (
        <div className={styles.modal}>
          <div className={styles.runningHeading}>
            <span className={styles.spinner} aria-hidden="true" />
            <p className={styles.runningTitle}>{state.label ?? RUNNING_LABELS[state.kind]}</p>
          </div>

          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${computeProgressFraction(state.currentStep) * 100}%` }}
            />
          </div>

          <ul className={styles.checklist}>
            {computeChecklist(state.currentStep).map((row) => (
              <li key={row.step} className={styles.checklistItem}>
                <span
                  className={
                    row.state === "done"
                      ? styles.stepIconDone
                      : row.state === "current"
                        ? styles.stepIconCurrent
                        : styles.stepIconPending
                  }
                >
                  {row.state === "done" ? "✓" : row.state === "current" ? "▸" : "·"}
                </span>
                <span className={row.state === "current" ? styles.stepLabelCurrent : styles.stepLabel}>
                  {row.label}
                </span>
              </li>
            ))}
          </ul>

          <p className={styles.runningNote}>
            No cierres la app: si se corta a mitad, la copia de seguridad permite volver atrás.
          </p>
        </div>
      )}

      {state.phase === "restarting" && (
        <div className={styles.modalRestarting}>
          <p className={styles.restartingKicker}>Permisos de Windows</p>
          <p className={styles.restartingTitle}>La app se va a reiniciar como administrador</p>
          <p className={styles.restartingBody}>
            Tu juego está en <code className={styles.code}>Program Files</code>, así que hace
            falta permiso para escribir ahí. Windows va a mostrar un cartel que dice{" "}
            <strong>"editor desconocido"</strong>: es esperado, la app no está firmada.
          </p>
          <p className={styles.restartingBox}>
            Tu selección queda guardada y la fusión sigue sola después del reinicio.
          </p>
          <p className={styles.restartingFooter}>
            <span className={styles.spinner} aria-hidden="true" />
            Reiniciando...
          </p>
        </div>
      )}

      {state.phase === "result" && state.result.status === "success" && (
        <div className={styles.modal}>
          <p className={styles.message}>Operación completada correctamente.</p>
          <button type="button" className={styles.closeButton} onClick={handleClose}>
            Cerrar
          </button>
        </div>
      )}

      {state.phase === "result" && state.result.status === "failure" && (
        <div className={styles.modalFailure}>
          <p className={styles.failureKicker}>✕ {FAILURE_KICKERS[state.kind]}</p>
          <p className={styles.failureTitle}>No se pudo completar la operación</p>
          <p className={styles.failureBody}>
            {state.result.addonId !== undefined && (
              <>
                El problema fue con el addon <code className={styles.code}>{state.result.addonId}</code>
                .{" "}
              </>
            )}
            <strong>Tu juego quedó como estaba</strong> — no se aplicó ningún cambio a medio hacer.
          </p>
          <details className={styles.details}>
            <summary className={styles.detailsSummary}>Ver detalle técnico</summary>
            <pre className={styles.detailsPre}>{state.result.error}</pre>
          </details>
          <div className={styles.failureActions}>
            <button type="button" className={styles.closeButtonNeutral} onClick={handleClose}>
              Cerrar
            </button>
            {failureAddonId !== undefined && (
              <button
                type="button"
                className={styles.retryButton}
                onClick={() => handleRemoveAndRetry(failureAddonId)}
              >
                Sacarlo y reintentar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
