import { useState } from "react";

import styles from "./AddonCover.module.css";

/**
 * Portada de un addon (AC 2.4/2.6). Si `hasCover` es `false` (el Addon no
 * tiene `<id>.jpg` junto al VPK, `ScannedAddon.coverPath === null`), NO se
 * intenta cargar ninguna imagen - se muestra un fallback visual con iniciales
 * en vez de dejar un `<img>` roto. Si `hasCover` es `true` pero la carga
 * falla en runtime (portada borrada o addon desuscripto entre el escaneo y
 * el render, o el handler `l4d2cover://` la rechaza por cualquier motivo),
 * `onError` cae al MISMO fallback - un addon con portada rota se ve
 * identico a uno sin portada, nunca un `<img>` roto.
 */
interface AddonCoverProps {
  addonId: string;
  hasCover: boolean;
  title: string | undefined;
  /**
   * Tamaño visual (P-35): `"md"` (default, 64px) es la miniatura de Biblioteca
   * (`AddonRow`); `"sm"` (32px) es la variante compacta que usa `PriorityRow`
   * en "Activos", para no romper la altura de esa fila de una sola línea.
   */
  size?: "md" | "sm";
}

/** Primeras 2 letras (sin espacios) del label, en mayusculas; "?" si vacio. */
function initialsFor(label: string): string {
  const compact = label.trim().replace(/\s+/g, "");
  const initials = compact.slice(0, 2).toUpperCase();
  return initials.length > 0 ? initials : "?";
}

export function AddonCover({ addonId, hasCover, title, size = "md" }: AddonCoverProps) {
  const [failed, setFailed] = useState(false);
  const label = title ?? addonId;
  const sizeClass = size === "sm" ? styles.sm : "";

  if (!hasCover || failed) {
    return (
      <div className={`${styles.fallback} ${sizeClass}`} aria-hidden="true">
        {initialsFor(label)}
      </div>
    );
  }

  // El <id> resuelve a `<workshopFolder>\<id>.jpg` en el proceso main
  // (cover-resolver.ts); el renderer nunca ve la ruta de disco. Host FIJO
  // "local" (ver Context/04-historial-decisiones.md, fix confirmado via CDP).
  return (
    <img
      className={`${styles.image} ${sizeClass}`}
      src={`l4d2cover://local/${addonId}`}
      alt={label}
      onError={() => setFailed(true)}
    />
  );
}
