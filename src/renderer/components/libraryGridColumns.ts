/**
 * `grid-template-columns` compartido entre el encabezado de columnas de
 * Biblioteca (`AddonList.tsx`) y cada `AddonRow.tsx`, para que ambas filas
 * queden alineadas. Vive en un módulo TS aparte, no en un `.module.css`:
 * CSS Modules no comparten variables entre archivos sin un stylesheet
 * global nuevo, y un valor JS importado por ambos componentes evita
 * duplicar el string y que se desincronicen entre sí.
 *
 * REDISEÑO (README `2a`, Paso 3/8): reemplaza la grilla de 7 columnas de
 * P-31 (selección | portada | nombre | fecha | tamaño | tipo | acciones) —
 * fecha/tamaño/tipo se mudan a la línea de metadatos bajo el título, y
 * "Incluir" pasa de columna propia a chip (columna 4). La grilla del
 * README es literal: "26px 40px minmax(0,1fr) 168px 96px" con
 * `gap:13px` — 13px coincide EXACTO con `--space-6`, así que el gap sí usa
 * el token (ver `AddonList.module.css`/`AddonRow.module.css`); las 5
 * columnas en sí son DIMENSIONES DE LAYOUT (no ritmo de espaciado, mismo
 * criterio que el resto de este archivo), van literales.
 */
export const LIBRARY_GRID_COLUMNS = "26px 40px minmax(0,1fr) 168px 96px";
