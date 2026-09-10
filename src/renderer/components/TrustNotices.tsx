import styles from "./TrustNotices.module.css";

type NoticeTone = "info" | "warning";

interface Notice {
  id: string;
  tone: NoticeTone;
  title: string;
  text: string;
}

/**
 * Avisos de confianza/seguridad (Requirement 9, Seccion 21.3). Contenido
 * ESTATICO - texto fijo, sin logica de dominio ni estado - decision cerrada
 * de UX: notas informativas persistentes en la franja del shell, nunca un
 * modal/overlay bloqueante (eso es el progreso de 21.4).
 */
const NOTICES: Notice[] = [
  {
    id: "sv-pure",
    tone: "warning",
    title: "sv_pure estricto",
    text:
      "El Versus_Mode con addons fusionados puede no funcionar en servidores " +
      "comunitarios con sv_pure estricto: esos servidores pueden rechazar o " +
      "expulsar por archivos que no coinciden con los oficiales.",
  },
  {
    id: "uac-smartscreen",
    tone: "warning",
    title: "Prompt de UAC / SmartScreen",
    text:
      "Al escribir sobre Program Files puede aparecer el prompt de UAC como " +
      "\"editor desconocido\" (el ejecutable no esta firmado), junto con la " +
      "advertencia de SmartScreen de Windows. Es un comportamiento esperado, " +
      "no un error.",
  },
  {
    id: "fan-made",
    tone: "info",
    title: "Proyecto no oficial",
    text: "Este gestor de addons es un proyecto de fans, sin afiliacion con Valve.",
  },
  {
    id: "steam-revert",
    tone: "warning",
    title: "Posible reversion por Steam",
    text:
      "Steam puede re-verificar la integridad de los archivos del juego y " +
      "pisar los cambios de este gestor sin avisar.",
  },
];

export function TrustNotices() {
  return (
    <section className={styles.notices}>
      <h2 className={styles.heading}>Avisos</h2>
      <ul className={styles.list}>
        {NOTICES.map((notice) => (
          <li
            key={notice.id}
            className={notice.tone === "warning" ? styles.itemWarning : styles.itemInfo}
          >
            <span className={styles.title}>{notice.title}</span>
            <span className={styles.text}>{notice.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
