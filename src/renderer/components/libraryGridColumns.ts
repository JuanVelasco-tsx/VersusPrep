/**
 * `grid-template-columns` compartido entre el encabezado de columnas de
 * Biblioteca (`AddonList.tsx`) y cada `AddonRow.tsx`, para que ambas filas
 * queden alineadas (P-31, Paso 2). Vive en un módulo TS aparte, no en un
 * `.module.css`: CSS Modules no comparten variables entre archivos sin un
 * stylesheet global nuevo, y un valor JS importado por ambos componentes
 * evita duplicar el string y que se desincronicen entre sí.
 *
 * Columnas: selección | portada | nombre (flexible) | fecha | tamaño | tipo | acciones.
 */
export const LIBRARY_GRID_COLUMNS = "28px 48px minmax(120px,2fr) 132px 88px 88px auto";
