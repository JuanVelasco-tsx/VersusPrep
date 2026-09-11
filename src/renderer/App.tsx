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
  // `null` mientras el resume esta en curso; en cuanto aparece no-null (el
  // evento final, sea "done" para exito o el ultimo step antes de un fallo
  // inesperado), se publica al `OperationOverlay` como el resultado de la
  // operacion que disparo la elevacion, y se deja de escuchar. NO se usa el
  // replay de `bufferedEvents` (D2a-i): con `isResuming` ya se esta
  // escuchando en vivo, reproducir el buffer ademas duplicaria eventos.
  useEffect(() => {
    let cancelled = false;
    let unsubscribeProgress: (() => void) | null = null;

    const checkTerminalResult = async (): Promise<void> => {
      const state = await window.l4d2Api.getResumeState();
      if (cancelled || state === null || state.result === null) return;
      publishOperation({ type: "result", kind: "apply", result: state.result });
      unsubscribeProgress?.();
      unsubscribeProgress = null;
    };

    window.l4d2Api
      .isResuming()
      .then((isResuming) => {
        if (cancelled) return;
        setResuming(isResuming);
        if (!isResuming) return;
        setView("active");
        unsubscribeProgress = window.l4d2Api.onProgress(() => void checkTerminalResult());
        void checkTerminalResult();
      })
      .catch(() => {
        if (!cancelled) setResuming(false);
      });

    return () => {
      cancelled = true;
      unsubscribeProgress?.();
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
      {resuming !== null && view === "library" && <AddonList resuming={resuming} />}
      {resuming !== null && view === "active" && <ActiveSetPanel resuming={resuming} />}
    </main>
  );
}
