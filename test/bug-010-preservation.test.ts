import { test, expect } from "vitest";
import fc from "fast-check";

import {
  ensureModsvsFirstInContent,
  GameInfoEditError,
} from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * BUG-010 — Tests de PRESERVACIÓN (Property 2, fase observación-primero).
 *
 * OBJETIVO (metodología bug condition): capturar el BASELINE del comportamiento
 * existente que el fix NO debe romper. Estos tests DEBEN PASAR sobre el código
 * ACTUAL SIN FIX y seguir pasando tras el fix.
 *
 * CLAVE: NO se asevera el separador clave-valor de la línea `Game modsvs` (ni tab
 * ni espacio) en NINGUNO de estos tests — ese separador es JUSTO lo que el fix
 * cambia (de espacio simple a la corrida de la entrada `Game` de referencia). Los
 * asertos se enfocan en lo que NO cambia: idempotencia del Caso C carácter por
 * carácter, primera-y-única sin duplicar, orden relativo preservado, prefijo/
 * sufijo intactos, indentación líder + EOL replicados, y el `GameInfoEditError`
 * tipado sin bloque SearchPaths.
 *
 * Bajo prueba: la función PURA `ensureModsvsFirstInContent(content)` (misma que
 * `test/game-info-editor.property.test.ts` y `test/bug-010-exploratory.test.ts`),
 * NO la clase `GameInfoEditor`.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
 */

/** EOL por defecto de los fixtures sintéticos (LF). */
const LF = "\n";

/**
 * Construye un `gameinfo.txt` sintético con un bloque `SearchPaths` bien formado
 * (`SearchPaths` / `{` / entradas internas ya indentadas / `}`) a partir de las
 * líneas internas del bloque. El EOL es configurable para cubrir CRLF y LF.
 *
 * Cada línea de `blockLines` ya se pasa con su indentación líder propia (así el
 * test controla exactamente qué indentación tiene cada entrada `Game`).
 */
function buildGameInfo(blockLines: string[], eol: string = LF): string {
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
 * Localiza la (primera) línea cuyo valor sea `modsvs` (case-insensitive, con o
 * sin comillas) dentro de `content`, dividiendo por `eol`. Devuelve la línea
 * completa (con su indentación líder) o `null`.
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

/**
 * Extrae, en orden, los VALORES (minúsculas, sin comillas) de las líneas `Game`
 * dentro del bloque SearchPaths de `content`. El bloque se ubica por las líneas
 * literales `SearchPaths` / `{` / `}` que `buildGameInfo` genera.
 */
function gameValuesInBlock(content: string, eol: string): string[] {
  const lines = content.split(eol);
  const spIndex = lines.findIndex((l) => l.trim().toLowerCase() === "searchpaths");
  if (spIndex === -1) return [];
  let openIndex = -1;
  for (let i = spIndex + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "{") { openIndex = i; break; }
    if ((lines[i] ?? "").trim().length > 0) break;
  }
  if (openIndex === -1) return [];
  let closeIndex = -1;
  for (let i = openIndex + 1; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === "}") { closeIndex = i; break; }
  }
  if (closeIndex === -1) return [];
  const values: string[] = [];
  for (let i = openIndex + 1; i < closeIndex; i++) {
    const match = /^[ \t]*game[ \t]+"?([^"\r\n]+?)"?[ \t]*$/i.exec(lines[i] ?? "");
    if (match) values.push((match[1] ?? "").trim().toLowerCase());
  }
  return values;
}

/** Indentación líder (corrida de espacios/tabs iniciales) de una línea. */
function leadingIndent(line: string): string {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : "";
}

// ---------------------------------------------------------------------------
// 3.3 — Idempotencia del Caso C (CORAZÓN de la preservación)
// ---------------------------------------------------------------------------

/**
 * (3.3) Caso C con separador NO canónico (dos tabs): `Game modsvs` YA es la
 * primera y única entrada `modsvs` del bloque. El resultado DEBE ser idempotente:
 * `appliedCase === "unchanged"`, `changed === false` y el `content` IDÉNTICO
 * carácter por carácter — el Caso C NO reescribe el separador, sea cual sea.
 *
 * Este es el corazón de la preservación: pasa HOY (sin fix) y debe seguir pasando
 * tras el fix (que tampoco normaliza el separador en el Caso C).
 */
test("(3.3) Caso C idempotente con dos tabs: unchanged, no reescribe (content idéntico)", () => {
  const content = buildGameInfo([
    "\t\t\tGame\t\tmodsvs", // primera y única modsvs, separador NO canónico (dos tabs)
    "\t\t\tGame\t\tupdate",
    "\t\t\tGame\t\tleft4dead2_dlc3",
  ]);

  const result = ensureModsvsFirstInContent(content, "modsvs");

  expect(result.appliedCase).toBe("unchanged");
  expect(result.changed).toBe(false);
  // Preservación carácter por carácter: content IDÉNTICO al de entrada.
  expect(result.content).toBe(content);
});

/**
 * (3.3) Caso C con separador NO canónico (un espacio): mismo baseline pero con la
 * modsvs existente usando un espacio simple como separador. Sigue siendo Caso C
 * idempotente: NO se reescribe, aunque el separador difiera del que usaría un
 * Caso A/B. Confirma que el Caso C es un no-op sea cual sea el separador previo.
 */
test("(3.3) Caso C idempotente con un espacio: unchanged, content idéntico", () => {
  const content = buildGameInfo([
    "\t\t\tGame modsvs", // primera y única modsvs, separador espacio simple
    "\t\t\tGame\t\tupdate",
  ]);

  const result = ensureModsvsFirstInContent(content, "modsvs");

  expect(result.appliedCase).toBe("unchanged");
  expect(result.changed).toBe(false);
  expect(result.content).toBe(content);
});

// ---------------------------------------------------------------------------
// 3.1 — Caso A: insertar sin duplicar
// ---------------------------------------------------------------------------

/**
 * (3.1) Caso A insertar sin duplicar: bloque sin `modsvs`. Tras la operación hay
 * EXACTAMENTE una entrada `modsvs` y es la PRIMERA entrada `Game` del bloque. NO
 * se asevera el separador (eso lo cambia el fix).
 */
test("(3.1) Caso A: inserta una única modsvs como primera entrada, sin duplicar", () => {
  const content = buildGameInfo([
    "\t\t\tGame\tupdate",
    "\t\t\tGame\tleft4dead2_dlc3",
  ]);

  const result = ensureModsvsFirstInContent(content, "modsvs");

  expect(result.appliedCase).toBe("inserted");
  expect(result.changed).toBe(true);
  // Exactamente una entrada modsvs.
  expect(countModsvsLines(result.content, LF)).toBe(1);
  // Y es la PRIMERA entrada Game del bloque.
  const values = gameValuesInBlock(result.content, LF);
  expect(values[0]).toBe("modsvs");
  // El resto conserva las otras entradas Game.
  expect(values.slice(1)).toEqual(["update", "left4dead2_dlc3"]);
});

// ---------------------------------------------------------------------------
// 3.2 — Caso B: mover/colapsar sin duplicar + orden preservado
// ---------------------------------------------------------------------------

/**
 * (3.2) Caso B mover/colapsar sin duplicar + orden preservado: `modsvs` aparece en
 * posición no-primera y además DUPLICADA. Tras la operación queda una sola modsvs
 * primera, y el orden relativo de las OTRAS entradas `Game` se preserva. NO se
 * asevera el separador.
 */
test("(3.2) Caso B: colapsa duplicadas a una única modsvs primera, orden del resto preservado", () => {
  const content = buildGameInfo([
    "\t\t\tGame\tupdate", // primera Game de referencia (no-modsvs)
    "\t\t\tGame\tmodsvs", // modsvs no-primera
    "\t\t\tGame\tleft4dead2_dlc3",
    "\t\t\tGame\tmodsvs", // modsvs duplicada
  ]);

  const result = ensureModsvsFirstInContent(content, "modsvs");

  expect(result.appliedCase).toBe("moved");
  expect(result.changed).toBe(true);
  // Una sola modsvs.
  expect(countModsvsLines(result.content, LF)).toBe(1);
  const values = gameValuesInBlock(result.content, LF);
  // modsvs primera.
  expect(values[0]).toBe("modsvs");
  // Orden relativo del resto preservado.
  expect(values.slice(1)).toEqual(["update", "left4dead2_dlc3"]);
});

// ---------------------------------------------------------------------------
// 3.4 — Preservación carácter por carácter del resto del archivo
// ---------------------------------------------------------------------------

/**
 * (3.4) Preservación carácter por carácter del resto: el prefijo (comentarios,
 * otras claves) ANTES del bloque y el sufijo DESPUÉS quedan intactos tras un Caso
 * A. Se verifica con startsWith/endsWith sobre literales.
 */
test("(3.4) Caso A: preserva prefijo y sufijo del archivo carácter por carácter", () => {
  const prefix = [
    "// comentario de cabecera",
    '"GameInfo"',
    "{",
    "\tgame\t\tLeft 4 Dead 2", // otra clave con espaciado propio que NO debe cambiar
    "\tFileSystem",
    "\t{",
    "\t\tSearchPaths",
    "\t\t{",
    "",
  ].join(LF);
  const suffix = [
    "",
    "\t\t}",
    "\t}",
    "\t// comentario de cierre",
    "}",
    "",
  ].join(LF);
  const content = `${prefix}\t\t\tGame\tupdate${LF}${suffix}`;

  const result = ensureModsvsFirstInContent(content, "modsvs");

  expect(result.appliedCase).toBe("inserted");
  // Prefijo intacto carácter por carácter.
  expect(result.content.startsWith(prefix)).toBe(true);
  // Sufijo intacto carácter por carácter.
  expect(result.content.endsWith(suffix)).toBe(true);
});

// ---------------------------------------------------------------------------
// 3.5 — Indentación líder y EOL replicados (SIN fijar el separador clave-valor)
// ---------------------------------------------------------------------------

/**
 * (3.5) Indentación líder: la línea `Game modsvs` insertada replica la indentación
 * LÍDER de las otras líneas `Game` del bloque. Se asevera SOLO la indentación
 * líder, no el separador clave-valor (que cambia con el fix).
 */
test("(3.5) Caso A: la línea insertada replica la indentación líder de referencia", () => {
  const referenceIndent = "\t\t\t";
  const content = buildGameInfo([
    `${referenceIndent}Game\tupdate`,
    `${referenceIndent}Game\tleft4dead2_dlc3`,
  ]);

  const result = ensureModsvsFirstInContent(content, "modsvs");

  expect(result.appliedCase).toBe("inserted");
  const modsvsLine = findModsvsLine(result.content, LF);
  expect(modsvsLine).not.toBeNull();
  // Solo la indentación líder (no el separador clave-valor).
  expect(leadingIndent(modsvsLine ?? "")).toBe(referenceIndent);
});

/**
 * (3.5) EOL CRLF: con un archivo de EOL CRLF, la línea `Game modsvs` insertada se
 * integra respetando el EOL del archivo (el bloque completo del resultado sigue
 * usando CRLF y no aparece ningún LF suelto). Se verifica el EOL (CRLF) sin fijar
 * el separador clave-valor.
 */
test("(3.5) Caso A: respeta el EOL CRLF de referencia al insertar", () => {
  const CRLF = "\r\n";
  const content = buildGameInfo([
    "\t\t\tGame\tupdate",
    "\t\t\tGame\tleft4dead2_dlc3",
  ], CRLF);

  const result = ensureModsvsFirstInContent(content, "modsvs");

  expect(result.appliedCase).toBe("inserted");
  // Se insertó una modsvs.
  expect(countModsvsLines(result.content, CRLF)).toBe(1);
  // No hay ningún LF que no forme parte de un CRLF (EOL uniforme CRLF preservado).
  expect(/[^\r]\n/.test(result.content)).toBe(false);
  // Y la línea modsvs se ubica con el mismo EOL: aparece delimitada por CRLF.
  expect(result.content.includes(`${CRLF}\t\t\tGame`)).toBe(true);
});

// ---------------------------------------------------------------------------
// 3.6 — GameInfoEditError sin bloque SearchPaths localizable
// ---------------------------------------------------------------------------

/**
 * (3.6) `GameInfoEditError` `missing-search-paths`: un gameinfo.txt SIN clave
 * `SearchPaths` hace que `ensureModsvsFirstInContent` LANCE `GameInfoEditError`
 * con `reason === "missing-search-paths"`, sin crear el bloque.
 */
test("(3.6) Sin bloque SearchPaths: lanza GameInfoEditError con reason missing-search-paths", () => {
  const content = [
    '"GameInfo"',
    "{",
    "\tFileSystem",
    "\t{",
    "\t\t// no hay clave SearchPaths en ningún lado",
    "\t}",
    "}",
    "",
  ].join(LF);

  expect(() => ensureModsvsFirstInContent(content, "modsvs")).toThrow(GameInfoEditError);

  let capturedReason: string | undefined;
  try {
    ensureModsvsFirstInContent(content, "modsvs");
  } catch (err) {
    if (err instanceof GameInfoEditError) capturedReason = err.reason;
  }
  expect(capturedReason).toBe("missing-search-paths");
});

/**
 * (3.6) `GameInfoEditError` `malformed`: un bloque `SearchPaths` cuya clave existe
 * pero abre `{` sin cerrar `}` -> `reason === "malformed"`, sin crear/reparar el
 * bloque.
 */
test("(3.6) SearchPaths que abre pero no cierra: lanza GameInfoEditError con reason malformed", () => {
  const content = [
    '"GameInfo"',
    "{",
    "\tFileSystem",
    "\t{",
    "\t\tSearchPaths",
    "\t\t{",
    "\t\t\tGame\tupdate",
    // falta el `}` de cierre del bloque SearchPaths
    "",
  ].join(LF);

  let capturedReason: string | undefined;
  try {
    ensureModsvsFirstInContent(content, "modsvs");
  } catch (err) {
    if (err instanceof GameInfoEditError) capturedReason = err.reason;
  }
  expect(capturedReason).toBe("malformed");
});

// ---------------------------------------------------------------------------
// PBT de preservación — idempotencia del Caso C (sin fijar el separador)
// ---------------------------------------------------------------------------

/**
 * (3.3, PBT) Idempotencia del Caso C sobre inputs arbitrarios: para CUALQUIER
 * separador `Game modsvs` (corrida arbitraria de tabs/espacios) que ya sea la
 * primera y única entrada `modsvs`, `ensureModsvsFirstInContent` devuelve
 * `unchanged`, `changed === false` y `content` IDÉNTICO carácter por carácter. NO
 * se asevera el valor del separador (lo genera libremente); se asevera que NO se
 * reescribe, que es lo que el fix debe preservar.
 *
 * **Validates: Requirements 3.3**
 */

/** Corrida arbitraria de 1..6 caracteres de whitespace (tabs/espacios). */
const separatorArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom("\t", " "), { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(""));

/** Indentación líder arbitraria de las líneas `Game` del bloque. */
const indentArb: fc.Arbitrary<string> = fc.constantFrom(
  "\t\t\t",
  "\t\t",
  "    ",
  "\t\t\t\t",
);

/** EOL arbitrario del archivo (CRLF o LF). */
const eolArb: fc.Arbitrary<string> = fc.constantFrom("\r\n", "\n");

/**
 * Valores de otras entradas `Game` (no-modsvs): no vacíos, sin whitespace,
 * comillas ni llaves, y distintos de "modsvs".
 */
const otherValueArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 10 })
  .filter(
    (v) =>
      v.trim().length > 0 &&
      v.trim().toLowerCase() !== "modsvs" &&
      !/[\r\n"{}\t ]/.test(v),
  );

const caseCScenarioArb = fc.record({
  modsvsSeparator: separatorArb,
  indent: indentArb,
  eol: eolArb,
  // Otras entradas Game que van DESPUÉS de la modsvs primera (0..4).
  otherValues: fc.array(otherValueArb, { minLength: 0, maxLength: 4 }),
  // Separador de las otras entradas Game (puede diferir del de la modsvs).
  otherSeparator: separatorArb,
});

propertyTest(
  2,
  "BUG-010 preservación: Caso C idempotente no reescribe (content idéntico)",
  fc.property(caseCScenarioArb, (scenario) => {
    const { modsvsSeparator, indent, eol, otherValues, otherSeparator } = scenario;
    // `Game modsvs` como PRIMERA y única entrada modsvs, con separador arbitrario.
    const blockLines = [
      `${indent}Game${modsvsSeparator}modsvs`,
      ...otherValues.map((v) => `${indent}Game${otherSeparator}${v}`),
    ];
    const content = buildGameInfo(blockLines, eol);

    const result = ensureModsvsFirstInContent(content, "modsvs");

    // Caso C idempotente: no cambia y el content es idéntico carácter por carácter.
    if (result.appliedCase !== "unchanged") return false;
    if (result.changed !== false) return false;
    if (result.content !== content) return false;

    // Segunda aplicación: sigue siendo un no-op.
    const second = ensureModsvsFirstInContent(result.content, "modsvs");
    if (second.appliedCase !== "unchanged") return false;
    if (second.changed !== false) return false;
    if (second.content !== result.content) return false;

    return true;
  }),
);
