import { useEffect, useState } from "react";

import type { OperationResult, ScannedAddon, VScriptClassification } from "../../main/domain/index.js";
import type { CollisionSummary } from "./PriorityRow.js";
import { AddonCover } from "./AddonCover.js";
import { LIBRARY_GRID_COLUMNS } from "./libraryGridColumns.js";
import {
  getWillNeedElevation,
  publishOperation,
  subscribeOperation,
  type OperationKind,
} from "./OperationOverlay.js";
import styles from "./AddonRow.module.css";

/**
 * Formatea `mtimeMs` para la línea de metadatos de la fila (README `2a`,
 * columna 3: "autor · tamaño · fecha"). `0` es el valor de degradación
 * best-effort de `ScannedAddon.mtimeMs` (ver ese tipo: nunca es un
 * `mtimeMs` real de un archivo existente), así que se muestra como "—" en
 * vez de una fecha de época 1970 engañosa.
 */
function formatModifiedDate(mtimeMs: number): string {
  if (mtimeMs === 0) return "—";
  return new Date(mtimeMs).toLocaleDateString("es-AR");
}

/** Formatea `sizeBytes` para la misma línea de metadatos. Mismo criterio de degradación que `formatModifiedDate` para `0`. */
function formatFileSize(sizeBytes: number): string {
  if (sizeBytes === 0) return "—";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Una fila de la lista de addons (Bloque 2, Tarea 21.1; conexion al backend en
 * 21.2; reescrita en BUG-002 para selección múltiple; grilla de 5 columnas +
 * chips de estado del rediseño, README `2a`, Paso 3/8). `classification` es
 * `"pending"` mientras `classifyVScript` todavia no resolvio para este addon -
 * un tercer estado, distinto de "bloqueado" y de "permitido" (AC 3.6-3.8: no
 * se puede advertir ni permitir sobre una clasificacion que no se conoce).
 *
 * DESACOPLE REVISADO (BUG-002): `included` YA NO es estado local optimista -
 * es un prop controlado por `AddonList` (su fuente de verdad es `getActiveSet()`,
 * la MISMA llamada IPC que usa `ActiveSetPanel`), para que Biblioteca y Activos
 * nunca puedan desincronizarse (la causa raiz del bug de QA era exactamente que
 * el checkbox no leia el Active_Set persistido al montar).
 *
 * REDISEÑO (Paso 3/8): el indicador "Incluido" deja de ser un checkbox
 * deshabilitado + botón "Quitar" en su propia columna, y pasa a un CHIP
 * "● En el preset" (columna 4, junto a un chip "⇄ N" si el addon tiene
 * colisiones en el preview compartido) + franja lateral — sigue siendo SOLO
 * indicador, no interactivo (README "Interactions & Behavior"). El checkbox
 * de SELECCION (columna 1, P-22) no cambia de lógica, solo de posición/estilo
 * en la grilla nueva. El gate de "Forzar inclusion" (VScript) sigue siendo
 * estado efimero local: solo habilita el checkbox de selección, no persiste
 * ninguna marca de forzado (AC 3.7/3.8) - acción INMEDIATA de a una, nunca
 * entra en la selección de lote.
 */
interface AddonRowProps {
  addon: ScannedAddon;
  classification: VScriptClassification | "pending";
  /** `true` si este addon ya esta en el Active_Set persistido (fuente: `AddonList`, mismo `getActiveSet()` que `ActiveSetPanel`). */
  included: boolean;
  /**
   * Colisiones de este addon en el preview COMPARTIDO (`useActiveSetState`,
   * ver `App.tsx`/`activeSetEntries.ts#buildCollisionSummaries`) — mismo dato
   * que alimenta el panel derecho "Estado del preset" y `PriorityRow` en
   * Activos, para que Biblioteca nunca muestre un número de colisión
   * distinto al de esas otras dos vistas. `null` si el addon no está
   * incluido o el preview todavía no resolvió.
   */
  collisionSummary: CollisionSummary | null;
  /** `true` si esta fila esta marcada para una accion en lote (independiente de `included`, ver doc de arriba). */
  selected: boolean;
  /**
   * Notifica al padre un click sobre el checkbox de SELECCION de esta fila.
   * `checked` es el estado YA resultante del click (el navegador tilda/destilda
   * antes de disparar el evento). `shiftKey` habilita la seleccion de rango en
   * `AddonList` (ver `librarySelection.ts`); Ctrl/Cmd+click no necesita un flag
   * aparte, ya que alternar solo esta fila sin tocar el resto es el
   * comportamiento nativo de un checkbox independiente.
   */
  onSelectionClick: (addonId: string, checked: boolean, shiftKey: boolean) => void;
  /** Notifica al padre que este addon se agrego con exito (fuera del lote: via "Forzar inclusion"). */
  onAdded: (addonId: string) => void;
  /** Notifica al padre que este addon se quito con exito (boton "Quitar"). */
  onRemoved: (addonId: string) => void;
}

export function AddonRow({
  addon,
  classification,
  included,
  collisionSummary,
  selected,
  onSelectionClick,
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
  // `!included` es necesario ademas de `!forced` (P-31+P-22, Paso 2): un
  // addon VScript ya incluido en una sesion ANTERIOR (forzado en ese
  // entonces) remonta con `forced` en su default local `false`, pero
  // `included` SI llega en `true` desde `getActiveSet()` - sin este chequeo,
  // el checkbox de seleccion quedaria bloqueado para una fila que en
  // realidad ya paso por la confirmacion de "Forzar inclusion" alguna vez.
  const blocked = isVScript && !forced && !included;
  const collisionCount =
    collisionSummary !== null ? collisionSummary.wins + collisionSummary.losses : 0;

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

  const rowStateClass = included ? styles.rowIncluded : blocked ? styles.rowBlocked : "";

  return (
    <li
      className={`${styles.row} ${rowStateClass}`}
      style={{ gridTemplateColumns: LIBRARY_GRID_COLUMNS }}
    >
      <input
        type="checkbox"
        className={styles.selectCheckbox}
        aria-label={`Seleccionar ${title}`}
        checked={selected}
        // Deshabilitado mientras la clasificacion VScript no resolvio (no se
        // sabe todavia si es seguro) y para VScript BLOQUEADO sin "Forzar
        // inclusion" (confirmado con el usuario, P-31+P-22 Paso 2): el
        // backend de addAddons/removeAddons NO valida VScript, es pura
        // fusion de manifest - permitir seleccionar una fila bloqueada
        // dejaria que "Incluir seleccionados" la incluya en lote sin pasar
        // por el dialogo de confirmacion individual (AC 3.7/3.8). Una vez
        // forzada (`forced`), la fila ya paso por esa confirmacion y vuelve
        // a ser seleccionable como cualquier otra.
        disabled={isPending || blocked || busy || otherOperationRunning}
        onClick={(event) =>
          onSelectionClick(addon.id, event.currentTarget.checked, event.shiftKey)
        }
        // Checkbox controlado sin onChange (el click se maneja arriba, no el
        // change, para poder leer `event.shiftKey` - ver doc de
        // `onSelectionClick`); `readOnly` silencia el warning de React por un
        // `checked` sin `onChange` (el navegador SI sigue permitiendo el
        // toggle nativo con click en un checkbox/radio - `readonly` no aplica
        // a esos tipos de input por spec, a diferencia de un `<input text>`).
        readOnly
      />
      <AddonCover addonId={addon.id} hasCover={addon.coverPath !== null} title={info?.title} />
      <div className={styles.info}>
        <span className={styles.title}>{title}</span>
        {blocked ? (
          <span className={styles.metaDanger}>Usa VScript — no tiene efecto en Versus</span>
        ) : (
          <span className={styles.meta}>
            {info?.author !== undefined && `${info.author} · `}
            {formatFileSize(addon.sizeBytes)}
            {" · "}
            {included && collisionCount > 0 ? (
              <span className={styles.metaCollide}>
                comparte {collisionCount} archivo{collisionCount === 1 ? "" : "s"}
              </span>
            ) : (
              formatModifiedDate(addon.mtimeMs)
            )}
          </span>
        )}
        {error !== null && <span className={styles.error}>{error}</span>}
      </div>
      <div className={styles.chips}>
        {included && (
          <>
            <span className={styles.chipIncluded}>● En el preset</span>
            {collisionCount > 0 && <span className={styles.chipCollide}>⇄ {collisionCount}</span>}
          </>
        )}
        {!included && isPending && <span className={styles.chipPending}>○ Clasificando...</span>}
        {!included && !isPending && blocked && (
          <span className={styles.chipBlocked}>✕ Bloqueado</span>
        )}
        {!included && !isPending && !isVScript && (
          <span className={styles.chipCompatible}>Compatible</span>
        )}
        {/* isVScript && forced && !included: ventana transitoria entre "Forzar"
            y que onAdded confirme (o un intento fallido, ver el error debajo
            del titulo) - ni "Bloqueado" (ya se forzó) ni "Compatible" (sigue
            siendo VScript) describen bien este estado. */}
        {!included && !isPending && isVScript && forced && (
          <span className={styles.chipPending}>○ Forzando...</span>
        )}
      </div>
      <div className={styles.action}>
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
            Forzar
          </button>
        )}
      </div>
    </li>
  );
}
