import { test, expect } from "vitest";

import { ensureModsvsFirstInContent } from "../src/main/domain/index.js";

/**
 * BUG-010 — Unit tests CONCRETOS y DETERMINÍSTICOS del separador clave-valor.
 *
 * OBJETIVO: fijar como EJEMPLOS explícitos (no property) los casos de separador
 * que faltaban o que conviene anclar con inputs concretos, complementando:
 *  - `test/bug-010-exploratory.test.ts` (Caso A una/dos tabs, Caso B, sin `Game`),
 *  - `test/bug-010-preservation.test.ts` (idempotencia Caso C, preservación),
 *  - `test/bug-010-separator.property.test.ts` (property general de separadores).
 *
 * Aquí se cubren los ejemplos determinísticos que NO estaban:
 *  1. Separador de ESPACIOS MÚLTIPLES (tres espacios).
 *  2. Separador de TRES tabs (complementa el de dos tabs del exploratorio).
 *  3. Separador MEZCLA tab+espacio determinístico ("\t ").
 *  4. Caso B donde la modsvs preexistente tiene un separador DISTINTO al de la
 *     referencia: la resultante usa el de la REFERENCIA (DECISIÓN 1).
 *  5. Referencia = PRIMERA entrada `Game` aunque haya varias con separadores
 *     distintos (DECISIÓN 1, en orden de aparición).
 *
 * Bajo prueba: la función PURA `ensureModsvsFirstInContent(content)`.
 *
 * _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_
 */

/** EOL de los fixtures sintéticos (LF; irrelevante para el separador). */
const EOL = "\n";

/**
 * Construye un `gameinfo.txt` sintético con un bloque `SearchPaths` bien formado
 * (`SearchPaths` / `{` / entradas internas ya indentadas / `}`) a partir de las
 * líneas internas del bloque. Cada línea de `blockLines` ya se pasa con su
 * indentación líder propia, para controlar exactamente el separador de cada
 * entrada `Game`. Mismo helper de estilo que los tests exploratorio/preservación.
 */
function buildGameInfo(blockLines: string[]): string {
  return [
    '"GameInfo"',
    "{",
    "\tFileSystem",
    "\t{",
    "\t\tSearchPaths",
    "\t\t{",
    ...blockLines,
    "\t\t}",
    "\t}",
    "}",
    "",
  ].join(EOL);
}

/**
 * Extrae, con precisión, la indentación líder y el SEPARADOR clave-valor EXACTO de
 * la (primera) línea `Game modsvs` producida en `content`. Divide por `EOL`, ubica
 * la línea cuyo valor sea `modsvs` y captura la corrida `[ \t]+` entre `Game` y
 * `modsvs`. Distingue con precisión espacios de tabs (y mezclas). Mismo regex que
 * el extractor del exploratorio/preservación.
 *
 * Devuelve `{ indent, separator }` o `null` si no encuentra la línea modsvs.
 */
function extractModsvsSeparator(
  content: string,
): { indent: string; separator: string } | null {
  for (const line of content.split(EOL)) {
    const match = /^([ \t]*)Game([ \t]+)modsvs\s*$/i.exec(line);
    if (match) {
      return { indent: match[1] ?? "", separator: match[2] ?? "" };
    }
  }
  return null;
}

/** Cuenta cuántas líneas `Game modsvs` hay en `content`. */
function countModsvsLines(content: string): number {
  let count = 0;
  for (const line of content.split(EOL)) {
    if (/^[ \t]*game[ \t]+"?modsvs"?[ \t]*$/i.test(line)) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// 1. Separador de ESPACIOS MÚLTIPLES (tres espacios)
// ---------------------------------------------------------------------------

/**
 * (2.1/2.3) Caso A con separador de TRES espacios: la primera entrada `Game` usa
 * `Game   update` (tres espacios). Tras insertar, la línea `Game modsvs` debe
 * replicar EXACTAMENTE esos tres espacios, no colapsarlos a uno ni convertirlos a
 * tab. Ejemplo determinístico del caso "espacios" mencionado en el design.
 */
test("Caso A (tres espacios): la línea insertada replica los MISMOS 3 espacios", () => {
  const content = buildGameInfo([
    "\t\t\tGame   update", // primera entrada Game de referencia: 3 espacios
    "\t\t\tGame   left4dead2_dlc3",
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("inserted");
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // EXACTAMENTE tres espacios (no uno, no un tab).
  expect(found?.separator).toBe("   ");
});

// ---------------------------------------------------------------------------
// 2. Separador de TRES tabs
// ---------------------------------------------------------------------------

/**
 * (2.1/2.2) Caso A con TRES tabs: primera entrada `Game\t\t\tupdate`. La línea
 * `Game modsvs` debe replicar los MISMOS tres tabs exactos. Complementa el caso de
 * dos tabs del exploratorio con un ejemplo determinístico de tres.
 */
test("Caso A (tres tabs): la línea insertada replica los MISMOS 3 tabs", () => {
  const content = buildGameInfo([
    "\t\t\tGame\t\t\tupdate", // primera entrada Game de referencia: 3 tabs
    "\t\t\tGame\t\t\tleft4dead2_dlc3",
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("inserted");
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // EXACTAMENTE tres tabs.
  expect(found?.separator).toBe("\t\t\t");
});

// ---------------------------------------------------------------------------
// 3. Separador MEZCLA determinística tab+espacio ("\t ")
// ---------------------------------------------------------------------------

/**
 * (2.1/2.2/2.3) Caso A con MEZCLA tab+espacio: primera entrada `Game\t update`
 * (un tab seguido de un espacio). La línea `Game modsvs` debe replicar la corrida
 * COMPLETA "\t " exacta (DECISIÓN 2: se copia toda la secuencia `[ \t]+`, no un
 * único carácter). Ejemplo concreto de la mezcla, además del property test.
 */
test('Caso A (mezcla tab+espacio "\\t "): la línea insertada replica la corrida exacta', () => {
  const content = buildGameInfo([
    "\t\t\tGame\t update", // primera entrada Game de referencia: tab + espacio
    "\t\t\tGame\t left4dead2_dlc3",
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("inserted");
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // EXACTAMENTE "\t " (un tab y un espacio, en ese orden).
  expect(found?.separator).toBe("\t ");
});

// ---------------------------------------------------------------------------
// 4. Caso B (mover): la modsvs preexistente tenía un separador DISTINTO al de la
//    referencia -> la resultante usa el de la REFERENCIA (DECISIÓN 1).
// ---------------------------------------------------------------------------

/**
 * (2.1/2.2/3.2) Caso B — el separador se deriva de la REFERENCIA, NO se conserva el
 * de la modsvs vieja. La primera entrada `Game` de referencia usa DOS tabs
 * (`Game\t\tupdate`) y la modsvs preexistente (en posición no-primera) usa UN
 * ESPACIO (`Game modsvs`). Tras colapsar/mover a la primera posición, la línea
 * `Game modsvs` resultante debe usar el separador de la REFERENCIA (dos tabs), y
 * NO el espacio simple que traía la modsvs preexistente.
 *
 * Verifica explícitamente que el fix DERIVA el separador de la referencia y no
 * preserva el de la modsvs vieja.
 */
test("Caso B (mover): usa el separador de la REFERENCIA (dos tabs), no el de la modsvs vieja (espacio)", () => {
  const content = buildGameInfo([
    "\t\t\tGame\t\tupdate", // primera entrada Game de referencia: DOS tabs
    "\t\t\tGame modsvs", // modsvs no-primera con separador DISTINTO: un espacio
    "\t\t\tGame\t\tleft4dead2_dlc3",
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("moved");
  // Una sola modsvs tras colapsar.
  expect(countModsvsLines(result.content)).toBe(1);
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // Separador de la REFERENCIA (dos tabs), NO el espacio que tenía la modsvs vieja.
  expect(found?.separator).toBe("\t\t");
  expect(found?.separator).not.toBe(" ");
});

// ---------------------------------------------------------------------------
// 5. Referencia = PRIMERA entrada `Game` aunque haya varias con separadores
//    distintos (DECISIÓN 1: primera en orden de aparición).
// ---------------------------------------------------------------------------

/**
 * (2.1/2.2/3.1) DECISIÓN 1 — la referencia es la PRIMERA entrada `Game` del bloque
 * en orden de aparición, aunque haya otras con separadores distintos. Aquí la
 * primera es `Game\tupdate` (UN tab) y una segunda es `Game        dlc3` (varios
 * espacios). Tras insertar, la línea `Game modsvs` debe usar el separador de la
 * PRIMERA (un tab), confirmando que no se toma la segunda ni una mezcla.
 */
test("DECISIÓN 1 (Caso A): con separadores distintos, usa el de la PRIMERA entrada Game (un tab)", () => {
  const content = buildGameInfo([
    "\t\t\tGame\tupdate", // PRIMERA entrada Game: un tab (referencia)
    "\t\t\tGame        left4dead2_dlc3", // segunda entrada: varios espacios (NO se usa)
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("inserted");
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // Separador de la PRIMERA entrada (un tab), no el de la segunda (espacios).
  expect(found?.separator).toBe("\t");
});
