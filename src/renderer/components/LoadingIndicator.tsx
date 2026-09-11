import { useEffect, useState } from "react";

import styles from "./LoadingIndicator.module.css";

const DEFAULT_DELAYED_MESSAGE = "Esto puede tardar unos segundos con varios addons.";
const DEFAULT_DELAY_MS = 2500;

interface LoadingIndicatorProps {
  message: string;
  delayedMessage?: string;
  delayMs?: number;
}

/**
 * Indicador de carga acotado al panel que lo monta (Seccion 21, BUG-001 de
 * QA): spinner inmediato +, si la espera supera `delayMs` (~2-3s por
 * defecto), un mensaje mas amigable que reconoce la demora en vez de dejar al
 * usuario mirando el mismo texto fijo. Puramente presentacional: quien lo usa
 * (AddonList/ActiveSetPanel/MergeSummaryPanel) sigue siendo dueno de CUANDO
 * mostrarlo (su propio estado de fase), esto solo resuelve COMO se ve
 * mientras tanto. El timer se reinicia si `message` cambia (nueva fase de
 * carga), para no arrastrar el mensaje demorado de una fase anterior mas
 * corta a la siguiente.
 */
export function LoadingIndicator({
  message,
  delayedMessage = DEFAULT_DELAYED_MESSAGE,
  delayMs = DEFAULT_DELAY_MS,
}: LoadingIndicatorProps) {
  const [showDelayed, setShowDelayed] = useState(false);

  useEffect(() => {
    setShowDelayed(false);
    const timer = setTimeout(() => setShowDelayed(true), delayMs);
    return () => clearTimeout(timer);
  }, [message, delayMs]);

  return (
    <p className={styles.loading}>
      <span className={styles.spinner} aria-hidden="true" />
      <span>
        {message}
        {showDelayed && <span className={styles.delayed}> {delayedMessage}</span>}
      </span>
    </p>
  );
}
