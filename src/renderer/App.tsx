// Capa UI (Seccion 21, Bloque 2 de la Tarea 21.1; nav de 21.2). Punto de
// entrada del renderer: orquesta el layout de pagina y el toggle de vista; la
// carga de datos y el estado real viven en AddonList/ActiveSetPanel, cada uno
// por su cuenta (integracion desacoplada, opcion B - ver
// Context/05-plan-seccion-21-restante.md).
import { useState } from "react";

import { ActiveSetPanel } from "./components/ActiveSetPanel.js";
import { AddonList } from "./components/AddonList.js";
import styles from "./App.module.css";

type View = "library" | "active";

export function App() {
  const [view, setView] = useState<View>("library");

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
      {view === "library" && <AddonList />}
      {view === "active" && <ActiveSetPanel />}
    </main>
  );
}
