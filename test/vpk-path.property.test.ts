import fc from "fast-check";

import { internalPathToDiskPath } from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * Property test de la traducción de separadores de path (Tarea 2.6).
 *
 * Property 10: Coherencia de separadores de path
 * **Validates: Requirements 6.6**
 *
 * `internalPathToDiskPath` (tarea 2.5) es una SUSTITUCIÓN PURA 1:1 de todas las
 * ocurrencias de `/` por `\`, y nada más (ver el CRITERIO CENTRAL y las
 * DECISIONES documentadas en `src/main/domain/vpk-path.ts`). Esta propiedad
 * verifica ese criterio para paths internos ARBITRARIOS, cubriendo
 * deliberadamente los casos borde documentados.
 *
 * ---------------------------------------------------------------------------
 * ESTRATEGIA DE GENERACIÓN (y cómo se garantizan los casos borde)
 *
 * El path se construye uniendo (con `join("")`) un array de "tokens". Cada
 * token proviene de un `fc.oneof` cuyas ramas cubren, por construcción, cada
 * caso borde documentado; así el espacio de generación SIEMPRE puede producir
 * (y con árboles de 0..n tokens produce de forma natural y frecuente) todos los
 * bordes, sin sesgar hacia ninguno:
 *
 *   1. Barras `/` consecutivas: existe una rama que emite literalmente `"//"`,
 *      y además `segmentToken` (alfabeto con `/`) puede producir `/` seguidos.
 *      Unir dos tokens que empiezan/terminan en `/` también genera `a//b`.
 *   2. `/` inicial: una rama emite `"/"` (separador suelto); como PRIMER token
 *      del array produce un path que empieza con `/` (p. ej. `/materials/x`).
 *   3. `/` final (trailing): el mismo `"/"` suelto como ÚLTIMO token produce el
 *      separador final (p. ej. `materials/`).
 *   4. `\` (backslash) literales preexistentes: una rama emite `"\\"` (un
 *      backslash) y el alfabeto de `segmentToken` también incluye `\`, de modo
 *      que aparecen backslashes sueltos y mezclados con `/`.
 *   5. Paths SIN ninguna barra: `segmentToken` incluye una rama de solo
 *      letras/dígitos; un array compuesto solo por esos tokens no tiene barras.
 *   6. Cadena vacía: `fc.array(..., { minLength: 0 })` genera el array vacío,
 *      cuyo `join("")` es `""`. También la propia rama de cadena vacía aporta.
 *
 * El alfabeto "custom" combina caracteres normales (letras, dígitos, `.`, `_`,
 * `-`, espacio) con los DOS caracteres significativos del dominio, `/` y `\`,
 * de modo que `fc.string` sobre ese alfabeto produce naturalmente barras
 * consecutivas, iniciales, finales y backslashes mezclados. Las ramas de
 * `fc.oneof` con literales (`"/"`, `"//"`, `"\\"`) refuerzan que esos bordes
 * aparezcan de forma DIRECTA y frecuente, no solo por azar del alfabeto.
 *
 * ---------------------------------------------------------------------------
 * ASERCIONES (todas deben cumplirse para toda entrada generada). El oráculo NO
 * reusa `internalPathToDiskPath`: razona por conteo y comparación posición a
 * posición de forma independiente.
 *
 *   1. Sustitución 1:1 posición a posición: para cada índice `i`, si
 *      `input[i] === "/"` entonces `output[i] === "\\"`; para cualquier otro
 *      carácter, `output[i] === input[i]` (el resto queda intacto, incluidos
 *      los `\` preexistentes, que se mantienen como `\`). Esto verifica a la vez
 *      "cada `/` se traduce" y "nada más se altera".
 *   2. Longitud preservada: `output.length === input.length` (sustitución
 *      carácter a carácter, no cambia el largo).
 *   3. Conteo (formulación elegida, la más simple): en la salida NO queda
 *      ningún `/` (nº de `/` en `output` === 0), y el nº de `\` en `output` ===
 *      (nº de `/` en `input`) + (nº de `\` en `input`), porque los `/` se
 *      vuelven `\` y los `\` preexistentes se preservan.
 *   4. No mutación del input: se guarda una copia del string original y se
 *      verifica que sigue siendo igual tras la llamada. Los strings son
 *      inmutables en JS, pero se deja la garantía explícita como defensa ante
 *      futuros cambios de implementación.
 * ---------------------------------------------------------------------------
 */

/**
 * Alfabeto custom: caracteres "normales" de un nombre de archivo/segmento MÁS
 * los dos caracteres significativos del dominio (`/` y `\`). Al usarlo como
 * `unit` de `fc.string`, se generan naturalmente barras consecutivas,
 * iniciales/finales y backslashes mezclados dentro de un mismo token.
 */
const pathAlphabet =
  "abcABC012._- " + // caracteres "normales" (incluye espacio)
  "/" + // separador interno del VPK
  "\\"; // backslash literal preexistente (caso borde documentado)

const pathAlphabetChar: fc.Arbitrary<string> = fc.constantFrom(
  ...pathAlphabet.split(""),
);

/**
 * Token de "segmento": un string sobre el alfabeto custom (puede ser vacío y
 * puede contener `/`, `\`, barras consecutivas, etc.). Cubre por sí solo el
 * caso "sin barras" (cuando el azar sólo elige caracteres normales) y el de
 * barras/backslashes internos.
 */
const segmentToken: fc.Arbitrary<string> = fc.string({ unit: pathAlphabetChar });

/**
 * Un token del path. Las ramas literales fuerzan que los casos borde aparezcan
 * de forma directa y frecuente, además de lo que ya produce `segmentToken`:
 *   - `"/"`   → separador suelto (inicial/final/consecutivo al combinarse)
 *   - `"//"`  → barras consecutivas garantizadas
 *   - `"\\"`  → backslash literal preexistente
 *   - `""`    → token vacío (contribuye a cadena vacía y a uniones limpias)
 */
const pathToken: fc.Arbitrary<string> = fc.oneof(
  segmentToken,
  fc.constant("/"),
  fc.constant("//"),
  fc.constant("\\"),
  fc.constant(""),
);

/**
 * Path interno arbitrario: unión de 0..n tokens. `minLength: 0` garantiza que
 * la cadena vacía forma parte del espacio de generación.
 */
const arbitraryInternalPath: fc.Arbitrary<string> = fc
  .array(pathToken, { minLength: 0, maxLength: 12 })
  .map((tokens) => tokens.join(""));

/** Cuenta las ocurrencias de un carácter concreto en un string. */
function countChar(text: string, ch: string): number {
  let count = 0;
  for (const c of text) {
    if (c === ch) count += 1;
  }
  return count;
}

propertyTest(
  10,
  "Coherencia de separadores de path",
  fc.property(arbitraryInternalPath, (input) => {
    // Copia del original para verificar la NO mutación (aserción 4).
    const inputCopy = input;

    const output = internalPathToDiskPath(input);

    // --- Aserción 2: longitud preservada. -----------------------------------
    if (output.length !== input.length) return false;

    // --- Aserción 1: sustitución 1:1 posición a posición. -------------------
    // Se indexa con guardas por `noUncheckedIndexedAccess`: `charAt` devuelve
    // siempre `string` (nunca `undefined`), evitando el `T | undefined` de
    // `input[i]`, y como ya validamos que las longitudes coinciden, ambos
    // índices son válidos.
    for (let i = 0; i < input.length; i += 1) {
      const inChar = input.charAt(i);
      const outChar = output.charAt(i);
      if (inChar === "/") {
        // Todo `/` de la entrada debe volverse `\` en la misma posición.
        if (outChar !== "\\") return false;
      } else {
        // Cualquier otro carácter (incluidos los `\` preexistentes) intacto.
        if (outChar !== inChar) return false;
      }
    }

    // --- Aserción 3: conteo. ------------------------------------------------
    // En la salida no queda ningún `/`...
    if (countChar(output, "/") !== 0) return false;
    // ...y el nº de `\` de la salida == (nº de `/` en input) + (nº de `\` en input).
    const expectedBackslashes =
      countChar(input, "/") + countChar(input, "\\");
    if (countChar(output, "\\") !== expectedBackslashes) return false;

    // --- Aserción 4: no mutación del input. ---------------------------------
    if (input !== inputCopy) return false;

    return true;
  }),
);
