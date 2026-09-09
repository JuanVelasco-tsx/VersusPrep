import { test, expect } from "vitest";
import fc from "fast-check";

import { ensureModsvsFirstInContent } from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * Property test de GameInfoEditor: `Game modsvs` como primer y único SearchPath,
 * de forma idempotente (Tarea 13.2).
 *
 * Property 12: `Game modsvs` como primer y único SearchPath, de forma idempotente
 * **Validates: Requirements 6.10**
 *
 * Bajo prueba: la función PURA `ensureModsvsFirstInContent` (NO la clase
 * `GameInfoEditor`, que necesita FS y no es el foco de la propiedad). El caso de
 * `GameInfoEditError` (SearchPaths ausente/malformado) queda FUERA de esta
 * propiedad: el generador SIEMPRE produce un bloque SearchPaths bien formado (con
 * `{` y `}` balanceados), que es la precondición de la Property 12 en design.md.
 * Ese error tipado se cubre con los ejemplos manuales de la Tarea 13.1, no acá.
 *
 * ---------------------------------------------------------------------------
 * ESTRATEGIA DE GENERACIÓN
 *
 * Se genera un gameinfo.txt SINTÉTICO completo, con un ÚNICO bloque SearchPaths,
 * compuesto por (en este orden):
 *
 *   1. `prefix`: texto arbitrario ANTES del bloque (simula el resto de
 *      GameInfo/FileSystem). Se preserva BYTE A BYTE en el resultado: es la
 *      aserción más fuerte de "no tocar nada fuera del bloque".
 *   2. La apertura del bloque: una línea `SearchPaths` y una línea `{` (con una
 *      indentación fija menor, irrelevante para el test).
 *   3. El CONTENIDO del bloque: una secuencia de ENTRADAS `Game`, cada una
 *      escrita con un `indent` fijo y un `eol` fijo (ver abajo). Hay dos clases
 *      de entrada:
 *        - `other`: `Game <value>`, con `value` NO vacío y != "modsvs"
 *          (case-insensitive). Su ORDEN RELATIVO debe preservarse.
 *        - `modsvs`: una VARIANTE de forma de `Game modsvs` (distinto casing,
 *          espaciado o comillas) para ejercitar el matching case-insensitive y
 *          las comillas opcionales del código real.
 *      Las entradas `modsvs` se INTERCALAN en posiciones arbitrarias entre las
 *      `other`, construyendo manualmente la secuencia combinada (se generan
 *      posiciones de inserción en `[0, others.length]` para cada ocurrencia).
 *   4. La línea de cierre `}` (indentación fija).
 *   5. `suffix`: texto arbitrario DESPUÉS del `}` de cierre, mismo criterio de
 *      preservación byte a byte que `prefix`.
 *
 * `eol` es ÚNICO para todo el archivo (`\r\n` o `\n`), e `indent` es ÚNICO para
 * todas las líneas `Game`. Esto SIMPLIFICA el oráculo sin perder cobertura
 * relevante: la preservación de EOL por-línea y la indentación heterogénea entre
 * líneas `Game` ya están cubiertas por los ejemplos manuales de la Tarea 13.1; la
 * Property 12 (design.md) se centra en primera-y-única + orden + idempotencia.
 *
 * FILTRO de `prefix`/`suffix` (decisión del test, documentada): se excluyen de
 * ambos las llaves `{` y `}` y la subcadena `searchpaths` (case-insensitive). Se
 * permite TODO lo demás, incluidos saltos de línea y la palabra suelta `Game`. El
 * motivo es garantizar que el ÚNICO bloque SearchPaths y las ÚNICAS llaves del
 * archivo sean los que genera el test: así (i) `ensureModsvsFirstInContent` opera
 * sobre el bloque que el test conoce (no sobre uno espurio inyectado en el
 * prefix), y (ii) el oráculo puede ubicar el bloque por las líneas literales que
 * él mismo generó sin re-implementar el parser. Una `Game` suelta en el prefix NO
 * molesta: el prefix se preserva byte a byte y el oráculo solo inspecciona la
 * porción ENTRE la apertura y el cierre generados.
 * ---------------------------------------------------------------------------
 * ORÁCULO (independiente de la implementación: NO usa `locateSearchPaths` ni
 * `isGameLine` del módulo bajo prueba; usa splits/regex propios del test).
 *
 * Dado el `content` generado y `result = ensureModsvsFirstInContent(content)`:
 *
 *   (a) PRESERVACIÓN: `result.content` empieza EXACTAMENTE con el `prefix`
 *       generado y termina EXACTAMENTE con el `suffix` generado (startsWith /
 *       endsWith sobre las cadenas literales, no reconstruidas).
 *   (b) PRIMERA Y ÚNICA: de las líneas `Game` de la porción del bloque en el
 *       resultado, EXACTAMENTE UNA tiene valor "modsvs" (case-insensitive, con o
 *       sin comillas) y es la PRIMERA de esas líneas `Game`.
 *   (c) ORDEN PRESERVADO: las demás líneas `Game` (todas menos la primera
 *       modsvs), en orden, tienen como valores EXACTAMENTE `otherGameValues` en
 *       el MISMO ORDEN generado (comparación value por value).
 *   (d) CASO ESPERADO: derivado de los datos de GENERACIÓN (no del resultado):
 *         - modsvsCount === 0                       -> "inserted"
 *         - modsvsCount === 1 y quedó en posición 0 -> "unchanged"
 *           (y `changed === false` y `content` idéntico por igualdad de string)
 *         - resto (1 no-primera, o >= 2)            -> "moved"
 *   (e) IDEMPOTENCIA: `ensureModsvsFirstInContent(result.content)` devuelve
 *       `appliedCase === "unchanged"`, `changed === false` y un `content`
 *       EXACTAMENTE igual (igualdad de string) a `result.content`.
 *
 * Se usa el patrón de "return false" temprano (como vpk-batch.property.test.ts),
 * no aserciones de vitest dentro de `fc.property`.
 * ---------------------------------------------------------------------------
 */

/** EOL único del archivo generado (CRLF o LF). */
const eolArb: fc.Arbitrary<string> = fc.constantFrom("\r\n", "\n");

/** Indentación única de las líneas `Game` del bloque. */
const indentArb: fc.Arbitrary<string> = fc.constantFrom("\t", "\t\t", "    ", "\t\t\t\t");

/**
 * Valores de otras entradas `Game` (no-modsvs): no vacíos tras `trim` y distintos
 * de "modsvs" (case-insensitive). Sin comillas ni saltos de línea para que cada
 * uno ocupe una sola línea `Game <value>` inequívoca.
 */
const otherGameValueArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter(
    (v) =>
      v.trim().length > 0 &&
      v.trim().toLowerCase() !== "modsvs" &&
      // Sin saltos de línea, comillas, espacios ni LLAVES: cada valor debe ocupar
      // una única línea `Game <value>` inequívoca y no alterar el balance de `{}`
      // del bloque (un `Game {` abriría un nivel que nunca cierra -> malformed).
      !/[\r\n"{}]/.test(v) &&
      !v.includes(" "),
  );

/**
 * Variantes de forma de la entrada `Game modsvs`: distinto casing, espaciado y
 * comillas opcionales. TODAS deben ser reconocidas como la entrada modsvs por el
 * matching case-insensitive del código real.
 */
const modsvsVariantArb: fc.Arbitrary<string> = fc.constantFrom(
  "Game modsvs",
  "GAME MODSVS",
  "Game   modsvs",
  'Game "modsvs"',
  "game modsvs",
);

/**
 * Texto arbitrario de `prefix`/`suffix`: se excluyen `{`, `}` y la subcadena
 * `searchpaths` (case-insensitive) para garantizar un único bloque y llaves
 * únicas (ver FILTRO en la cabecera). Se permite el resto, incluidos saltos de
 * línea y la palabra suelta `Game`.
 */
const outsideTextArb: fc.Arbitrary<string> = fc
  .string({ minLength: 0, maxLength: 80 })
  .filter((s) => !/[{}]/.test(s) && !/searchpaths/i.test(s));

/** Una entrada del bloque: o bien un `other` (con su valor) o una `modsvs`. */
type BlockEntry =
  | { kind: "other"; value: string }
  | { kind: "modsvs"; variant: string };

/**
 * Escenario de generación. `insertPositions` da, para cada ocurrencia modsvs, la
 * posición de inserción en `[0, others.length]` dentro de la secuencia de
 * `others` (se aplican en orden, ver `buildEntries`).
 */
interface Scenario {
  prefix: string;
  suffix: string;
  eol: string;
  indent: string;
  otherGameValues: string[];
  modsvsVariants: string[];
  insertPositions: number[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    prefix: outsideTextArb,
    suffix: outsideTextArb,
    eol: eolArb,
    indent: indentArb,
    otherGameValues: fc.array(otherGameValueArb, { minLength: 0, maxLength: 5 }),
    // modsvsCount ∈ [0, 4] materializado como un array de variantes de esa long.
    modsvsVariants: fc.array(modsvsVariantArb, { minLength: 0, maxLength: 4 }),
  })
  .chain((base) =>
    // Una posición de inserción por cada ocurrencia modsvs, en [0, others.length].
    fc
      .array(fc.integer({ min: 0, max: base.otherGameValues.length }), {
        minLength: base.modsvsVariants.length,
        maxLength: base.modsvsVariants.length,
      })
      .map((insertPositions) => ({ ...base, insertPositions })),
  );

/**
 * Combina `otherGameValues` y las variantes modsvs en UNA secuencia de entradas,
 * insertando cada ocurrencia modsvs en la posición indicada por `insertPositions`
 * (aplicadas EN ORDEN sobre la lista que va creciendo). Devuelve la secuencia
 * combinada; su orden es el que se escribirá en el bloque.
 */
function buildEntries(scenario: Scenario): BlockEntry[] {
  const entries: BlockEntry[] = scenario.otherGameValues.map((value) => ({
    kind: "other" as const,
    value,
  }));
  scenario.modsvsVariants.forEach((variant, i) => {
    const pos = scenario.insertPositions[i] ?? entries.length;
    // La posición se generó en [0, otherGameValues.length]; se acota por
    // seguridad al tamaño ACTUAL (que puede haber crecido por inserciones
    // previas) para que el splice sea siempre válido.
    const clamped = Math.min(Math.max(pos, 0), entries.length);
    entries.splice(clamped, 0, { kind: "modsvs", variant });
  });
  return entries;
}

/** Caso esperado derivado de los DATOS DE GENERACIÓN (no del resultado). */
function expectedCase(entries: BlockEntry[]): "inserted" | "moved" | "unchanged" {
  const modsvsCount = entries.filter((e) => e.kind === "modsvs").length;
  if (modsvsCount === 0) return "inserted";
  const firstIsModsvs = entries[0]?.kind === "modsvs";
  if (modsvsCount === 1 && firstIsModsvs) return "unchanged";
  return "moved";
}

/** Ensambla el gameinfo.txt sintético completo a partir del escenario. */
function buildContent(scenario: Scenario, entries: BlockEntry[]): string {
  const { prefix, suffix, eol, indent } = scenario;
  // La línea `SearchPaths` DEBE empezar al inicio de una línea. Si el `prefix`
  // no está vacío y no termina ya en un salto de línea, se antepone un `eol`
  // (parte de la construcción, NO del prefix: `result.content` sigue empezando
  // exactamente con el prefix, así que la aserción (a) se mantiene). Sin esto, un
  // prefix como "!" pegaría "!SearchPaths" y el bloque no sería localizable.
  const needsLeadingEol = prefix.length > 0 && !prefix.endsWith("\n");
  const opening = `${needsLeadingEol ? eol : ""}SearchPaths${eol}{${eol}`;
  let block = opening;
  for (const entry of entries) {
    if (entry.kind === "other") {
      block += `${indent}Game ${entry.value}${eol}`;
    } else {
      block += `${indent}${entry.variant}${eol}`;
    }
  }
  block += `}${eol}`;
  return `${prefix}${block}${suffix}`;
}

/** Valor (minúsculas, sin comillas) de una línea `Game <value>` del resultado. */
function gameLineValue(line: string): string | null {
  const match = /^[ \t]*game\s+"?([^"\r\n]+?)"?\s*$/i.exec(line);
  if (!match) return null;
  return (match[1] ?? "").trim().toLowerCase();
}

/**
 * Extrae, del `content` del resultado, la lista ordenada de VALORES de las líneas
 * `Game` que están DENTRO del bloque SearchPaths. El bloque se ubica por las
 * líneas literales `SearchPaths` / `{` / `}` que el test generó (sin re-usar el
 * parser del módulo). Como prefix/suffix no contienen llaves ni `searchpaths`, la
 * primera `SearchPaths` y su `{`...`}` balanceado son inequívocos.
 */
function extractGameValuesInBlock(content: string, eol: string): string[] {
  const lines = content.split(eol);
  const spIndex = lines.findIndex((l) => l.trim().toLowerCase() === "searchpaths");
  if (spIndex === -1) return [];
  // La `{` de apertura es la primera línea `{` tras SearchPaths.
  let openIndex = -1;
  for (let i = spIndex + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "{") { openIndex = i; break; }
    if ((lines[i] ?? "").trim().length > 0) break;
  }
  if (openIndex === -1) return [];
  // El cierre es la primera línea `}` tras la apertura (el bloque no anida).
  let closeIndex = -1;
  for (let i = openIndex + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "}") { closeIndex = i; break; }
  }
  if (closeIndex === -1) return [];
  const values: string[] = [];
  for (let i = openIndex + 1; i < closeIndex; i++) {
    const v = gameLineValue(lines[i] ?? "");
    if (v !== null) values.push(v);
  }
  return values;
}

propertyTest(
  12,
  "`Game modsvs` como primer y único SearchPath, de forma idempotente",
  fc.property(scenarioArb, (scenario) => {
    const entries = buildEntries(scenario);
    const content = buildContent(scenario, entries);
    const result = ensureModsvsFirstInContent(content);

    // (a) PRESERVACIÓN de prefix/suffix byte a byte.
    if (!result.content.startsWith(scenario.prefix)) return false;
    if (!result.content.endsWith(scenario.suffix)) return false;

    // (b) PRIMERA Y ÚNICA entrada modsvs dentro del bloque del RESULTADO.
    const values = extractGameValuesInBlock(result.content, scenario.eol);
    const modsvsPositions = values
      .map((v, i) => (v === "modsvs" ? i : -1))
      .filter((i) => i !== -1);
    if (modsvsPositions.length !== 1) return false;
    if (modsvsPositions[0] !== 0) return false;

    // (c) ORDEN PRESERVADO del resto de entradas Game (== otherGameValues).
    const rest = values.slice(1);
    const expectedRest = scenario.otherGameValues.map((v) => v.toLowerCase());
    if (rest.length !== expectedRest.length) return false;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] !== expectedRest[i]) return false;
    }

    // (d) CASO ESPERADO derivado de la generación (no del resultado).
    const expected = expectedCase(entries);
    if (result.appliedCase !== expected) return false;
    if (expected === "unchanged") {
      // Caso C: no cambia nada y el contenido es idéntico (igualdad de string).
      if (result.changed !== false) return false;
      if (result.content !== content) return false;
    } else {
      if (result.changed !== true) return false;
    }

    // (e) IDEMPOTENCIA: una segunda aplicación no cambia nada.
    const second = ensureModsvsFirstInContent(result.content);
    if (second.appliedCase !== "unchanged") return false;
    if (second.changed !== false) return false;
    if (second.content !== result.content) return false;

    return true;
  }),
);

/**
 * NO-VACUIDAD (blindaje contra falsos verdes en la aserción (d) de la Property
 * 12): confirma que el generador `scenarioArb` produce EFECTIVAMENTE los tres
 * casos —`inserted`, `moved` y `unchanged`— y no colapsa silenciosamente a uno
 * solo (lo que haría la comprobación del caso esperado vacuamente cierta). Se
 * muestrea el generador de forma determinista con `fc.sample` y se cuenta el
 * `appliedCase` real de cada muestra; el test exige que los tres aparezcan al
 * menos una vez. Sigue el criterio de no-vacuidad ya aplicado en las Property 2 y
 * Property 5 del proyecto (ver Context/04-historial-decisiones.md).
 */
test("Property 12 (no-vacuidad): el generador cubre inserted, moved y unchanged", () => {
  const samples = fc.sample(scenarioArb, { numRuns: 500, seed: 42 });
  const seen = new Set<string>();
  for (const scenario of samples) {
    const entries = buildEntries(scenario);
    const content = buildContent(scenario, entries);
    seen.add(ensureModsvsFirstInContent(content).appliedCase);
  }
  expect(seen.has("inserted")).toBe(true);
  expect(seen.has("moved")).toBe(true);
  expect(seen.has("unchanged")).toBe(true);
});
