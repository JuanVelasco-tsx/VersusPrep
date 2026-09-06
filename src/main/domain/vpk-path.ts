/**
 * Traducción de separadores de path del VPK al filesystem (AC 6.6 / Property 10).
 *
 * Los paths INTERNOS de un VPK usan `/` como separador de directorios (es el
 * separador que reporta `vpk l` y el que espera `vpk x` como argumento). Al
 * escribir el archivo extraído EN DISCO (Windows), el path de destino debe usar
 * el separador nativo `\`. El diseño (sección VpkTool) lo fija así:
 *
 *   "Separadores: los paths internos del VPK usan `/`; al crear en disco se
 *    traducen a `\` (AC 6.6)."
 *
 * Y el AC 6.6 (Requirement 6):
 *
 *   "WHEN el Manager construye paths de destino en disco, THE Manager SHALL usar
 *    el separador `\`, y WHEN interpreta paths internos del VPK, THE Manager
 *    SHALL usar el separador `/`."
 *
 * Esta función es PURA: no realiza I/O ni tiene efectos. Recibe el path interno
 * (con `/`) y DEVUELVE una NUEVA cadena con `\` para uso en disco. NO muta nada
 * ni modifica el modelo interno del VPK: el path interno original se sigue
 * usando con `/` allí donde corresponde (p. ej. como argumento de `vpk x`). La
 * traducción es SOLO para la escritura en disco (la usará MergeEngine, tarea 11,
 * para crear subdirectorios y ubicar el archivo extraído).
 *
 * Scope de esta función (tarea 2.5): SOLO traduce el separador conocido del VPK
 * (`/` → `\`). NO filtra ruido (tarea 2.1) ni particiona en lotes (tarea 2.3)
 * ni interpreta el path de ningún otro modo.
 *
 * ---------------------------------------------------------------------------
 * CRITERIO CENTRAL (decisión principal, documentada para que el property test
 * de la tarea 2.6 / Property 10 pueda razonar sin ambigüedad):
 *
 *   La función es una SUSTITUCIÓN PURA 1:1 de TODAS las ocurrencias de `/` por
 *   `\`, y NADA MÁS. No agrega, quita, colapsa ni reordena segmentos. Esto la
 *   hace determinista, trivialmente componible y razonable por conteo: el número
 *   de `\` en la salida es igual al número de `/` en la entrada, y el resto de
 *   los caracteres queda intacto en la misma posición relativa.
 *
 * Se elige la sustitución literal (`/` → `\`) y NO `path.sep` del módulo `path`
 * de Node a propósito (DECISIÓN documentada): queremos un comportamiento
 * DETERMINISTA e independiente del SO donde corran los tests. `path.sep` vale
 * `\` en Windows pero `/` en Linux/macOS (donde suele correr CI), lo que haría
 * que esta traducción "no hiciera nada" fuera de Windows y rompería la Property
 * 10. La traducción es explícita y siempre `/` → `\`, sin importar el SO.
 *
 * ---------------------------------------------------------------------------
 * DECISIONES SOBRE CASOS BORDE NO FIJADOS POR EL SPEC
 *
 * El spec fija el criterio general (traducir `/` → `\`) pero no detalla varios
 * casos borde. Cada uno se decide y documenta explícitamente aquí:
 *
 * 1. `\` LITERAL PREEXISTENTE dentro del path interno.
 *    Los paths internos del VPK usan `/` como separador; `\` NO es un separador
 *    interno del VPK. DECISIÓN: un `\` preexistente se PRESERVA tal cual (se
 *    trata como parte del nombre, no como separador). Motivo: esta función solo
 *    traduce el separador interno CONOCIDO del VPK (`/`) y no debe reinterpretar
 *    caracteres que el VPK no usa como separador; normalizarlos sería inventar
 *    reglas fuera del dominio.
 *    CAVEAT: en Windows, un `\` dentro de un nombre se interpretaría como
 *    separador de directorio al escribir en disco. Esto NO se espera en VPKs
 *    reales (sus paths internos usan `/`); si apareciera un `\` literal, se está
 *    FUERA del dominio validado. No se "arregla" aquí inventando una regla; solo
 *    queda anotado como caveat para el llamador.
 *
 * 2. `/` INICIAL (path que empieza con `/`, p. ej. `/materials/x.vmt`).
 *    DECISIÓN: traducción literal → `\materials\x.vmt`, SIN agregar ni quitar
 *    segmentos. NO se recorta el separador inicial ni se valida/convierte a ruta
 *    absoluta aquí. Motivo: mantener la función mínima y pura (sustitución 1:1).
 *    El resultado es un path RELATIVO desde la perspectiva de esta función; es
 *    responsabilidad del llamador (MergeEngine, tarea 11) unir este path con el
 *    `destDir` base. Un `/` inicial produciría un `\` inicial que en Windows
 *    parece raíz del drive actual; queda anotado como CAVEAT (no esperado en
 *    VPKs reales) y su interpretación queda a cargo del llamador, no de esta
 *    función.
 *
 * 3. `/` FINAL (trailing separator, p. ej. `materials/`).
 *    DECISIÓN: se PRESERVA (traducción literal 1:1) → `materials\`. Motivo:
 *    coherencia con el criterio central de sustitución pura; no se recorta ni se
 *    normaliza el separador final.
 *
 * 4. IDEMPOTENCIA / SEPARADORES CONSECUTIVOS (p. ej. `a//b`).
 *    DECISIÓN: traducción 1:1 SIN colapsar duplicados → `a\\b` (dos `\`). Motivo:
 *    la función es una sustitución de carácter pura, de modo que el property test
 *    (2.6) pueda razonar por conteo (nº de `\` de salida == nº de `/` de entrada).
 *    No se colapsan separadores repetidos.
 * ---------------------------------------------------------------------------
 */

/**
 * Separador de paths INTERNO del VPK. Los paths reportados por `vpk l` y los
 * argumentos de `vpk x` usan este separador. Se exporta como constante nombrada
 * para que el property test (2.6) referencie el mismo criterio sin duplicar el
 * literal.
 */
export const VPK_INTERNAL_SEPARATOR = "/";

/**
 * Separador de paths EN DISCO (Windows). Es el separador de destino al que se
 * traduce {@link VPK_INTERNAL_SEPARATOR} al escribir archivos extraídos.
 *
 * Se fija como literal `\` (y NO como `path.sep`) a propósito, para que la
 * traducción sea determinista e independiente del SO donde corran los tests
 * (ver CRITERIO CENTRAL en el encabezado del archivo).
 */
export const DISK_SEPARATOR = "\\";

/**
 * Traduce un path INTERNO del VPK (que usa `/`) al path de destino EN DISCO
 * (que usa `\`), reemplazando TODAS las ocurrencias de `/` por `\`.
 *
 * Sustitución PURA 1:1: no agrega, quita, colapsa ni reordena segmentos, y
 * PRESERVA cualquier `\` preexistente, el separador inicial y el final (ver las
 * DECISIONES documentadas en el encabezado del archivo). No muta la entrada:
 * devuelve una nueva cadena. El path interno original permanece intacto y debe
 * seguir usándose con `/` donde corresponda (p. ej. como argumento de `vpk x`).
 *
 * @param internalPath Path interno del VPK (separador `/`).
 * @returns Path de destino en disco con separador `\`.
 */
export function internalPathToDiskPath(internalPath: string): string {
  // `split`/`join` reemplaza TODAS las ocurrencias sin depender de la semántica
  // de `String.prototype.replaceAll` (disponible, pero `split`/`join` es igual
  // de claro y explícito sobre la naturaleza 1:1 de la sustitución).
  return internalPath.split(VPK_INTERNAL_SEPARATOR).join(DISK_SEPARATOR);
}
