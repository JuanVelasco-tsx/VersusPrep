// Capa UI (Seccion 21, Bloque 2 de la Tarea 21.1; nav de 21.2). Punto de
// entrada del renderer: orquesta el layout de pagina y el toggle de vista; la
// carga de datos y el estado real viven en AddonList/ActiveSetPanel, cada uno
// por su cuenta (integracion desacoplada, opcion B - ver
// Context/05-plan-seccion-21-restante.md).
import { useEffect, useState } from "react";

import { ActiveSetPanel } from "./components/ActiveSetPanel.js";
import { AddonList } from "./components/AddonList.js";
import { LoadingIndicator } from "./components/LoadingIndicator.js";
import { OperationOverlay } from "./components/OperationOverlay.js";
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

  // `getResumeState()` (D2a-i) YA existe en el backend con exactamente la
  // senial que hace falta ("esta instancia arranco de un relanzo elevado con
  // sesion pendiente" - no `null` si y solo si el arranque vino de un resume),
  // pero hasta ahora ningun consumidor del renderer la llamaba. Es una lectura
  // DE UN SOLO USO del lado del main process (se limpia tras la primera
  // llamada, ver el comentario de `getResumeState` en main.ts) - por eso se
  // consume UNA sola vez aca, al montar App, y se deriva el booleano `resuming`
  // para toda la sesion en vez de volver a preguntar despues.
  //
  // Con `resuming === true` se arranca directo en "Activos" (refleja lo que
  // se estaba aplicando) y se le pasa el flag a AddonList/ActiveSetPanel para
  // que sus fases de carga iniciales muestren "Restaurando tu selección..."
  // en vez del texto tecnico habitual.
  //
  // MEJORA PARCIAL, NO EL FIX DE FONDO DE BUG-004 PARTE 2 (aclaracion post-QA):
  // esto solo mejora el MENSAJE una vez que la ventana por fin existe. Hoy
  // `createWindow()` (main.ts) corre DESPUES de que `runStartupSequence`
  // termina de esperar `resumePendingOperation()` (composition-root.ts) -
  // el hueco real de "pantalla en negro" que reporto QA son esos 12-17s de
  // materialize (P-23) ANTES de que la ventana se cree, y esta ventana ni
  // siquiera existe todavia para mostrar este mensaje. Mientras Kiro no
  // reordene el arranque (Opcion A: crear la ventana ANTES de esperar el
  // resume), ese hueco sigue abierto. Cuando lo reordenen, revisar si esta
  // lectura de UN SOLO USO al montar sigue alcanzando o si para ese momento
  // hace falta algo consultable EN VIVO (Kiro propuso `activeSet:isResuming`)
  // porque la ventana montaria ANTES de que el resume termine, no despues.
  // `bufferedEvents`/`result` del resume (progreso/resultado de la operacion
  // que disparo la elevacion) quedan sin consumir por ahora: no hay todavia
  // una barra de progreso ni una reproduccion del resultado final en el
  // renderer (BUG-004 parte 1 - evento de "reiniciando" antes del cierre -
  // sigue pendiente de que Kiro exponga esa parte tambien).
  useEffect(() => {
    let cancelled = false;
    window.l4d2Api
      .getResumeState()
      .then((resumeState) => {
        if (cancelled) return;
        const isResuming = resumeState !== null;
        setResuming(isResuming);
        if (isResuming) setView("active");
      })
      .catch(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
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
