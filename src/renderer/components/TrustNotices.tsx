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
    title: "Puede que no te dejen entrar a algunos servidores",
    text:
      "Algunos servidores con reglas estrictas pueden rechazarte o expulsarte " +
      "si usas addons combinados con esta app, porque detectan que tus " +
      "archivos del juego son distintos a los oficiales.",
  },
  {
    id: "uac-smartscreen",
    tone: "warning",
    title: "Windows puede pedirte confirmación al instalar",
    text:
      "Es normal que te pregunte si confías en este programa (puede decir " +
      "\"editor desconocido\"). No significa que sea peligroso, solo que no " +
      "está registrado como una app comercial.",
  },
  {
    id: "fan-made",
    tone: "info",
    title: "No somos parte de Valve",
    text: "Esta aplicación la hace un fan, sin ninguna relación oficial con Valve ni con Left 4 Dead 2.",
  },
  {
    id: "steam-revert",
    tone: "warning",
    title: "Steam puede deshacer los cambios sin avisar",
    text:
      "A veces Steam revisa y repara el juego automáticamente, y eso puede " +
      "borrar lo que hizo esta app. Si un día ves que tus addons ya no están, " +
      "puede ser por esto — solo hay que volver a aplicarlos.",
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
