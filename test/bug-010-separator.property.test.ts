import { test, expect } from "vitest";
import fc from "fast-check";

import { ensureModsvsFirstInContent } from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * BUG-010 — Property test del FIX (Property 1, fase fix-check).
 *
 * OBJETIVO (Property 1, Fix Checking del design): para CUALQUIER bloque
 * `SearchPaths` cuya PRIMERA entrada `Game <x>` use un separador clave-valor `S`
 * (corrida arbitraria de 1..N caracteres de `[ \t]`, mezclando tabs y espacios),
 * tras INSERTAR (Caso A) o MOVER/COLAPSAR (Caso B) la línea `Game modsvs`, la
 * línea producida es EXACTAMENTE `<indent>Game` + `S` + `modsvs`, replicando la
 * indentación líder y el EOL de referencia. Además: IDEMPOTENCIA — aplicar
 * `ensureModsvsFirstInContent` dos veces == una (la segunda devuelve
 * `appliedCase === "unchanged"`, `changed === false`, `content` idéntico), aunque
 * el separador existente NO sea el canónico.
 *
 * Bajo prueba: la función PURA `ensureModsvsFirstInContent(content)` (misma que
 * `test/game-info-editor.property.test.ts` y `test/bug-010-preservation.test.ts`),
 * NO la clase `GameInfoEditor`.
 *
 * DECISIÓN 1 (design): el separador se deriva de la MISMA primera línea `Game` de
 * referencia (la primera en orden de aparición). DECISIÓN 2: el separador es la
 * corrida COMPLETA de whitespace `[ \t]+`, así que la línea insertada replica la
 * MEZCLA exacta de tabs/espacios (p. ej. `"\t \t"`), no un único carácter.
 *
 * _Requirements: 2.1, 2.2, 2.3_
 */

// ---------------------------------------------------------------------------
// Helpers de fixtures y extracción (estilo bug-010-preservation.test.ts)
// ---------------------------------------------------------------------------

/**
 * Construye un `gameinfo.txt` sintético con un bloque `SearchPaths` bien formado
 * (`SearchPaths` / `{` / entradas internas ya indentadas / `}`) a partir de las
 * líneas internas del bloque. El EOL es configurable (CRLF o LF). Cada línea de
 * `blockLines` ya incluye su indentación líder propia.
 */
function buildGameInfo(blockLines: string[], eol: string): string {
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
  ].join(eol);
}

/**
 * Localiza la (primera) línea `Game modsvs` (case-insensitive, con o sin comillas)
 * dentro de `content`, dividiendo por `eol`. Devuelve la línea completa (con su
 * indentación líder) o `null`.
 */
function findModsvsLine(content: string, eol: string): string | null {
  for (const line of content.split(eol)) {
    if (/^[ \t]*game[ \t]+"?modsvs"?[ \t]*$/i.test(line)) return line;
  }
  return null;
}

/** Cuenta cuántas líneas `Game modsvs` hay en `content`. */
function countModsvsLines(content: string, eol: string): number {
  let count = 0;
  for (const line of content.split(eol)) {
    if (/^[ \t]*game[ \t]+"?modsvs"?[ \t]*$/i.test(line)) count += 1;
  }
  return count;
}

/** Indentación líder (corrida de espacios/tabs iniciales) de una línea. */
function leadingIndent(line: string): string {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : "";
}

/**
 * Extrae el separador clave-valor (la corrida COMPLETA `[ \t]+` entre `Game` y el
 * valor) de una línea `Game <valor>`. Réplica local del criterio de DECISIÓN 2
 * (mismo regex que `extractSeparator` del código bajo prueba), para poder
 * comparar tabs vs espacios con precisión. Devuelve `null` si no matchea.
 */
function separatorOf(line: string): string | null {
  const match = /^[ \t]*game([ \t]+)\S/i.exec(line);
  return match ? (match[1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Separador de REFERENCIA `S`: corrida de 1..6 caracteres de `[ \t]` (tabs y
 * espacios), unida. Mezcla tabs y espacios (p. ej. `"\t \t"`), no solo tabs
 * puros, para ejercitar la captura de la corrida completa (DECISIÓN 2).
 */
const separatorArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom("\t", " "), { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(""));

/** Indentación líder de las líneas `Game` del bloque. */
const indentArb: fc.Arbitrary<string> = fc.constantFrom(
  "\t\t\t",
  "\t\t",
  "    ",
  "\t\t\t\t",
);

/** EOL del archivo (CRLF o LF). */
const eolArb: fc.Arbitrary<string> = fc.constantFrom("\r\n", "\n");

/**
 * Valores de otras entradas `Game` (no-modsvs): no vacíos, sin whitespace,
 * comillas ni llaves, y distintos de "modsvs" (case-insensitive). Así cada uno
 * ocupa una única línea `Game <value>` inequívoca.
 */
const otherValueArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter(
    (v) =>
      v.trim().length > 0 &&
      v.trim().toLowerCase() !== "modsvs" &&
      !/[\r\n"{}\t ]/.test(v),
  );

/**
 * Escenario del fix-check. La PRIMERA entrada `Game` del bloque SIEMPRE es una
 * entrada no-modsvs de referencia con el separador `S` generado. `hasModsvsElsewhere`
 * distingue el Caso A (insertar) del Caso B (mover):
 *  - false -> Caso A: sin `modsvs` en el bloque; se INSERTA.
 *  - true  -> Caso B: hay una `modsvs` en posición NO-primera (con separador
 *    propio arbitrario); se MUEVE/COLAPSA a la primera posición con separador `S`.
 * `noiseValues` son 0..3 entradas `Game` adicionales DESPUÉS de la referencia,
 * con separadores arbitrarios propios: ruido válido que NO afecta la referencia
 * (la referencia es SIEMPRE la primera `Game`).
 */
interface Scenario {
  separator: string; // S de referencia (primera Game)
  indent: string;
  eol: string;
  referenceValue: string; // valor no-modsvs de la primera Game
  hasModsvsElsewhere: boolean; // false -> Caso A ; true -> Caso B
  modsvsSeparator: string; // separador de la modsvs preexistente (Caso B)
  noiseValues: string[]; // otras Game (ruido) DESPUÉS de la referencia
  noiseSeparators: string[]; // separador de cada entrada de ruido
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    separator: separatorArb,
    indent: indentArb,
    eol: eolArb,
    referenceValue: otherValueArb,
    hasModsvsElsewhere: fc.boolean(),
    modsvsSeparator: separatorArb,
    noiseValues: fc.array(otherValueArb, { minLength: 0, maxLength: 3 }),
  })
  .chain((base) =>
    fc
      .array(separatorArb, {
        minLength: base.noiseValues.length,
        maxLength: base.noiseValues.length,
      })
      .map((noiseSeparators) => ({ ...base, noiseSeparators })),
  );

/**
 * Ensambla las líneas internas del bloque a partir del escenario. La PRIMERA línea
 * es siempre la referencia (`Game` + `S` + referenceValue). Luego, en el Caso B,
 * se intercala una `modsvs` NO-primera (con su propio separador) seguida del ruido;
 * en el Caso A solo va el ruido. En ambos casos la referencia queda primera y, si
 * no es un `unchanged`, el resultado será `inserted` (A) o `moved` (B).
 */
function buildBlockLines(scenario: Scenario): string[] {
  const {
    indent,
    separator,
    referenceValue,
    hasModsvsElsewhere,
    modsvsSeparator,
    noiseValues,
    noiseSeparators,
  } = scenario;
  const lines: string[] = [
    // PRIMERA entrada Game de referencia con el separador S.
    `${indent}Game${separator}${referenceValue}`,
  ];
  if (hasModsvsElsewhere) {
    // modsvs en posición NO-primera (Caso B: mover/colapsar).
    lines.push(`${indent}Game${modsvsSeparator}modsvs`);
  }
  noiseValues.forEach((value, i) => {
    const sep = noiseSeparators[i] ?? "\t";
    lines.push(`${indent}Game${sep}${value}`);
  });
  return lines;
}

// ---------------------------------------------------------------------------
// Property 1 (fix-check): la línea `Game modsvs` replica el separador S
// ---------------------------------------------------------------------------

propertyTest(
  1,
  "BUG-010 fix: `Game modsvs` insertado/movido replica el separador de la primera entrada Game de referencia",
  fc.property(scenarioArb, (scenario) => {
    const { separator, indent, eol, hasModsvsElsewhere } = scenario;
    const content = buildGameInfo(buildBlockLines(scenario), eol);

    const result = ensureModsvsFirstInContent(content);

    // (1) Caso aplicado: "inserted" (Caso A) o "moved" (Caso B), según corresponda.
    const expectedCase = hasModsvsElsewhere ? "moved" : "inserted";
    if (result.appliedCase !== expectedCase) return false;
    if (result.changed !== true) return false;

    // Exactamente una línea `Game modsvs` en el resultado.
    if (countModsvsLines(result.content, eol) !== 1) return false;

    const modsvsLine = findModsvsLine(result.content, eol);
    if (modsvsLine === null) return false;

    // (2) El separador de la línea modsvs es EXACTAMENTE `S` (tabs y espacios).
    if (separatorOf(modsvsLine) !== separator) return false;

    // (3) Indentación líder == indent de referencia.
    if (leadingIndent(modsvsLine) !== indent) return false;

    // (3, EOL) El EOL del archivo se respeta: no hay LF suelto si es CRLF, y la
    // línea modsvs queda delimitada por el EOL de referencia.
    if (eol === "\r\n" && /[^\r]\n/.test(result.content)) return false;
    if (!result.content.includes(`${eol}${modsvsLine}${eol}`)) return false;

    // (4) IDEMPOTENCIA: aplicar de nuevo == no-op (Caso C), content idéntico.
    const second = ensureModsvsFirstInContent(result.content);
    if (second.appliedCase !== "unchanged") return false;
    if (second.changed !== false) return false;
    if (second.content !== result.content) return false;

    return true;
  }),
);

// ---------------------------------------------------------------------------
// No-vacuidad: el generador cubre EFECTIVAMENTE "inserted" y "moved"
// ---------------------------------------------------------------------------

/**
 * Blindaje contra falsos verdes (mismo criterio que la Property 12 existente): se
 * muestrea `scenarioArb` de forma determinista y se confirma que produce tanto
 * Casos `inserted` (A) como `moved` (B). Sin esto, la aserción del caso esperado
 * podría ser vacuamente cierta si el generador colapsara a un solo caso.
 */
test("Property 1 (no-vacuidad): el generador cubre inserted y moved", () => {
  const samples = fc.sample(scenarioArb, { numRuns: 500, seed: 42 });
  const seen = new Set<string>();
  for (const scenario of samples) {
    const content = buildGameInfo(buildBlockLines(scenario), scenario.eol);
    seen.add(ensureModsvsFirstInContent(content).appliedCase);
  }
  expect(seen.has("inserted")).toBe(true);
  expect(seen.has("moved")).toBe(true);
});
