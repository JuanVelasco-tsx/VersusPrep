/**
 * GameInfoEditor — garantiza que `Game modsvs` sea la PRIMERA y ÚNICA entrada
 * `modsvs` del bloque SearchPaths del gameinfo.txt (Tarea 13.1, Requirement 6,
 * AC 6.10; refina/precisa ese AC con los tres casos de design.md).
 *
 * Formato real del gameinfo.txt (KeyValues de Valve): dentro de
 * `GameInfo { FileSystem { SearchPaths { ... } } }`, el bloque SearchPaths
 * contiene líneas `Game <carpeta>` indentadas (la clave `Game` se REPITE, una
 * por SearchPath), p. ej.:
 *
 *     "GameInfo"
 *     {
 *         FileSystem
 *         {
 *             SearchPaths
 *             {
 *                 Game    modsvs
 *                 Game    update
 *                 Game    left4dead2_dlc3
 *                 Game    |gameinfo_path|.
 *             }
 *         }
 *     }
 *
 * `ensureModsvsFirst` implementa los tres casos, SIN duplicar nunca la entrada:
 *   - Caso A — `Game modsvs` no existe -> se INSERTA como primera entrada.
 *   - Caso B — existe en posición no-primera y/o múltiple -> se MUEVE/COLAPSA a
 *     una única primera entrada.
 *   - Caso C — ya es la primera y única -> NO se modifica (idempotente).
 * Invariante final: `Game modsvs` es la primera y única entrada `modsvs`,
 * preservando el orden relativo del resto de SearchPaths.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 1 — Sin bloque SearchPaths (ausente / vacío / malformado) = error
 * tipado `GameInfoEditError`, NO crear el bloque.
 *
 * El AC 6.10 y los tres casos ASUMEN que el bloque SearchPaths ya existe (nota
 * confirmada por el usuario: en la instalación real `Game modsvs` ya está como
 * primer SearchPath, agregado a mano siguiendo un tutorial). Cuando NO hay un
 * bloque SearchPaths localizable, `ensureModsvsFirst` LANZA `GameInfoEditError`:
 *   - `reason: "missing-search-paths"` — no aparece la clave `SearchPaths`.
 *   - `reason: "malformed"` — aparece la clave `SearchPaths` pero su bloque no
 *     abre/cierra con llaves de forma reconocible.
 * NO se extiende el Caso A a "crear un SearchPaths desde cero": insertar esa
 * estructura en un archivo del juego con layout inesperado es riesgoso y no lo
 * avala el diseño. Se falla explícito y el orquestador (tarea 18) informa (mismo
 * criterio de "propagar por throw" que BackupManager, Sección 12).
 * ---------------------------------------------------------------------------
 * DECISIÓN 2 — Transformación POR LÍNEAS, no round-trip vía el parser KeyValues.
 *
 * Un round-trip parse->render con `vdf-parser.ts` PERDERÍA formato: indentación,
 * comentarios `//`, casing original, EOL y el orden/espaciado de otras claves.
 * En su lugar se opera sobre las LÍNEAS: se localiza el bloque SearchPaths, se
 * identifican las líneas `Game modsvs` dentro de él y solo se insertan/mueven/
 * eliminan esas líneas. Todo lo demás queda intacto CARÁCTER POR CARÁCTER.
 * ---------------------------------------------------------------------------
 * DECISIÓN 3 — Preservación de indentación y EOL; entrada canónica `Game modsvs`.
 *
 * La línea insertada/movida replica (a) la INDENTACIÓN (whitespace líder) y (b)
 * el FIN DE LÍNEA (CRLF vs LF) de las demás líneas `Game` del bloque (o, si no
 * hay ninguna, de la línea de apertura del bloque). El texto canónico escrito es
 * `Game modsvs` (sin comillas). El match de la carpeta `modsvs` es
 * CASE-INSENSITIVE (NTFS y el engine de Source resuelven rutas así; mismo criterio
 * que vscript-detector / collision-resolver). Una ocurrencia con casing/espaciado
 * distinto en posición no-primera se COLAPSA a la forma canónica (Caso B).
 *
 * CAVEAT (mismo estilo que el literal `\` de vpk-path.ts): `isGameModsvsLine`
 * exige que la línea TERMINE justo después del valor `modsvs` (se ancla al fin
 * de línea con `\s*$`), SIN un comentario `//` al final. Si alguna vez apareciera
 * una línea `Game modsvs // algo`, NO se reconocería como la entrada modsvs
 * existente y `ensureModsvsFirstInContent` insertaría una segunda `Game modsvs`
 * canónica (duplicado). Esto es ACEPTABLE porque el formato real confirmado del
 * gameinfo.txt NO usa comentarios inline en las líneas `Game`; si se observara
 * ese caso en el futuro, habría que revisar esta decisión (ampliar el match para
 * tolerar un comentario de fin de línea).
 * ---------------------------------------------------------------------------
 * DECISIÓN 4 — Núcleo PURO de texto + capa de I/O inyectada.
 *
 * `ensureModsvsFirstInContent(content)` es PURA (string -> {content, changed,
 * appliedCase}), sin I/O, y es la que prueba la Property 12 (tarea 13.2). La clase
 * `GameInfoEditor` compone el I/O: lee con el FS inyectado, aplica el núcleo puro
 * y ESCRIBE SOLO si `changed` (Caso C no toca disco -> idempotencia real).
 * ---------------------------------------------------------------------------
 * DECISIÓN 5 — `GameInfoEditResult`: UNIÓN DISCRIMINADA ESTRICTA por `appliedCase`,
 * con `changed` CORRELACIONADO a nivel de tipos, sin campo `ok` (ver types.ts).
 * El tipo es `{ appliedCase: "unchanged"; changed: false } | { appliedCase:
 * "inserted" | "moved"; changed: true }`: `changed` NO es un `boolean` genérico
 * sino un literal atado al caso, de modo que el compilador impida combinaciones
 * incoherentes (p. ej. `unchanged` con `changed: true`). Los fallos van por throw
 * (`GameInfoEditError`); no hay rama de error en el retorno. Mismo patrón que
 * `BackupResult` (Sección 12). El núcleo puro devuelve un `GameInfoEditOutcome`
 * que sigue EL MISMO patrón de unión discriminada estricta (con `content` en ambas
 * ramas), así la correlación caso<->cambio nace en el núcleo, no en la capa de I/O.
 * ---------------------------------------------------------------------------
 */

import type { GameInfoEditResult } from "./types.js";

/** Carpeta canónica del SearchPath que gestiona el Manager. */
const MODSVS_FOLDER = "modsvs";

/** Clave del bloque de rutas de búsqueda dentro de FileSystem. */
const SEARCH_PATHS_KEY = "searchpaths";

/** Clave de cada entrada de ruta de búsqueda (se repite, una por SearchPath). */
const GAME_KEY = "game";

/** Fin de línea por defecto si no se puede inferir del contenido (Windows). */
const DEFAULT_EOL = "\r\n";

/** Indentación por defecto de la línea `Game modsvs` si no se puede inferir. */
const DEFAULT_INDENT = "\t\t\t\t";

/**
 * Motivo por el que `ensureModsvsFirst` no pudo operar sobre el gameinfo.txt.
 * Ver DECISIÓN 1.
 *
 *  - `missing-search-paths`: no se encontró la clave `SearchPaths`.
 *  - `malformed`: se encontró la clave `SearchPaths` pero su bloque `{ ... }` no
 *    es reconocible (no abre o no cierra).
 */
export type GameInfoEditErrorReason = "missing-search-paths" | "malformed";

/**
 * Error tipado que lanza {@link GameInfoEditor.ensureModsvsFirst} (y el núcleo
 * puro {@link ensureModsvsFirstInContent}) cuando el gameinfo.txt no tiene un
 * bloque SearchPaths sobre el que operar (DECISIÓN 1). Lleva `reason` para que el
 * orquestador/UI (tarea 18) distinga la causa y la informe.
 */
export class GameInfoEditError extends Error {
  readonly reason: GameInfoEditErrorReason;

  constructor(reason: GameInfoEditErrorReason, message: string) {
    super(message);
    this.name = "GameInfoEditError";
    this.reason = reason;
  }
}

/**
 * Contrato de FS inyectable PROPIO de GameInfoEditor (mismo patrón de FS mínimo
 * que BackupManager / MergeEngine / AddonScanner). Solo necesita leer y escribir
 * el ÚNICO archivo gameinfo.txt; no recorre ni crea directorios, así que su
 * contrato es más chico que el de los otros componentes.
 *
 * En producción se implementa con node:fs/promises y en los tests con un doble
 * en memoria. La ruta es absoluta en formato Windows.
 */
export interface GameInfoFileSystem {
  /** Lee el contenido de texto del archivo. Lanza si no existe o no se puede leer. */
  readTextFile(path: string): Promise<string>;
  /** Escribe (sobrescribe) el contenido de texto del archivo. */
  writeTextFile(path: string, content: string): Promise<void>;
}

/**
 * Resultado del núcleo puro {@link ensureModsvsFirstInContent}: contenido
 * resultante + qué caso se aplicó. Es una UNIÓN DISCRIMINADA correlacionada por
 * `appliedCase` (igual que {@link GameInfoEditResult}), de modo que `changed` quede
 * atado al caso a nivel de tipos: `unchanged` -> `changed: false`; `inserted`/
 * `moved` -> `changed: true`. `content` está en ambas ramas (en el Caso C es
 * idéntico al de entrada).
 */
export type GameInfoEditOutcome =
  | { content: string; changed: false; appliedCase: "unchanged" }
  | { content: string; changed: true; appliedCase: "inserted" | "moved" };


/**
 * Un segmento de línea: el TEXTO de la línea (sin su terminador) y el TERMINADOR
 * exacto que la sigue (`"\r\n"`, `"\n"` o `""` para la última línea sin salto).
 * Partir el contenido en segmentos y volver a unirlos (`text + eol`) reconstruye
 * el archivo BYTE POR BYTE, lo que permite editar solo las líneas necesarias sin
 * alterar el resto (DECISIÓN 2).
 */
interface LineSegment {
  text: string;
  eol: string;
}

/**
 * Parte `content` en {@link LineSegment}s preservando el terminador exacto de cada
 * línea (soporta CRLF y LF mezclados). La concatenación de `text + eol` de todos
 * los segmentos es EXACTAMENTE `content`.
 */
function splitLines(content: string): LineSegment[] {
  const segments: LineSegment[] = [];
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "\n") {
      // Salto LF; si viene precedido de \r es CRLF.
      const text = content.slice(start, i);
      segments.push({ text, eol: "\n" });
      start = i + 1;
    } else if (ch === "\r") {
      if (content[i + 1] === "\n") {
        const text = content.slice(start, i);
        segments.push({ text, eol: "\r\n" });
        i += 1; // consume el \n del par
        start = i + 1;
      } else {
        // \r solitario (Mac clásico); poco probable en gameinfo.txt, se respeta.
        const text = content.slice(start, i);
        segments.push({ text, eol: "\r" });
        start = i + 1;
      }
    }
  }
  // Resto tras el último terminador: la línea final sin salto (si la hay).
  if (start < content.length) {
    segments.push({ text: content.slice(start), eol: "" });
  }
  return segments;
}

/** Reconstruye el contenido a partir de los segmentos (inverso de splitLines). */
function joinLines(segments: LineSegment[]): string {
  let out = "";
  for (const seg of segments) {
    out += seg.text + seg.eol;
  }
  return out;
}

/**
 * Devuelve el primer TOKEN (secuencia sin espacios) de una línea ya recortada de
 * su indentación, en minúsculas, o `""` si la línea (tras recortar) está vacía o
 * es un comentario. Se usa para clasificar líneas estructurales (`searchpaths`,
 * `game`, `{`, `}`) de forma case-insensitive.
 */
function firstToken(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  const match = /^[^\s]+/.exec(trimmed);
  return match ? match[0].toLowerCase() : "";
}

/** Indentación (whitespace líder) de una línea. */
function leadingIndent(text: string): string {
  const match = /^[ \t]*/.exec(text);
  return match ? match[0] : "";
}

/**
 * ¿La línea es una entrada `Game modsvs`? Se compara la clave `Game` y el valor
 * `modsvs` de forma CASE-INSENSITIVE, aceptando el valor con o sin comillas
 * (`Game modsvs`, `game   MODSVS`, `Game "modsvs"`). Cualquier otra `Game <x>`
 * (con x != modsvs) devuelve `false`. Ver DECISIÓN 3.
 */
function isGameModsvsLine(text: string): boolean {
  const trimmed = text.trim();
  // Clave Game (case-insensitive) seguida de espacios y el valor, con comillas
  // opcionales alrededor del valor. Se ancla al fin de línea (sin basura extra).
  const match = /^(game)\s+"?([^"\s]+)"?\s*$/i.exec(trimmed);
  if (!match) return false;
  const value = match[2] ?? "";
  return value.toLowerCase() === MODSVS_FOLDER;
}

/** ¿La línea es una entrada `Game <algo>` (cualquier SearchPath de tipo Game)? */
function isGameLine(text: string): boolean {
  return firstToken(text) === GAME_KEY;
}


/**
 * Ubicación del bloque SearchPaths dentro de los segmentos de línea:
 *  - `keyIndex`: índice del segmento con la clave `SearchPaths`.
 *  - `openIndex`: índice del segmento que contiene la `{` de apertura del bloque
 *    (puede ser el mismo `keyIndex` si la llave va en la misma línea, o uno
 *    posterior si va en línea aparte, como es habitual en el formato de Valve).
 *  - `closeIndex`: índice del segmento con la `}` que cierra el bloque.
 * El CONTENIDO del bloque son los segmentos en `(openIndex, closeIndex)`.
 */
interface SearchPathsBlock {
  keyIndex: number;
  openIndex: number;
  closeIndex: number;
}

/**
 * Localiza el bloque SearchPaths en los segmentos. Lanza {@link GameInfoEditError}
 * si no hay clave `SearchPaths` (`missing-search-paths`) o si la clave existe pero
 * su bloque `{ ... }` no es reconocible (`malformed`). Ver DECISIÓN 1.
 *
 * Reglas de reconocimiento (tolerantes al formato real de Valve):
 *  - La `{` de apertura puede ir en la misma línea de la clave (`SearchPaths {`) o
 *    en una línea posterior que sea SOLO `{` (ignorando líneas en blanco entre
 *    medio). Cualquier otra línea con contenido antes de la `{` -> `malformed`.
 *  - El cierre es la `}` que equilibra la apertura, rastreando el anidamiento de
 *    llaves de sub-bloques que pudieran aparecer dentro.
 */
function locateSearchPaths(segments: LineSegment[]): SearchPathsBlock {
  let keyIndex = -1;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg !== undefined && firstToken(seg.text) === SEARCH_PATHS_KEY) {
      keyIndex = i;
      break;
    }
  }
  if (keyIndex === -1) {
    throw new GameInfoEditError(
      "missing-search-paths",
      "El gameinfo.txt no contiene un bloque SearchPaths.",
    );
  }

  // Buscar la `{` de apertura: puede estar en la misma línea de la clave o en una
  // línea posterior (saltando líneas en blanco). Si aparece contenido no-blanco
  // distinto de `{` antes de la llave, el bloque está malformado.
  const keySeg = segments[keyIndex];
  const keyText = keySeg ? keySeg.text : "";
  const afterKey = keyText.trim().slice(SEARCH_PATHS_KEY.length).trim();
  let openIndex = -1;
  if (afterKey.startsWith("{")) {
    openIndex = keyIndex;
  } else if (afterKey.length === 0) {
    for (let i = keyIndex + 1; i < segments.length; i++) {
      const seg = segments[i];
      const t = seg ? seg.text.trim() : "";
      if (t.length === 0) continue; // línea en blanco entre la clave y la `{`
      if (t === "{") {
        openIndex = i;
      }
      break;
    }
  }
  if (openIndex === -1) {
    throw new GameInfoEditError(
      "malformed",
      "El bloque SearchPaths no abre con una llave `{` reconocible.",
    );
  }

  // Rastrear el cierre equilibrando llaves. Se cuentan `{` y `}` por línea desde
  // la apertura; el bloque cierra cuando la profundidad vuelve a 0.
  let depth = 0;
  let closeIndex = -1;
  for (let i = openIndex; i < segments.length; i++) {
    const seg = segments[i];
    const text = seg ? seg.text : "";
    for (const ch of text) {
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          closeIndex = i;
          break;
        }
      }
    }
    if (closeIndex !== -1) break;
  }
  if (closeIndex === -1) {
    throw new GameInfoEditError(
      "malformed",
      "El bloque SearchPaths no cierra con una llave `}`.",
    );
  }

  return { keyIndex, openIndex, closeIndex };
}


/**
 * Construye la línea canónica `Game modsvs` con la indentación y el EOL dados.
 * El EOL vacío (última línea del archivo sin salto) se sustituye por el EOL de
 * referencia para que la línea insertada quede bien terminada.
 */
function canonicalModsvsSegment(indent: string, eol: string): LineSegment {
  return { text: `${indent}${"Game"} ${MODSVS_FOLDER}`, eol: eol === "" ? DEFAULT_EOL : eol };
}

/**
 * Determina la indentación y el EOL de referencia para la línea `Game modsvs`,
 * inspeccionando las líneas del bloque (openIndex, closeIndex). Prioriza:
 *   1. La indentación/EOL de una línea `Game` existente del bloque.
 *   2. En su defecto, la de la línea de apertura `{`.
 *   3. En último caso, los valores por defecto (DECISIÓN 3).
 */
function referenceIndentEol(
  segments: LineSegment[],
  block: SearchPathsBlock,
): { indent: string; eol: string } {
  for (let i = block.openIndex + 1; i < block.closeIndex; i++) {
    const seg = segments[i];
    if (seg !== undefined && isGameLine(seg.text)) {
      return { indent: leadingIndent(seg.text), eol: seg.eol === "" ? DEFAULT_EOL : seg.eol };
    }
  }
  const openSeg = segments[block.openIndex];
  if (openSeg !== undefined) {
    // Indentar un nivel más que la línea de apertura si es solo `{`; si la llave
    // va pegada a la clave, se usa su misma indentación + un tab de cortesía.
    const baseIndent = leadingIndent(openSeg.text);
    const eol = openSeg.eol === "" ? DEFAULT_EOL : openSeg.eol;
    return { indent: `${baseIndent}\t`, eol };
  }
  return { indent: DEFAULT_INDENT, eol: DEFAULT_EOL };
}

/**
 * NÚCLEO PURO (DECISIÓN 4). Aplica los tres casos sobre el CONTENIDO del
 * gameinfo.txt y devuelve el contenido resultante junto con si cambió y qué caso
 * se aplicó. NO hace I/O. Lanza {@link GameInfoEditError} si no hay bloque
 * SearchPaths (DECISIÓN 1).
 *
 * Idempotencia (Caso C): si `Game modsvs` ya es la primera y única entrada `modsvs`
 * del bloque, el contenido se devuelve TAL CUAL (idéntico al de entrada), sin
 * reescribir su espaciado aunque no sea el canónico — así una segunda aplicación
 * no produce cambios.
 *
 * @param content Texto completo del gameinfo.txt.
 * @returns {@link GameInfoEditOutcome} con el contenido, `changed` y `appliedCase`.
 */
export function ensureModsvsFirstInContent(content: string): GameInfoEditOutcome {
  const segments = splitLines(content);
  const block = locateSearchPaths(segments); // lanza si no hay bloque (DECISIÓN 1)

  // Índices (dentro del bloque) de las líneas `Game modsvs` y de la PRIMERA línea
  // `Game` cualquiera (el punto donde debe quedar la entrada modsvs).
  const modsvsIndices: number[] = [];
  let firstGameIndex = -1;
  for (let i = block.openIndex + 1; i < block.closeIndex; i++) {
    const seg = segments[i];
    if (seg === undefined) continue;
    if (isGameLine(seg.text)) {
      if (firstGameIndex === -1) firstGameIndex = i;
      if (isGameModsvsLine(seg.text)) modsvsIndices.push(i);
    }
  }

  // Caso C — ya es la primera y única entrada modsvs: sin cambios (idempotente).
  if (modsvsIndices.length === 1 && modsvsIndices[0] === firstGameIndex) {
    return { content, changed: false, appliedCase: "unchanged" };
  }

  const { indent, eol } = referenceIndentEol(segments, block);
  const canonical = canonicalModsvsSegment(indent, eol);

  if (modsvsIndices.length === 0) {
    // Caso A — no existe: insertar como primera entrada Game (o al inicio del
    // contenido del bloque si no hay ninguna línea Game).
    const insertAt = firstGameIndex === -1 ? block.openIndex + 1 : firstGameIndex;
    const next = segments.slice();
    next.splice(insertAt, 0, canonical);
    return { content: joinLines(next), changed: true, appliedCase: "inserted" };
  }

  // Caso B — existe pero no es primera-y-única: eliminar TODAS las ocurrencias y
  // colocar una sola canónica en la primera posición Game. Se elimina de mayor a
  // menor índice para no invalidar los índices restantes.
  const modsvsSet = new Set(modsvsIndices);
  const next = segments.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (modsvsSet.has(i)) next.splice(i, 1);
  }
  // Recalcular la primera línea Game restante tras las eliminaciones: es el punto
  // de inserción. La búsqueda va ACOTADA al bloque SearchPaths (openIndexAfter,
  // closeIndexAfter), cuyos índices se recuperan en `next` por IDENTIDAD DE OBJETO
  // (los segmentos de apertura y cierre no se eliminan, así que sus referencias
  // siguen en `next`). Si tras quitar las modsvs NO queda ninguna otra línea Game
  // dentro de ese rango, `insertAt` permanece en `openIndexAfter + 1` y la entrada
  // canónica se inserta justo después de la apertura del bloque (correcto por
  // construcción, no por casualidad de dónde corta el bucle).
  const openIndexAfter = next.indexOf(segments[block.openIndex] as LineSegment);
  const closeIndexAfter = next.indexOf(segments[block.closeIndex] as LineSegment);
  let insertAt = openIndexAfter + 1;
  for (let i = openIndexAfter + 1; i < closeIndexAfter; i++) {
    const seg = next[i];
    if (seg !== undefined && isGameLine(seg.text)) {
      insertAt = i;
      break;
    }
  }
  next.splice(insertAt, 0, canonical);
  return { content: joinLines(next), changed: true, appliedCase: "moved" };
}

/**
 * GameInfoEditor — capa de I/O sobre el núcleo puro {@link ensureModsvsFirstInContent}
 * (DECISIÓN 4). Lee el gameinfo.txt con el {@link GameInfoFileSystem} inyectado,
 * aplica la transformación y ESCRIBE SOLO si hubo cambio (Caso C no toca disco).
 *
 * Depende del FS por constructor para ser testeable sin disco real (mismo patrón
 * que BackupManager / MergeEngine / CollisionResolver / AddonScanner).
 */
export class GameInfoEditor {
  readonly #fs: GameInfoFileSystem;

  /**
   * @param fs FS inyectado para leer y escribir el gameinfo.txt.
   */
  constructor(fs: GameInfoFileSystem) {
    this.#fs = fs;
  }

  /**
   * Garantiza que `Game modsvs` sea la primera y única entrada `modsvs` del bloque
   * SearchPaths del gameinfo.txt (AC 6.10). Ver los tres casos en el encabezado.
   *
   * - Lee el archivo, aplica el núcleo puro y, si `changed`, sobrescribe el archivo
   *   con el contenido resultante. En el Caso C (idempotente) NO escribe.
   * - Si no hay un bloque SearchPaths, propaga {@link GameInfoEditError} (DECISIÓN 1)
   *   para que el orquestador (tarea 18) aborte e informe.
   *
   * @param gameInfoFile Ruta absoluta (Windows) del gameinfo.txt.
   * @returns {@link GameInfoEditResult} con el caso aplicado y si el archivo cambió.
   * @throws {GameInfoEditError} si el gameinfo.txt no tiene un bloque SearchPaths.
   */
  async ensureModsvsFirst(gameInfoFile: string): Promise<GameInfoEditResult> {
    const content = await this.#fs.readTextFile(gameInfoFile);
    const outcome = ensureModsvsFirstInContent(content); // puede lanzar (DECISIÓN 1)

    if (outcome.changed) {
      await this.#fs.writeTextFile(gameInfoFile, outcome.content);
    }

    // El `outcome` ya viene correlacionado (unión discriminada): se reexpone solo
    // el caso y el flag de cambio, descartando el `content`. El estrechamiento por
    // `appliedCase` mantiene la correspondencia exigida por GameInfoEditResult.
    if (outcome.appliedCase === "unchanged") {
      return { appliedCase: "unchanged", changed: false };
    }
    return { appliedCase: outcome.appliedCase, changed: true };
  }
}
