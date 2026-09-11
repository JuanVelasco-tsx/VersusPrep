import { useEffect, useState } from "react";

import type { OperationResult, ScannedAddon, VScriptClassification } from "../../main/domain/index.js";
import { AddonCover } from "./AddonCover.js";
import { publishOperation, subscribeOperation } from "./OperationOverlay.js";
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
  // NO hace falta distinguir si el evento es de esta fila o de otra: AddonRow
  // NUNCA publica "start" (solo publica "result", y solo al confirmar un
  // "elevating", cuando la operacion propia YA termino). Por lo tanto el unico
  // "start" que puede llegar por el pub-sub viene del apply de ActiveSetPanel
  // -exactamente el caso que este guard debe bloquear-. El pub-sub es a nivel de
  // modulo (todas las filas reciben todo), pero como ninguna fila emite "start",
  // no hay riesgo de que una fila se auto-bloquee por su propia operacion.
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
   * valor deseado YA, invoca la IPC correspondiente, y si falla revierte al
   * valor previo y muestra el error minimo en la fila. `elevating` no se trata
   * como fallo (no se revierte): la instancia elevada completara la operacion.
   */
  const applyInclusion = (next: boolean): void => {
    const previous = included;
    setIncluded(next);
    setError(null);
    setBusy(true);
    const call = next
      ? window.l4d2Api.addAddon(addon.id, Date.now())
      : window.l4d2Api.removeAddon(addon.id);
    call
      .then((result) => {
        // "elevating": la operacion se cedio a una instancia elevada y la app se
        // va a reiniciar. Se publica al overlay global (montado en App.tsx) para
        // que avise; NO se publica en success/failure (esos siguen con el feedback
        // optimista + inline de la fila, sin overlay). No se publica "start" en
        // ningun caso: ver el comentario del useEffect del guard.
        if (result.status === "elevating") {
          publishOperation({
            type: "result",
            kind: next ? "add" : "remove",
            result,
          });
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
      applyInclusion(true);
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
            onChange={(event) => applyInclusion(event.target.checked)}
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
