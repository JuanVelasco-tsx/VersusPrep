import { useEffect, useState } from "react";

import type { OperationResult, ScannedAddon, VScriptClassification } from "../../main/domain/index.js";
import { AddonCover } from "./AddonCover.js";
import {
  getWillNeedElevation,
  publishOperation,
  subscribeOperation,
  type OperationKind,
} from "./OperationOverlay.js";
import styles from "./AddonRow.module.css";

/**
 * Una fila de la lista de addons (Bloque 2, Tarea 21.1; conexion al backend en
 * 21.2; reescrita en BUG-002 para selección múltiple). `classification` es
 * `"pending"` mientras `classifyVScript` todavia no resolvio para este addon -
 * un tercer estado, distinto de "bloqueado" y de "permitido" (AC 3.6-3.8: no
 * se puede advertir ni permitir sobre una clasificacion que no se conoce).
 *
 * DESACOPLE REVISADO (BUG-002): `included` YA NO es estado local optimista -
 * es un prop controlado por `AddonList` (su fuente de verdad es `getActiveSet()`,
 * la MISMA llamada IPC que usa `ActiveSetPanel`), para que Biblioteca y Activos
 * nunca puedan desincronizarse (la causa raiz del bug de QA era exactamente que
 * el checkbox no leia el Active_Set persistido al montar). El checkbox de una
 * fila YA incluida queda tildado y DESHABILITADO; sacarla del Active_Set es una
 * accion inmediata aparte ("Quitar"). Para una fila NO incluida, el checkbox
 * vuelve a ser puramente de SELECCION (`selected`, tambien controlado por el
 * padre) - tildarlo NO dispara ninguna IPC; `AddonList` es quien agrega todos
 * los seleccionados de una sola accion ("Agregar a Activos"), reemplazando el
 * flujo de a-uno-por-click que tenia esta fila antes.
 *
 * El gate de "Forzar inclusion" (VScript) sigue siendo estado efimero local:
 * solo habilita el checkbox, no persiste ninguna marca de forzado (AC 3.7/3.8).
 * Forzar sigue siendo una accion INMEDIATA de a una (requiere el dialogo de
 * confirmacion por addon), no pasa por la seleccion en lote.
 */
interface AddonRowProps {
  addon: ScannedAddon;
  classification: VScriptClassification | "pending";
  /** `true` si este addon ya esta en el Active_Set persistido (fuente: `AddonList`, mismo `getActiveSet()` que `ActiveSetPanel`). */
  included: boolean;
  /** `true` si esta fila esta marcada para el agregado en lote (solo relevante cuando `included` es `false`). */
  selected: boolean;
  /** Notifica al padre un cambio de seleccion (checkbox de una fila NO incluida). */
  onToggleSelect: (addonId: string, next: boolean) => void;
  /** Notifica al padre que este addon se agrego con exito (fuera del lote: via "Forzar inclusion"). */
  onAdded: (addonId: string) => void;
  /** Notifica al padre que este addon se quito con exito (boton "Quitar"). */
  onRemoved: (addonId: string) => void;
}

export function AddonRow({
  addon,
  classification,
  included,
  selected,
  onToggleSelect,
  onAdded,
  onRemoved,
}: AddonRowProps) {
  const [forced, setForced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherOperationRunning, setOtherOperationRunning] = useState(false);

  // Guard contra una operacion de OTRO origen en curso (Seccion 21.4, sigue
  // vigente tras BUG-002): "Quitar" de esta fila, "Forzar inclusion" de esta
  // fila, el agregado en lote de AddonList o "Aplicar" de ActiveSetPanel nunca
  // deben solaparse - el backend los serializa via operationInFlight, pero sin
  // este guard la UI mostraria un error confuso en vez de deshabilitar el
  // control de entrada.
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
   * Ejecuta una escritura inmediata (add/remove de a UNO: "Quitar" y "Forzar
   * inclusion") con el mismo aviso previo a UAC que ya tenia `applyInclusion`
   * (Seccion 21.4/9.2): si `getWillNeedElevation()` dice que esta operacion
   * probablemente va a pedir elevacion, se publica "start" al overlay ANTES de
   * invocar la IPC. `onSuccess` es quien actualiza el estado compartido en
   * `AddonList` (`activeIds`) - esta fila ya no mantiene su propio `included`
   * optimista (ver DESACOPLE REVISADO arriba).
   */
  const runWrite = async (
    kind: OperationKind,
    invoke: () => Promise<OperationResult>,
    onSuccess: () => void,
  ): Promise<void> => {
    setError(null);
    setBusy(true);
    if (await getWillNeedElevation()) {
      publishOperation({ type: "start", kind });
    }
    try {
      const result = await invoke();
      if (result.status === "elevating") {
        // La instancia sin privilegios se va a cerrar; el overlay avisa el
        // reinicio (mismo criterio que antes). No hay nada mas que actualizar
        // en esta fila.
        publishOperation({ type: "result", kind, result });
        return;
      }
      if (result.status === "failure") {
        setError(result.error);
        return;
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = (): void => {
    void runWrite(
      "remove",
      () => window.l4d2Api.removeAddon(addon.id),
      () => onRemoved(addon.id),
    );
  };

  const handleForce = (): void => {
    const confirmed = window.confirm(
      "Este addon usa VScript y es incompatible con Versus_Mode. " +
        "¿Forzar su inclusión de todos modos?",
    );
    if (confirmed) {
      setForced(true);
      void runWrite(
        "add",
        () => window.l4d2Api.addAddon(addon.id, Date.now()),
        () => onAdded(addon.id),
      );
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
            checked={included || selected}
            disabled={included || isPending || blocked || busy || otherOperationRunning}
            onChange={(event) => onToggleSelect(addon.id, event.target.checked)}
          />
          {included ? "Incluido" : "Seleccionar"}
        </label>
        {included && (
          <button
            type="button"
            className={styles.removeButton}
            disabled={busy || otherOperationRunning}
            onClick={handleRemove}
          >
            Quitar
          </button>
        )}
        {!included && !isPending && isVScript && !forced && (
          <button type="button" className={styles.forceButton} onClick={handleForce}>
            Forzar inclusión
          </button>
        )}
      </div>
    </li>
  );
}
