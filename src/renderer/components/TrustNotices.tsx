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
 * ESTATICO - texto fijo, sin logica de dominio ni estado. Se muestra desde
 * `TrustNoticesModal` (rediseño Paso 6/8, corrección sobre el popover
 * original del riel) — NUNCA como overlay bloqueante como el de progreso
 * (`OperationOverlay`, Sección 21.4): este modal se cierra libremente.
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

/**
 * Cantidad de avisos, para la píldora del riel (`App.tsx`, rediseño Paso
 * 2/8: "▲ N avisos importantes") y para `TrustNoticesModal` (Paso 6/8), que
 * siguen mostrando los 4 completos en cualquier momento DESPUÉS del primer
 * arranque (README `2e`, punto 5 del alcance del Paso 8/8 — la píldora no se
 * descarta). Exportado aparte del componente para no duplicar el array
 * `NOTICES`.
 */
export const NOTICES_COUNT = NOTICES.length;

/**
 * Versión CONDENSADA a 3 items para la caja inline de `FirstLaunchScreen`
 * (README `2e`, Paso 8/8): "Los cuatro avisos de TrustNotices.tsx se
 * condensan a tres: servidores estrictos, confirmación de Windows, y
 * fan-made + verificación de Steam fusionados en uno." Copy tomado literal
 * del mock (`screenshots/2e-primer-arranque-detectando.png`) — más corto que
 * los 4 completos de `NOTICES`, NO un subconjunto filtrado de los mismos
 * textos. `TrustNoticesModal` (los 4 completos) y esta caja condensada son
 * dos superficies DISTINTAS con copy propio cada una, a propósito: la caja
 * de acá es para la primera impresión (arranque en frío, tiene que leerse
 * rápido); el modal es para consulta posterior, sin apuro de espacio.
 */
export const CONDENSED_NOTICES: Notice[] = [
  {
    id: "sv-pure",
    tone: "warning",
    title: "Algunos servidores pueden rechazarte",
    text: "Los que tienen reglas estrictas detectan que tus archivos no son los oficiales.",
  },
  {
    id: "uac-smartscreen",
    tone: "warning",
    title: "Windows puede pedirte confirmación",
    text: "Va a decir \"editor desconocido\": la app no está firmada, no es peligrosa.",
  },
  {
    id: "fan-made-steam-revert",
    tone: "info",
    title: "Proyecto fan-made",
    text: "Sin relación con Valve. Steam puede deshacer los cambios al verificar el juego.",
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
