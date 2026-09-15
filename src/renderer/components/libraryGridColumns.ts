/**
 * `grid-template-columns` compartido entre el encabezado de columnas de
 * Biblioteca (`AddonList.tsx`) y cada `AddonRow.tsx`, para que ambas filas
 * queden alineadas (P-31, Paso 2). Vive en un módulo TS aparte, no en un
 * `.module.css`: CSS Modules no comparten variables entre archivos sin un
 * stylesheet global nuevo, y un valor JS importado por ambos componentes
 * evita duplicar el string y que se desincronicen entre sí.
 *
 * Columnas: selección | portada | nombre (flexible) | fecha | tamaño | tipo | acciones.
 *
 * FIX (bug reportado tras Paso 2, commit 8f45fa3): la columna de portada
 * decía `48px`, pero `AddonCover` (variante "md", la que usa `AddonRow`) mide
 * `64px x 64px` (`AddonCover.module.css` .image/.fallback) - ese desfasaje
 * hacía que la miniatura desbordara SIEMPRE ~16px hacia la columna de texto
 * (confirmado con `getBoundingClientRect` en un repro headless: la portada
 * pisaba ~4px del inicio del titulo incluso con textos cortos, y mucho mas
 * con titulos largos donde encima el texto ocupaba mas lineas). `64px` acá
 * hace que la columna coincida exactamente con el tamaño real de la portada.
 */
export const LIBRARY_GRID_COLUMNS = "28px 64px minmax(120px,2fr) 132px 88px 88px auto";
