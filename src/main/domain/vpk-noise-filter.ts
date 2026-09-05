/**
 * Filtrado de ruido de la salida de `vpk.exe` (AC 6.2 / Property 8).
 *
 * `vpk.exe` intercala en su stdout líneas de diagnóstico/depuración que NO son
 * parte del listado de contenido del VPK. El diseño (sección VpkTool) especifica
 * que se descartan las líneas que comienzan con `CDynamicFunction:`, `FS:` o
 * `Using`, conservando el resto de las líneas sin alterarlas.
 *
 * Esta función es PURA: no realiza I/O ni tiene efectos. Recibe el stdout crudo
 * y devuelve las líneas de contenido conservadas. La usará `VpkTool.list()`
 * (tarea 2.7, todavía NO implementada).
 *
 * Scope de esta función (tarea 2.1): SOLO filtra el ruido. NO traduce
 * separadores de path (los paths internos del VPK usan `/`; su traducción a `\`
 * es la tarea 2.5) ni interpreta el contenido de las líneas de ningún otro modo.
 *
 * ---------------------------------------------------------------------------
 * Decisiones de implementación (documentadas para que el property test de 2.2
 * pueda escribirse sin ambigüedad):
 *
 * 1. Firma / forma de datos. Se acepta el stdout crudo como `string` y se
 *    devuelve `string[]` con las líneas conservadas, porque `list()` necesitará
 *    las líneas ya separadas. Se ofrece además una variante `filterNoiseLines`
 *    que opera sobre un `string[]` ya separado (útil para tests directos y para
 *    componer con otras utilidades), y `filterVpkNoise` se define sobre ella.
 *
 * 2. Criterio de "comienza con". El requisito dice "líneas que comienzan con".
 *    Se interpreta como PREFIJO LITERAL al inicio EXACTO de la línea, SIN
 *    aplicar `trim`. Es decir, una línea con espacios iniciales antes de `FS:`
 *    (p. ej. "  FS: ...") NO se considera ruido y se conserva, porque no
 *    "comienza con" el prefijo de forma literal. Este criterio es el más fiel al
 *    texto del requisito y es determinista y sin ambigüedad.
 *
 * 3. Sensibilidad a mayúsculas. La comparación es SENSIBLE a mayúsculas: los
 *    prefijos se comparan tal cual (`CDynamicFunction:`, `FS:`, `Using`). El
 *    requisito los enumera de forma literal, sin indicar case-insensitive.
 *
 * 4. Separación de líneas y fin de línea. Se soporta `\n` y `\r\n` (Windows):
 *    el separador es la expresión `\r?\n`. Además, un eventual `\r` colgante al
 *    final de una línea (p. ej. entradas con solo `\r`) se normaliza quitándolo
 *    del final de cada línea antes de evaluar el prefijo, de modo que el criterio
 *    de "comienza con" no dependa del estilo de fin de línea. Las líneas
 *    conservadas se devuelven ya sin el `\r` final.
 *
 * 5. Línea final vacía. Si el stdout termina con un salto de línea, `split`
 *    produce una última cadena vacía; esa línea vacía final se DESCARTA (no se
 *    emite como línea conservada). Las líneas vacías intermedias, en cambio, SÍ
 *    se conservan (no comienzan con ninguno de los prefijos de ruido). Un stdout
 *    vacío produce un arreglo vacío.
 * ---------------------------------------------------------------------------
 */

/**
 * Prefijos de ruido que marcan una línea del stdout de `vpk.exe` para descarte.
 * Se exportan como constante nombrada para reutilización y para que los tests
 * (tarea 2.2) puedan referenciar el mismo criterio sin duplicar literales.
 *
 * `as const` fija el tipo a la tupla literal de prefijos (readonly), reforzando
 * que este es el criterio único y estable del filtrado.
 */
export const VPK_NOISE_PREFIXES = ["CDynamicFunction:", "FS:", "Using"] as const;

/** Tipo de un prefijo de ruido individual. */
export type VpkNoisePrefix = (typeof VPK_NOISE_PREFIXES)[number];

/**
 * Indica si una línea (ya sin `\r` final) es ruido, es decir, si comienza con
 * alguno de los prefijos de {@link VPK_NOISE_PREFIXES}. Prefijo literal al
 * inicio exacto, sensible a mayúsculas y sin `trim` (ver decisión 2 y 3).
 */
export function isVpkNoiseLine(line: string): boolean {
  return VPK_NOISE_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Filtra el ruido de un arreglo de líneas ya separadas. Conserva, sin
 * alterarlas (salvo la normalización del `\r` final, ver decisión 4), todas las
 * líneas que NO comienzan con un prefijo de ruido.
 *
 * @param lines Líneas del stdout (pueden traer un `\r` colgante al final).
 * @returns Líneas conservadas, en su orden original y sin el `\r` final.
 */
export function filterNoiseLines(lines: readonly string[]): string[] {
  const kept: string[] = [];
  for (const rawLine of lines) {
    // Normaliza un posible `\r` colgante (fin de línea de Windows) para que el
    // criterio de prefijo sea independiente del estilo de salto de línea.
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!isVpkNoiseLine(line)) {
      kept.push(line);
    }
  }
  return kept;
}

/**
 * Filtra el ruido del stdout crudo de `vpk.exe`.
 *
 * @param stdout Salida estándar cruda de `vpk.exe` (con `\n` o `\r\n`).
 * @returns Líneas de contenido conservadas (sin las de ruido), en orden y sin
 *          alterar; se descarta la línea final vacía producida por un salto de
 *          línea terminal (ver decisión 5).
 */
export function filterVpkNoise(stdout: string): string[] {
  if (stdout.length === 0) {
    return [];
  }

  // Separa por `\n` tolerando `\r\n`; el eventual `\r` colgante lo maneja
  // filterNoiseLines de forma uniforme (ver decisión 4).
  const rawLines = stdout.split("\n");

  // Descarta la línea final vacía derivada de un salto de línea terminal
  // (ver decisión 5). Solo la ÚLTIMA, para no perder líneas vacías intermedias.
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  return filterNoiseLines(rawLines);
}
