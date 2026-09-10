// Capa UI (Seccion 21, Bloque 2 de la Tarea 21.1). Punto de entrada del
// renderer: orquesta el layout de pagina; la carga de datos y el estado real
// viven en AddonList.
import { AddonList } from "./components/AddonList.js";
import styles from "./App.module.css";

export function App() {
  return (
    <main className={styles.app}>
      <h1 className={styles.title}>L4D2 Versus Addon Manager</h1>
      <AddonList />
    </main>
  );
}
