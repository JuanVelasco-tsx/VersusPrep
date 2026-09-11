import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AddonManifestEntry,
  PathDetectionFailureReason,
  ScannedAddon,
  VScriptClassification,
} from "../../main/domain/index.js";
import { AddonRow } from "./AddonRow.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { publishOperation, subscribeOperation } from "./OperationOverlay.js";
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

interface AddonListProps {
  /**
   * `true` si esta instancia arranco por un relanzo elevado con una sesion
   * pendiente (BUG-004 parte 2, via `isResuming()` en `App.tsx` - HECHO
   * ESTATICO fijo para toda la vida del proceso, ver composition-root.ts).
   * Cuando es `true`, las fases de carga muestran un mensaje de continuidad
   * ("Restaurando tu selección...") en vez del texto tecnico habitual, para
   * que el reinicio post-UAC no se sienta como una Biblioteca vacia/en blanco.
   */
  resuming: boolean;
}

export function AddonList({ resuming }: AddonListProps) {
  const [state, setState] = useState<LoadState>({ phase: "detecting-paths" });

  // Active_Set persistido completo (BUG-002 parte 2), no solo los ids: se
  // necesitan las `AddonManifestEntry` reales (con su `priorityOrder`) para
  // poder mandarlas de vuelta enteras a `applyActiveSet` en el agregado en
  // lote (ver `handleBulkAdd`), no solo para chequear membership. Fuente de
  // verdad resuelta con la MISMA llamada IPC (`getActiveSet()`) que usa
  // `ActiveSetPanel`, para que Biblioteca y Activos NUNCA puedan
  // desincronizarse (causa raiz del bug de QA: el checkbox de esta lista no
  // inicializaba su `checked` desde el Active_Set persistido al montar).
  const [activeEntries, setActiveEntries] = useState<AddonManifestEntry[]>([]);
  const activeIds = useMemo(
    () => new Set(activeEntries.map((entry) => entry.addonId)),
    [activeEntries],
  );

  // Seleccion en lote (BUG-002 parte 1): addonIds marcados para agregar de
  // una sola vez, reemplazando el flujo de a-uno-por-click que tenia cada
  // checkbox. Vive aca (no en cada AddonRow) porque la accion de agregar es
  // del LISTADO completo, no de una fila individual.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Guard contra una operacion de OTRO origen en curso (mismo patron que cada
  // AddonRow, Seccion 21.4): el boton "Agregar a Activos" tambien debe
  // deshabilitarse mientras hay un "Quitar"/"Forzar inclusion" de alguna fila
  // en vuelo, y viceversa.
  const [operationRunning, setOperationRunning] = useState(false);
  useEffect(() => {
    return subscribeOperation((event) => {
      setOperationRunning(event.type === "start");
    });
  }, []);

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

  // Flujo de deteccion completo (detectPaths -> scanAddons+getActiveSet en
  // paralelo -> classifyVScript), extraido para poder REUSARLO: lo dispara el
  // efecto de montaje (una sola vez, via hasStarted) y tambien el boton
  // "Reintentar deteccion" de la rama needs-manual (21.3, opcion A: reutiliza
  // los dialogos nativos ya existentes en path-detector.ts, sin construir
  // seleccion manual nueva en el renderer).
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
      // getActiveSet() en paralelo con scanAddons() (BUG-002 parte 2): misma
      // llamada IPC que ActiveSetPanel, para que el checkbox "Incluir" arranque
      // ya sincronizado con lo que el backend tiene persistido, en vez de
      // arrancar siempre desmarcado.
      const [addons, activeSet] = await Promise.all([
        window.l4d2Api.scanAddons(),
        window.l4d2Api.getActiveSet(),
      ]);
      if (!isMounted.current) return;

      setActiveEntries(activeSet);
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

  const toggleSelect = useCallback((addonId: string, next: boolean): void => {
    setSelected((prev) => {
      const nextSet = new Set(prev);
      if (next) {
        nextSet.add(addonId);
      } else {
        nextSet.delete(addonId);
      }
      return nextSet;
    });
  }, []);

  // Re-lee el Active_Set persistido despues de cualquier escritura exitosa
  // (agregado en lote, "Quitar", "Forzar inclusion"), en vez de reconstruir
  // `activeEntries` a mano con el `priorityOrder` que CADA camino de escritura
  // usa por su cuenta. Misma llamada IPC (`getActiveSet()`) que el montaje
  // inicial y que `ActiveSetPanel` (BUG-002 parte 2) - la unica fuente de
  // verdad se re-consulta en vez de duplicarse, así ningún camino de mutación
  // puede quedar desincronizado del backend.
  const refreshActiveSet = useCallback(async (): Promise<void> => {
    const activeSet = await window.l4d2Api.getActiveSet();
    if (isMounted.current) setActiveEntries(activeSet);
  }, []);

  const handleAdded = useCallback(
    (addonId: string): void => {
      setSelected((prev) => {
        if (!prev.has(addonId)) return prev;
        const next = new Set(prev);
        next.delete(addonId);
        return next;
      });
      void refreshActiveSet();
    },
    [refreshActiveSet],
  );

  const handleRemoved = useCallback(
    (_addonId: string): void => {
      void refreshActiveSet();
    },
    [refreshActiveSet],
  );

  // Addons elegibles para seleccion en lote: clasificacion ya resuelta, no
  // bloqueados por VScript, y todavia NO incluidos. Se usa tanto para el
  // "Seleccionar todos" como para depurar `selected` de ids que dejaron de
  // ser elegibles (p. ej. se agregaron por otra via, como "Forzar inclusion").
  const eligibleIds = useMemo(() => {
    if (state.phase !== "ready") return [] as string[];
    return state.addons
      .filter((addon) => {
        const classification = state.classifications[addon.id] ?? "pending";
        const isVScript = classification !== "pending" && classification.isVScriptAddon;
        return classification !== "pending" && !isVScript && !activeIds.has(addon.id);
      })
      .map((addon) => addon.id);
  }, [state, activeIds]);

  const allEligibleSelected =
    eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));

  const toggleSelectAll = (): void => {
    setSelected(allEligibleSelected ? new Set() : new Set(eligibleIds));
  };

  /**
   * Agrega todos los addons seleccionados de una sola accion (BUG-002 parte 1,
   * reemplaza el flujo de a-uno-por-click) con UNA SOLA llamada a
   * `applyActiveSet` sobre el manifest completo (Active_Set instalado +
   * seleccionados nuevos), en vez de un `addAddon` por addon.
   *
   * CORRECCION post-QA: la version anterior llamaba `addAddon` una vez POR
   * addon seleccionado. `addAddon`/`removeAddon` NUNCA son incrementales -
   * cada invocacion materializa una fusion COMPLETA desde cero del Active_Set
   * resultante (DECISION 4 de merge-orchestrator.ts). Un loop de N `addAddon`
   * es entonces N fusiones completas para lo que deberia ser una sola
   * escritura (costoso: el materialize ya midio 12-17s con ~73 addons, P-23).
   * Peor todavia: si el addon k del loop dispara `ensureCanWrite` -> elevacion
   * UAC, la instancia SIN privilegios se CIERRA COMPLETA y se reemplaza por la
   * elevada (reemplazo total de proceso, ElevationService Decision 1 del
   * ciclo de vida) - el resume solo rehidrata la `PendingOperation` de ESE
   * `addAddon` en vuelo. Los addons k+1..N que el loop todavia no habia
   * llamado se perderian en silencio (quedan "seleccionados" en la cabeza del
   * usuario, pero la sesion que resume no sabe nada de ellos). Con una sola
   * `applyActiveSet`, si hace falta elevar hay una UNICA `PendingOperation`
   * con el manifest COMPLETO ya adentro - nada que perder al resumir.
   *
   * ORDEN: los addons nuevos van al FINAL del Priority_Order (mayor
   * prioridad), IGUAL semantica que un `addAddon` individual - confirmado
   * contra `MergeOrchestrator.addAddon` (`current = getManifest()` tal cual,
   * SIN renormalizar, + push de la entry nueva con el `priorityOrder` que
   * pasa el llamador). El checkbox "Incluir" de AddonRow ya usaba
   * `Date.now()` para eso (mayor que cualquier `priorityOrder` existente,
   * sea un timestamp previo o los enteros secuenciales que renormaliza
   * ActiveSetPanel). Acá `base + index` en vez de repetir el mismo
   * `Date.now()` para todos preserva ademas el orden RELATIVO entre los
   * addons del propio lote (el ultimo seleccionado de la tanda gana en una
   * colision contra los otros seleccionados de la misma tanda).
   */
  const handleBulkAdd = async (): Promise<void> => {
    if (state.phase !== "ready" || bulkBusy || operationRunning) return;
    const ids = state.addons.map((addon) => addon.id).filter((id) => selected.has(id));
    if (ids.length === 0) return;

    setBulkBusy(true);
    publishOperation({
      type: "start",
      kind: "add",
      label: `Agregando ${ids.length} addon${ids.length === 1 ? "" : "s"} a Activos...`,
    });

    const base = Date.now();
    const newEntries: AddonManifestEntry[] = ids.map((id, index) => ({
      addonId: id,
      priorityOrder: base + index,
    }));

    const result = await window.l4d2Api.applyActiveSet([...activeEntries, ...newEntries]);
    publishOperation({ type: "result", kind: "add", result });

    if (result.status === "success") {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      await refreshActiveSet();
    }
    setBulkBusy(false);
  };

  if (state.phase === "detecting-paths") {
    return (
      <LoadingIndicator
        message={resuming ? "Restaurando tu selección..." : "Detectando rutas del juego..."}
      />
    );
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
    return (
      <LoadingIndicator
        message={resuming ? "Restaurando tu selección..." : "Escaneando addons..."}
      />
    );
  }

  if (state.phase === "error") {
    return <p className={styles.message}>Error: {state.message}</p>;
  }

  if (state.addons.length === 0) {
    return <p className={styles.message}>No se encontraron addons en la Workshop_Folder.</p>;
  }

  return (
    <>
      {eligibleIds.length > 0 && (
        <div className={styles.selectAllBar}>
          <label className={styles.selectAllLabel}>
            <input
              type="checkbox"
              checked={allEligibleSelected}
              disabled={bulkBusy || operationRunning}
              onChange={toggleSelectAll}
            />
            Seleccionar todos
          </label>
        </div>
      )}
      <ul className={styles.list}>
        {state.addons.map((addon) => (
          <AddonRow
            key={addon.id}
            addon={addon}
            classification={state.classifications[addon.id] ?? "pending"}
            included={activeIds.has(addon.id)}
            selected={selected.has(addon.id)}
            onToggleSelect={toggleSelect}
            onAdded={handleAdded}
            onRemoved={handleRemoved}
          />
        ))}
      </ul>
      {selected.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>
            {selected.size} seleccionado{selected.size === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className={styles.bulkClearButton}
            disabled={bulkBusy}
            onClick={() => setSelected(new Set())}
          >
            Limpiar selección
          </button>
          <button
            type="button"
            className={styles.bulkAddButton}
            disabled={bulkBusy || operationRunning}
            onClick={() => void handleBulkAdd()}
          >
            Agregar a Activos
          </button>
        </div>
      )}
    </>
  );
}
