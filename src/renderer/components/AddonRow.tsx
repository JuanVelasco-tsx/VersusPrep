import { useEffect, useState } from "react";

import type { OperationResult, ScannedAddon, VScriptClassification } from "../../main/domain/index.js";
import { AddonCover } from "./AddonCover.js";
import { getWillNeedElevation, publishOperation, subscribeOperation } from "./OperationOverlay.js";
import styles from "./AddonRow.module.css";

/**
 * Una fila de la lista de addons (Bloque 2, Tarea 21.1; conexion al backend en
 * 21.2). `classification` es `"pending"` mientras `classifyVScript` todavia no
 * resolvio para este addon - un tercer estado, distinto de "bloqueado" y de
 * "permitido" (AC 3.6-3.8: no se puede advertir ni permitir sobre una
 * clasificacion que no se conoce).
 *
 * El checkbox "Incluir" mantiene `included` como estado LOCAL para feedback
 * optimista inmediato, y al cambiar dispara la operacion real contra el backend
 * (`addAddon`/`removeAddon` del preload). Integracion DESACOPLADA (opcion B, ver
 * Context/05-plan-seccion-21-restante.md): la fila NO comparte estado con el
 * panel "Activos" de 21.2; cada uno lee/muta el Active_Set por su cuenta (el
 * panel refetchea `getActiveSet()` cuando se muestra). El gate de "Forzar
 * inclusion" (VScript) sigue siendo estado efimero local: solo habilita el
 * checkbox, no persiste ninguna marca de forzado (AC 3.7/3.8).
 *
 * DECISION (priorityOrder de addAddon): `addAddon(addonId, priorityOrder)` exige
 * un `priorityOrder`, pero esta fila -por el desacople de la opcion B- NO conoce
 * el Active_Set actual y no puede calcular la posicion real. Se pasa `Date.now()`
 * como orden monotono creciente: deja el addon recien agregado al FINAL del
 * Priority_Order (el orquestador ordena ascendente por `priorityOrder`, y hace
 * UPSERT por addonId, ver MergeOrchestrator DECISION 4). El reordenamiento fino
 * es responsabilidad del panel de 21.2, no de este checkbox.
 */
interface AddonRowProps {
  addon: ScannedAddon;
  classification: VScriptClassification | "pending";
}

/** Traduce un OperationResult no-exitoso a un mensaje corto para la fila. */
function errorMessageFor(result: OperationResult): string | null {
  if (result.status === "success") return null;
  // "elevating": la operacion se cedio a una instancia elevada; el feedback
  // detallado es de 21.4. Para la fila alcanza con no revertir el checkbox.
  if (result.status === "elevating") return null;
  return result.error;
}

export function AddonRow({ addon, classification }: AddonRowProps) {
  const [forced, setForced] = useState(false);
  const [included, setIncluded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherOperationRunning, setOtherOperationRunning] = useState(false);

  // Guard contra una operacion de OTRO origen en curso (Seccion 21.4). Escenario
  // real que motiva esto: el usuario dispara "Aplicar" en el panel Activos
  // (ActiveSetPanel), cambia a la vista Biblioteca ANTES de que el apply resuelva
  // -ActiveSetPanel se desmonta pero su promesa de applyActiveSet sigue viva en el
  // main- y clickea un checkbox de una fila mientras el apply todavia corre. Sin
  // este guard, ese click dispararia un add/remove que competiria con el apply en
  // vuelo (el backend lo rechazaria via operationInFlight, pero la UI mostraria un
  // error confuso). Deshabilitando el checkbox mientras hay un "start" ajeno, la
  // fila no deja iniciar esa operacion solapada.
  //
  // NO hace falta distinguir si el evento es de esta fila o de otra: ademas del
  // "start" ajeno del apply de ActiveSetPanel, esta MISMA fila puede publicar su
  // propio "start" cuando willNeedElevation es true (ver applyInclusion) - el
  // pub-sub es a nivel de modulo (todas las filas reciben todo lo que se
  // publica, incluida su propia fila). Un auto-bloqueo asi es inofensivo: la
  // fila que originó ese "start" ya está deshabilitada por su propio `busy`
  // (seteado sincrono antes de publicar nada), asi que `otherOperationRunning`
  // en `true` sobre ESA fila no cambia nada visible - solo importa para las
  // OTRAS filas, que es el caso real que este guard debe cubrir.
  useEffect(() => {
    return subscribeOperation((event) => {
      setOtherOperationRunning(event.type === "start");
    });
  }, []);

  const isPending = classification === "pending";
  const isVScript = classification !== "pending" && classification.isVScriptAddon;
  const blocked = isVScript && !forced;

  const info = addon.info;
  const title = info?.title ?? addon.id;

  /**
   * Aplica el cambio de inclusion con feedback optimista: setea `included` al
   * valor deseado YA (sincrono, antes de cualquier await - el flip visual del
   * checkbox no se retrasa), invoca la IPC correspondiente, y si falla revierte
   * al valor previo y muestra el error minimo en la fila. `elevating` no se
   * trata como fallo (no se revierte): la instancia elevada completara la
   * operacion.
   *
   * Aviso previo a UAC (Seccion 21.4/9.2): si `getWillNeedElevation()` (cacheado
   * por sesion) dice que esta operacion probablemente va a pedir elevacion, se
   * publica "start" al overlay ANTES de llamar a addAddon/removeAddon, para que
   * el usuario vea el aviso ANTES de que aparezca el dialogo nativo de UAC. Es
   * CONDICIONAL a proposito: publicar "start" siempre pondria el overlay
   * bloqueante en cada click de checkbox, deshaciendo el feedback optimista sin
   * bloqueo que se decidio preservar en 21.2/21.4 - la gran mayoria de los
   * clicks no necesita elevar y sigue exactamente como antes (optimista, sin
   * overlay hasta el resultado).
   *
   * HUECO CONOCIDO Y ACEPTADO: `willNeedElevation` es la heuristica PROACTIVA
   * (path + probe write, calculada una vez al arranque - ver composition-root.ts).
   * El camino REACTIVO de respaldo (`#writeStep`/`handleWriteFailure` en
   * MergeOrchestrator, para cuando esa heuristica se equivoca - p. ej. una
   * biblioteca de Steam en otro disco con permisos restringidos) puede disparar
   * elevacion igual aunque este flag haya dicho `false`. En ese caso puntual NO
   * habria "start" previo (el aviso temprano se lo pierde), pero el "result"
   * final con status "elevating" SI se publica igual (ver mas abajo) - el
   * usuario ve el aviso de reinicio, solo que no el de "esto va a pedir UAC"
   * antes del dialogo. No se resuelve en este cambio.
   */
  const applyInclusion = async (next: boolean): Promise<void> => {
    const previous = included;
    setIncluded(next);
    setError(null);
    setBusy(true);

    const kind = next ? "add" : "remove";
    if (await getWillNeedElevation()) {
      publishOperation({ type: "start", kind });
    }

    const call = next
      ? window.l4d2Api.addAddon(addon.id, Date.now())
      : window.l4d2Api.removeAddon(addon.id);
    call
      .then((result) => {
        // "elevating": la operacion se cedio a una instancia elevada y la app se
        // va a reiniciar. Se publica al overlay global (montado en App.tsx) para
        // que avise; NO se publica en success/failure (esos siguen con el feedback
        // optimista + inline de la fila, sin overlay). Esto se publica SIEMPRE que
        // el resultado sea "elevating", haya habido "start" previo o no (ver
        // HUECO CONOCIDO arriba).
        if (result.status === "elevating") {
          publishOperation({ type: "result", kind, result });
        }
        const message = errorMessageFor(result);
        if (message !== null) {
          setIncluded(previous);
          setError(message);
        }
      })
      .catch((err: unknown) => {
        setIncluded(previous);
        setError(err instanceof Error ? err.message : "Error desconocido.");
      })
      .finally(() => setBusy(false));
  };

  const handleForce = (): void => {
    const confirmed = window.confirm(
      "Este addon usa VScript y es incompatible con Versus_Mode. " +
        "¿Forzar su inclusión de todos modos?",
    );
    if (confirmed) {
      setForced(true);
      void applyInclusion(true);
    }
  };

  return (
    <li className={styles.row}>
      <AddonCover addonId={addon.id} hasCover={addon.coverPath !== null} title={info?.title} />
      <div className={styles.info}>
        <span className={styles.title}>{title}</span>
        {info !== null && info.author !== undefined && (
          <span className={styles.author}>por {info.author}</span>
        )}
        <span className={isVScript ? `${styles.status} ${styles.statusBlocked}` : styles.status}>
          {isPending && "Clasificando..."}
          {!isPending && isVScript && "⚠ VScript: incompatible con Versus"}
          {!isPending && !isVScript && "Compatible con Versus"}
        </span>
        {error !== null && <span className={styles.error}>{error}</span>}
      </div>
      <div className={styles.actions}>
        <label className={styles.includeLabel}>
          <input
            type="checkbox"
            checked={included}
            disabled={isPending || blocked || busy || otherOperationRunning}
            onChange={(event) => void applyInclusion(event.target.checked)}
          />
          Incluir
        </label>
        {!isPending && isVScript && !forced && (
          <button type="button" className={styles.forceButton} onClick={handleForce}>
            Forzar inclusión
          </button>
        )}
      </div>
    </li>
  );
}
