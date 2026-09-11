// Capa UI (Seccion 21, Bloque 2 de la Tarea 21.1; nav de 21.2). Punto de
// entrada del renderer: orquesta el layout de pagina y el toggle de vista; la
// carga de datos y el estado real viven en AddonList/ActiveSetPanel, cada uno
// por su cuenta (integracion desacoplada, opcion B - ver
// Context/05-plan-seccion-21-restante.md).
import { useEffect, useState } from "react";

import { ActiveSetPanel } from "./components/ActiveSetPanel.js";
import { AddonList } from "./components/AddonList.js";
import { LoadingIndicator } from "./components/LoadingIndicator.js";
import { OperationOverlay, publishOperation } from "./components/OperationOverlay.js";
import { TrustNotices } from "./components/TrustNotices.js";
import styles from "./App.module.css";

type View = "library" | "active";

/**
 * `null` mientras no se determino si esta instancia arranco por un relanzo
 * elevado con sesion pendiente (BUG-004 parte 2, QA); una vez resuelto, fijo
 * para el resto de la sesion.
 */
export function App() {
  const [view, setView] = useState<View>("library");
  const [resuming, setResuming] = useState<boolean | null>(null);

  // (BUG-008, QA V3 jornada 2) Cache de sesion de UI: una vez que `detectPaths()`
  // resuelve `ready` (auto o manual) una vez, se recuerda ACA - que sobrevive
  // a que `AddonList` se desmonte/remonte en cada cambio de pestaña (Biblioteca
  // <-> Activos son ramas mutuamente excluyentes del JSX de abajo) - para que
  // `AddonList` no vuelva a invocar `detectPaths()` (con sus dialogos nativos
  // de seleccion manual si alguna ruta requerida no se puede auto-detectar) en
  // cada remontaje. Se resetea solo si el usuario pide explicitamente
  // "Reintentar deteccion" (ver AddonList.tsx, no pasa por este cache).
  const [pathsReady, setPathsReady] = useState(false);

  // BUG-004 parte 2 (backend de Kiro cerrado en 8a7e009, reordenamiento A1):
  // reemplaza la version anterior basada en `getResumeState()` al montar.
  // Ahora `isResuming()` es el HECHO ESTATICO correcto para esto (derivado de
  // los args de arranque, fijo para toda la vida del proceso) - a diferencia
  // de `getResumeState()`, no depende de que el resume ya haya terminado, asi
  // que no hay carrera: con A1 la ventana se crea ANTES de que el resume
  // corra, entonces al montar `App` el resume bien puede seguir en curso.
  //
  // Si `isResuming` es `true`: arranca en "Activos" (refleja lo que se estaba
  // aplicando) y pasa el flag a AddonList/ActiveSetPanel para su mensaje de
  // continuidad ("Restaurando tu selección..."), IGUAL que antes. La
  // diferencia real es lo que pasa despues: en vez de asumir que el resume ya
  // termino, se suscribe a `onProgress` (mismo canal `merge:onProgress`) y,
  // en cada evento que llega, relee `getResumeState()` - `result` sigue en
  // `null` mientras el resume esta en curso; en cuanto aparece no-null se
  // publica al `OperationOverlay` como el resultado de la operacion que
  // disparo la elevacion, y se deja de escuchar/pollear. NO se usa el replay
  // de `bufferedEvents` (D2a-i): con `isResuming` ya se esta escuchando en
  // vivo, reproducir el buffer ademas duplicaria eventos.
  //
  // POLLING DE RESPALDO (no solo eventos) - CORRECCION post-QA: reaccionar
  // SOLO a `onProgress` deja colgado al usuario en "Restaurando tu
  // selección..." para siempre ante CUALQUIER fallo real durante el resume
  // (no solo la excepcion inesperada que ya cubre el catch de `runResume` en
  // composition-root.ts). Confirmado contra `MergeOrchestrator#materialize`:
  // cuando falla un paso (`backup`/`install`/`gameinfo` via `#writeStep`, o
  // `merge` via su propio catch -> `#failureFromError`), la funcion hace
  // `return` DIRECTO con `status: "failure"` SIN emitir ningun evento
  // posterior - el ULTIMO evento que llega es el del paso que estaba por
  // EMPEZAR (p. ej. "merge"), no uno que anuncie que ese paso fallo. El
  // chequeo que dispara ESE evento corre ANTES de que el trabajo real
  // termine/falle (encuentra `result: null`), y como no llega ningun evento
  // despues, `onProgress` solo nunca vuelve a disparar un re-chequeo. Un
  // intervalo de respaldo (1s) garantiza que el resultado terminal se detecte
  // en un tiempo acotado pase lo que pase con la emision de steps; los
  // eventos de `onProgress` siguen dando respuesta casi inmediata en el
  // camino feliz ("done" se emite justo antes del success).
  useEffect(() => {
    let cancelled = false;
    let unsubscribeProgress: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const stopWatching = (): void => {
      unsubscribeProgress?.();
      unsubscribeProgress = null;
      if (pollTimer !== null) clearInterval(pollTimer);
      pollTimer = null;
    };

    const checkTerminalResult = async (): Promise<void> => {
      const state = await window.l4d2Api.getResumeState();
      if (cancelled || state === null || state.result === null) return;
      publishOperation({ type: "result", kind: "apply", result: state.result });
      stopWatching();
    };

    window.l4d2Api
      .isResuming()
      .then((isResuming) => {
        if (cancelled) return;
        setResuming(isResuming);
        if (!isResuming) return;
        setView("active");
        unsubscribeProgress = window.l4d2Api.onProgress(() => void checkTerminalResult());
        pollTimer = setInterval(() => void checkTerminalResult(), 1000);
        void checkTerminalResult();
      })
      .catch(() => {
        if (!cancelled) setResuming(false);
      });

    return () => {
      cancelled = true;
      stopWatching();
    };
  }, []);

  return (
    <main className={styles.app}>
      <h1 className={styles.title}>L4D2 Versus Addon Manager</h1>
      <nav className={styles.nav}>
        <button
          type="button"
          className={view === "library" ? styles.navButtonActive : styles.navButton}
          onClick={() => setView("library")}
        >
          Biblioteca
        </button>
        <button
          type="button"
          className={view === "active" ? styles.navButtonActive : styles.navButton}
          onClick={() => setView("active")}
        >
          Activos
        </button>
      </nav>
      <TrustNotices />
      <OperationOverlay />
      {resuming === null && <LoadingIndicator message="Cargando..." />}
      {resuming !== null && view === "library" && (
        <AddonList
          resuming={resuming}
          pathsReady={pathsReady}
          onPathsReady={() => setPathsReady(true)}
        />
      )}
      {resuming !== null && view === "active" && <ActiveSetPanel resuming={resuming} />}
    </main>
  );
}
