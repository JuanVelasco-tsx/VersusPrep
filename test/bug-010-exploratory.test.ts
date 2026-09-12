import { test, expect } from "vitest";

import { ensureModsvsFirstInContent } from "../src/main/domain/index.js";

/**
 * BUG-010 — Tests EXPLORATORIOS de la Bug Condition (fase de reproducción).
 *
 * OBJETIVO (metodología bug condition): reproducir BUG-010 sobre el código
 * ACTUAL SIN FIX. Estos tests DEBEN FALLAR — el fallo confirma la causa raíz:
 * `canonicalModsvsSegment` en `src/main/domain/game-info-editor.ts` hardcodea un
 * ESPACIO SIMPLE entre la clave `Game` y el valor `modsvs`, en vez de replicar el
 * separador clave-valor (tabulación) de la primera entrada `Game` de referencia
 * del bloque `SearchPaths`.
 *
 * NO se arregla ni el código ni el test para que pasen: el fallo es el resultado
 * ESPERADO de esta fase. Los asertos codifican el comportamiento CORRECTO, así que
 * pasarán tras el fix (tarea 4.2).
 *
 * Bajo prueba: la función PURA `ensureModsvsFirstInContent(content)` (misma que
 * `test/game-info-editor.property.test.ts`), NO la clase `GameInfoEditor`.
 *
 * _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_
 */

/** EOL usado en los fixtures sintéticos (LF; irrelevante para el separador). */
const EOL = "\n";

/**
 * Construye un `gameinfo.txt` sintético con un bloque `SearchPaths` bien formado
 * (`SearchPaths` / `{` / entradas `Game` / `}`) a partir de las líneas internas
 * ya indentadas del bloque.
 */
function buildGameInfo(blockLines: string[]): string {
  const inner = blockLines.map((l) => `\t\t\t${l}`).join(EOL);
  return [
    '"GameInfo"',
    "{",
    "\tFileSystem",
    "\t{",
    "\t\tSearchPaths",
    "\t\t{",
    inner,
    "\t\t}",
    "\t}",
    "}",
    "",
  ].join(EOL);
}

/**
 * Extrae el SEPARADOR clave-valor EXACTO de la (primera) línea `Game modsvs`
 * producida en `content`. Divide por `EOL`, ubica la línea cuyo valor sea
 * `modsvs` y captura la corrida `[ \t]+` entre `Game` y `modsvs`. Distingue con
 * precisión un espacio " " de una tabulación "\t" (o "\t\t", etc.).
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

/**
 * Caso 1 (A, una tab): bloque con primera entrada `Game\tupdate` y SIN `modsvs`.
 * Tras insertar (Caso A), la línea `Game modsvs` DEBE usar exactamente UNA tab
 * como separador (el de la entrada de referencia), no un espacio simple.
 *
 * Sobre el código sin fix FALLA: produce `Game modsvs` con espacio simple.
 */
test("Caso 1 (A, una tab): la línea insertada replica la única tab de referencia", () => {
  const content = buildGameInfo([
    "Game\tupdate",
    "Game\tleft4dead2_dlc3",
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("inserted");
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // ESPERADO/correcto: separador = una tab (falla hoy, produce " ").
  expect(found?.separator).toBe("\t");
});

/**
 * Caso 2 (A, múltiples tabs): primera entrada `Game\t\tleft4dead2_dlc3`. La línea
 * `Game modsvs` DEBE replicar los MISMOS dos tabs.
 *
 * Sobre el código sin fix FALLA: produce `Game modsvs` con espacio simple.
 */
test("Caso 2 (A, múltiples tabs): la línea insertada replica los dos tabs de referencia", () => {
  const content = buildGameInfo([
    "Game\t\tleft4dead2_dlc3",
    "Game\t\tupdate",
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("inserted");
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // ESPERADO/correcto: separador = dos tabs exactos (falla hoy, produce " ").
  expect(found?.separator).toBe("\t\t");
});

/**
 * Caso 3 (B, mover/colapsar): `Game modsvs` está en posición NO-primera, y la
 * primera entrada `Game` es `Game\tupdate` (con tab). Tras mover/colapsar a la
 * primera posición, la línea `Game modsvs` DEBE usar el separador de referencia
 * (una tab).
 *
 * Idempotencia: para que sea Caso B (mover) y NO Caso C (unchanged), la `modsvs`
 * NO debe ser ya la primera-y-única: se pone una entrada `Game` ANTES de ella.
 *
 * Sobre el código sin fix FALLA: la línea colapsada usa espacio simple.
 */
test("Caso 3 (B, mover): la línea colapsada usa el separador de referencia (una tab)", () => {
  const content = buildGameInfo([
    "Game\tupdate", // primera entrada Game de referencia (con tab)
    "Game\tmodsvs", // modsvs en posición no-primera -> Caso B (mover/colapsar)
    "Game\tleft4dead2_dlc3",
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("moved");
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // ESPERADO/correcto: separador de referencia = una tab (falla hoy, produce " ").
  expect(found?.separator).toBe("\t");
});

/**
 * Caso 4 (sin entrada `Game` previa): bloque `SearchPaths` SIN ninguna otra
 * entrada `Game` (solo un comentario), sin `modsvs`. La línea insertada DEBE usar
 * `DEFAULT_SEPARATOR` = una tab.
 *
 * NOTA: sobre el código sin fix esto también produce espacio simple, así que el
 * aserto de "una tab" FALLA. Este caso valida el DEFAULT del fix.
 */
test("Caso 4 (sin Game previa): la línea insertada usa DEFAULT_SEPARATOR (una tab)", () => {
  const content = buildGameInfo([
    "// bloque sin ninguna entrada Game previa",
  ]);

  const result = ensureModsvsFirstInContent(content);

  expect(result.appliedCase).toBe("inserted");
  const found = extractModsvsSeparator(result.content);
  expect(found).not.toBeNull();
  // ESPERADO/correcto: DEFAULT_SEPARATOR = una tab (falla hoy, produce " ").
  expect(found?.separator).toBe("\t");
});
