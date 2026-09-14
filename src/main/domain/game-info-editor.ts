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
 *
 * CAVEAT (mismo estilo que el CAVEAT de la DECISIÓN 3): `firstToken` captura el
 * PRIMER bloque de texto sin espacios de la línea. Si el archivo trajera la clave
 * y la llave PEGADAS sin espacio (p. ej. `SearchPaths{`, todo junto en una línea),
 * `firstToken` devolvería `"searchpaths{"` en vez de `"searchpaths"`, y la línea NO
 * se reconocería como la clave SearchPaths: el resultado sería un
 * `GameInfoEditError` con `reason: "missing-search-paths"` sobre un archivo que en
 * realidad SÍ tiene el bloque. Esto es ACEPTABLE por el mismo criterio que el resto
 * de la DECISIÓN 1: se asume el formato real ya confirmado del gameinfo.txt (que
 * siempre trae `SearchPaths` y `{` en líneas SEPARADAS), no cualquier variante
 * posible del formato KeyValues.
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
 * CAVEAT (mismo estilo que el literal `\` de vpk-path.ts): `isGameFolderLine`
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
 * DECISIÓN 6 (P-30, Paso 2) — `folderName` es un parámetro REQUERIDO, ya NO una
 * carpeta fija asumida internamente.
 *
 * Antes de este cambio, `MODSVS_FOLDER = "modsvs"` estaba hardcodeada como la
 * ÚNICA carpeta posible del SearchPath que este módulo gestiona. Con múltiples
 * presets (P-30), cada preset va a tener su propia carpeta técnica (el `id`
 * generado del Paso 1, p. ej. `preset-a1b2c3`) en vez de compartir siempre
 * `modsvs`. Este paso SOLO generaliza la FIRMA: `ensureModsvsFirstInContent` y
 * `GameInfoEditor.ensureModsvsFirst` ahora reciben `folderName` como parámetro
 * explícito, y toda la lógica interna (comparación de la línea `Game <valor>`,
 * construcción de la línea canónica) opera sobre ese valor en vez de una
 * constante interna. El COMPORTAMIENTO OBSERVABLE de la app NO cambia todavía:
 * el único llamador de producción (`MergeOrchestrator#materialize`) sigue
 * pasando el literal `"modsvs"` (ver `GAMEINFO_SEARCH_PATH_FOLDER` en
 * `merge-orchestrator.ts`) hasta que un paso posterior lo reemplace por la
 * carpeta técnica del preset ACTIVO. Los nombres `ensureModsvsFirst(InContent)`
 * se CONSERVAN tal cual (no se renombran a algo genérico) para no forzar un
 * cambio de import en la suite de tests de BUG-010, que no tiene relación con
 * presets; la generalización real está en que ya no asumen ninguna carpeta
 * fija, el nombre del método/función simplemente quedó como legado.
 * ---------------------------------------------------------------------------
 * DECISIÓN 7 (P-30, Paso 3) — `removeFolderEntryInContent` (simétrico a
 * `ensureModsvsFirstInContent`) + `GameInfoEditor.switchFolderEntry` (I/O
 * ATÓMICA de "cambiar de carpeta activa" en UNA sola escritura).
 *
 * Cambiar el preset activo (P-30) implica dejar gameinfo.txt apuntando SOLO a
 * la carpeta del preset NUEVO, quitando la entrada de la carpeta anterior si
 * había una. `removeFolderEntryInContent` es el núcleo PURO simétrico de
 * `ensureModsvsFirstInContent`: quita TODAS las entradas `Game <folderName>`
 * del bloque SearchPaths (no-op si no hay ninguna). Es DELIBERADO que no
 * comparta el tipo `GameInfoEditOutcome` (con sus tres casos
 * insertar/mover/sin-cambios): remover solo tiene DOS desenlaces (se quitó
 * algo, o no había nada que quitar), así que `RemoveFolderEntryOutcome` usa
 * `changed: boolean` sin un `appliedCase` que no aportaría información nueva.
 *
 * `GameInfoEditor.switchFolderEntry(gameInfoFile, previousFolderName,
 * nextFolderName)` COMPONE `removeFolderEntryInContent` (si `previousFolderName`
 * no es `null`) + `ensureModsvsFirstInContent` (para `nextFolderName`) sobre
 * el MISMO contenido en memoria, y escribe el archivo COMO MUCHO UNA VEZ. Esto
 * es DELIBERADO, no una optimización: dos escrituras separadas (una para
 * quitar la entrada vieja, otra para asegurar la nueva) dejarían una ventana
 * en disco, entre ambas, donde gameinfo.txt no referencia NINGÚN preset — si
 * la segunda escritura fallara (permisos, disco lleno, UAC denegado), el
 * archivo quedaría así hasta que el usuario reintente. Con una sola
 * escritura, el archivo en disco SIEMPRE es o bien el ORIGINAL (si algo falla
 * antes de escribir, incluido un `GameInfoEditError` de cualquiera de los dos
 * núcleos puros) o bien el RESULTADO FINAL completo (`nextFolderName` solo) —
 * nunca un estado intermedio con cero o dos carpetas referenciadas.
 *
 * `previousFolderName === null` reduce `switchFolderEntry` EXACTAMENTE al
 * comportamiento de `ensureModsvsFirst` (se salta el paso de remoción por
 * completo): así es como `MergeOrchestrator#materialize` reutiliza este MISMO
 * método para su camino legado (`applyActiveSet`/`addAddon`/`removeAddon`,
 * que siempre pasan `previousFolderName: null`) sin ninguna rama especial.
 * ---------------------------------------------------------------------------
 */

import type { GameInfoEditResult } from "./types.js";

/** Clave del bloque de rutas de búsqueda dentro de FileSystem. */
const SEARCH_PATHS_KEY = "searchpaths";

/** Clave de cada entrada de ruta de búsqueda (se repite, una por SearchPath). */
const GAME_KEY = "game";

/** Fin de línea por defecto si no se puede inferir del contenido (Windows). */
const DEFAULT_EOL = "\r\n";

/** Indentación por defecto de la línea `Game modsvs` si no se puede inferir. */
const DEFAULT_INDENT = "\t\t\t\t";

/**
 * Separador clave-valor por defecto de la línea `Game modsvs` si el bloque no
 * tiene ninguna otra entrada `Game` de la cual derivarlo. Un tab: el resto del
 * dominio usa tabs (DEFAULT_INDENT) y el formato Valve alinea las columnas del
 * bloque SearchPaths con tabulación, así que un tab es el default consistente y
 * razonable (nunca un espacio simple, que es justo el defecto de BUG-010).
 */
const DEFAULT_SEPARATOR = "\t";

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
 * Extrae el separador clave-valor de una línea `Game <valor>`: la corrida COMPLETA
 * de whitespace (`[ \t]+`) entre la clave `game` (case-insensitive) y el inicio del
 * valor. Devuelve `null` si la línea no es una entrada `Game <valor>` reconocible
 * (no debería ocurrir sobre una línea ya validada con `isGameLine`, pero se protege).
 * Ver DECISIÓN 2 (BUG-010): se replica la corrida entera de tabs/espacios, no un
 * único carácter, para no romper la alineación de columnas del formato Valve.
 */
function extractSeparator(text: string): string | null {
  const match = /^\s*game([ \t]+)\S/i.exec(text);
  return match ? (match[1] ?? null) : null;
}

/**
 * ¿La línea es una entrada `Game <folderName>`? Se compara la clave `Game` y el
 * valor `folderName` de forma CASE-INSENSITIVE, aceptando el valor con o sin
 * comillas (`Game modsvs`, `game   MODSVS`, `Game "modsvs"`). Cualquier otra
 * `Game <x>` (con x != `folderName`) devuelve `false`. Ver DECISIÓN 3 y
 * DECISIÓN 6 (P-30, Paso 2: `folderName` ya no es la constante fija `modsvs`).
 */
function isGameFolderLine(text: string, folderName: string): boolean {
  const trimmed = text.trim();
  // Clave Game (case-insensitive) seguida de espacios y el valor, con comillas
  // opcionales alrededor del valor. Se ancla al fin de línea (sin basura extra).
  const match = /^(game)\s+"?([^"\s]+)"?\s*$/i.exec(trimmed);
  if (!match) return false;
  const value = match[2] ?? "";
  return value.toLowerCase() === folderName.toLowerCase();
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
 * Construye la línea canónica `Game <folderName>` con la indentación, el
 * SEPARADOR clave-valor y el EOL dados. El separador (corrida de tabs/espacios
 * entre `Game` y `folderName`) se deriva de la primera entrada `Game` de
 * referencia (BUG-010, DECISIÓN 2), en vez del espacio simple que se
 * hardcodeaba antes. El EOL vacío (última línea del archivo sin salto) se
 * sustituye por el EOL de referencia para que la línea insertada quede bien
 * terminada. `folderName` ya no es la constante fija `modsvs` (P-30, DECISIÓN 6).
 */
function canonicalFolderSegment(
  folderName: string,
  indent: string,
  separator: string,
  eol: string,
): LineSegment {
  return { text: `${indent}Game${separator}${folderName}`, eol: eol === "" ? DEFAULT_EOL : eol };
}

/**
 * Determina la indentación, el EOL y el SEPARADOR clave-valor de referencia para
 * la línea `Game modsvs`, inspeccionando las líneas del bloque (openIndex,
 * closeIndex). Prioriza:
 *   1. La indentación/EOL/separador de una línea `Game` existente del bloque.
 *   2. En su defecto, la indentación/EOL de la línea de apertura `{` (con
 *      `DEFAULT_SEPARATOR`).
 *   3. En último caso, los valores por defecto (DECISIÓN 3 + DEFAULT_SEPARATOR).
 *
 * BUG-010, DECISIÓN 1: el separador se deriva de la MISMA primera línea `Game` de
 * referencia de la que ya salen la indentación y el EOL, para mantener una única
 * línea de referencia determinista.
 */
function referenceIndentEol(
  segments: LineSegment[],
  block: SearchPathsBlock,
): { indent: string; eol: string; separator: string } {
  for (let i = block.openIndex + 1; i < block.closeIndex; i++) {
    const seg = segments[i];
    if (seg !== undefined && isGameLine(seg.text)) {
      // La MISMA línea de referencia aporta indentación, EOL y separador (DECISIÓN 1).
      const separator = extractSeparator(seg.text) ?? DEFAULT_SEPARATOR;
      return {
        indent: leadingIndent(seg.text),
        eol: seg.eol === "" ? DEFAULT_EOL : seg.eol,
        separator,
      };
    }
  }
  const openSeg = segments[block.openIndex];
  if (openSeg !== undefined) {
    // Indentar un nivel más que la línea de apertura si es solo `{`; si la llave
    // va pegada a la clave, se usa su misma indentación + un tab de cortesía. Sin
    // línea `Game` previa, el separador cae en DEFAULT_SEPARATOR (un tab).
    const baseIndent = leadingIndent(openSeg.text);
    const eol = openSeg.eol === "" ? DEFAULT_EOL : openSeg.eol;
    return { indent: `${baseIndent}\t`, eol, separator: DEFAULT_SEPARATOR };
  }
  return { indent: DEFAULT_INDENT, eol: DEFAULT_EOL, separator: DEFAULT_SEPARATOR };
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
 * @param folderName Nombre de la carpeta del SearchPath a garantizar como
 *   primera y única entrada (P-30, DECISIÓN 6). Antes de P-30 esto era SIEMPRE
 *   la constante fija `"modsvs"`; ahora lo decide el llamador (hoy sigue
 *   siendo `"modsvs"` en producción, ver DECISIÓN 6).
 * @returns {@link GameInfoEditOutcome} con el contenido, `changed` y `appliedCase`.
 */
export function ensureModsvsFirstInContent(content: string, folderName: string): GameInfoEditOutcome {
  const segments = splitLines(content);
  const block = locateSearchPaths(segments); // lanza si no hay bloque (DECISIÓN 1)

  // Índices (dentro del bloque) de las líneas `Game <folderName>` y de la
  // PRIMERA línea `Game` cualquiera (el punto donde debe quedar la entrada).
  const folderIndices: number[] = [];
  let firstGameIndex = -1;
  for (let i = block.openIndex + 1; i < block.closeIndex; i++) {
    const seg = segments[i];
    if (seg === undefined) continue;
    if (isGameLine(seg.text)) {
      if (firstGameIndex === -1) firstGameIndex = i;
      if (isGameFolderLine(seg.text, folderName)) folderIndices.push(i);
    }
  }

  // Caso C — ya es la primera y única entrada: sin cambios (idempotente).
  if (folderIndices.length === 1 && folderIndices[0] === firstGameIndex) {
    return { content, changed: false, appliedCase: "unchanged" };
  }

  const { indent, eol, separator } = referenceIndentEol(segments, block);
  const canonical = canonicalFolderSegment(folderName, indent, separator, eol);

  if (folderIndices.length === 0) {
    // Caso A — no existe: insertar como primera entrada Game (o al inicio del
    // contenido del bloque si no hay ninguna línea Game).
    //
    // CAVEAT (mismo estilo que el CAVEAT de la DECISIÓN 3): si el bloque SearchPaths
    // apareciera COLAPSADO en una sola línea (la `{` y la `}` en la misma línea que
    // la clave, sin ninguna entrada `Game` en medio, es decir `openIndex ===
    // closeIndex`), este Caso A insertaría la línea `Game <folderName>` en
    // `block.openIndex + 1`, que queda DESPUÉS de la línea de cierre del bloque, no
    // dentro de él: la entrada terminaría FUERA del bloque SearchPaths. Esto es
    // ACEPTABLE por el mismo motivo que la DECISIÓN 1: se asume el formato real ya
    // confirmado del gameinfo.txt, que siempre trae el bloque en MÚLTIPLES líneas
    // (clave, apertura `{`, entradas `Game`, cierre `}`, cada una en su propia
    // línea), no un bloque colapsado en una sola línea.
    const insertAt = firstGameIndex === -1 ? block.openIndex + 1 : firstGameIndex;
    const next = segments.slice();
    next.splice(insertAt, 0, canonical);
    return { content: joinLines(next), changed: true, appliedCase: "inserted" };
  }

  // Caso B — existe pero no es primera-y-única: eliminar TODAS las ocurrencias y
  // colocar una sola canónica en la primera posición Game. Se elimina de mayor a
  // menor índice para no invalidar los índices restantes.
  const folderSet = new Set(folderIndices);
  const next = segments.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (folderSet.has(i)) next.splice(i, 1);
  }
  // Recalcular la primera línea Game restante tras las eliminaciones: es el punto
  // de inserción. La búsqueda va ACOTADA al bloque SearchPaths (openIndexAfter,
  // closeIndexAfter), cuyos índices se recuperan en `next` por IDENTIDAD DE OBJETO
  // (los segmentos de apertura y cierre no se eliminan, así que sus referencias
  // siguen en `next`). Si tras quitar las entradas de `folderName` NO queda
  // ninguna otra línea Game dentro de ese rango, `insertAt` permanece en
  // `openIndexAfter + 1` y la entrada canónica se inserta justo después de la
  // apertura del bloque (correcto por construcción, no por casualidad de dónde
  // corta el bucle).
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
 * Resultado de {@link removeFolderEntryInContent} (P-30, Paso 3; ver DECISIÓN
 * 7). Solo DOS desenlaces posibles (se quitó una o más entradas, o no había
 * ninguna que quitar) — `changed: boolean` alcanza como único discriminante,
 * sin un `appliedCase` que no aportaría información nueva.
 */
export interface RemoveFolderEntryOutcome {
  content: string;
  changed: boolean;
}

/**
 * NÚCLEO PURO simétrico a {@link ensureModsvsFirstInContent} (P-30, Paso 3,
 * DECISIÓN 7): quita TODAS las entradas `Game <folderName>` del bloque
 * SearchPaths, sin tocar ninguna otra línea. NO hace I/O. Lanza
 * {@link GameInfoEditError} si no hay bloque SearchPaths (DECISIÓN 1), igual
 * que `ensureModsvsFirstInContent`. Si no hay ninguna entrada `folderName`, es
 * un no-op idempotente: `{content, changed:false}` con el `content` de
 * entrada intacto.
 *
 * @param content Texto completo del gameinfo.txt.
 * @param folderName Nombre de la carpeta cuyas entradas `Game <folderName>`
 *   hay que quitar.
 * @returns {@link RemoveFolderEntryOutcome} con el contenido resultante y si cambió.
 */
export function removeFolderEntryInContent(
  content: string,
  folderName: string,
): RemoveFolderEntryOutcome {
  const segments = splitLines(content);
  const block = locateSearchPaths(segments); // lanza si no hay bloque (DECISIÓN 1)

  const indices: number[] = [];
  for (let i = block.openIndex + 1; i < block.closeIndex; i++) {
    const seg = segments[i];
    if (seg !== undefined && isGameFolderLine(seg.text, folderName)) {
      indices.push(i);
    }
  }
  if (indices.length === 0) {
    return { content, changed: false };
  }
  const indexSet = new Set(indices);
  const next = segments.filter((_, i) => !indexSet.has(i));
  return { content: joinLines(next), changed: true };
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
   * Garantiza que `Game <folderName>` sea la primera y única entrada de esa
   * carpeta en el bloque SearchPaths del gameinfo.txt (AC 6.10). Ver los tres
   * casos en el encabezado. `folderName` es un parámetro REQUERIDO (P-30,
   * DECISIÓN 6): antes de P-30 esto era siempre la constante fija `"modsvs"`;
   * hoy lo decide el llamador (en producción, `MergeOrchestrator` sigue
   * pasando `"modsvs"` — el comportamiento observable no cambia todavía).
   *
   * - Lee el archivo, aplica el núcleo puro y, si `changed`, sobrescribe el archivo
   *   con el contenido resultante. En el Caso C (idempotente) NO escribe.
   * - Si no hay un bloque SearchPaths, propaga {@link GameInfoEditError} (DECISIÓN 1)
   *   para que el orquestador (tarea 18) aborte e informe.
   *
   * @param gameInfoFile Ruta absoluta (Windows) del gameinfo.txt.
   * @param folderName Nombre de la carpeta del SearchPath a garantizar (ver
   *   {@link ensureModsvsFirstInContent}).
   * @returns {@link GameInfoEditResult} con el caso aplicado y si el archivo cambió.
   * @throws {GameInfoEditError} si el gameinfo.txt no tiene un bloque SearchPaths.
   */
  async ensureModsvsFirst(gameInfoFile: string, folderName: string): Promise<GameInfoEditResult> {
    const content = await this.#fs.readTextFile(gameInfoFile);
    const outcome = ensureModsvsFirstInContent(content, folderName); // puede lanzar (DECISIÓN 1)

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

  /**
   * Cambia la entrada de SearchPath de `previousFolderName` (si no es `null`)
   * a `nextFolderName`, en UNA SOLA operación de I/O (P-30, Paso 3: cambio de
   * preset activo; ver DECISIÓN 7). Lee el archivo UNA vez, compone
   * {@link removeFolderEntryInContent} (si aplica) + {@link ensureModsvsFirstInContent}
   * sobre el MISMO contenido en memoria, y escribe COMO MUCHO UNA VEZ — nunca
   * dos escrituras separadas, para que el archivo en disco nunca quede en un
   * estado intermedio con cero o dos carpetas referenciadas (ver DECISIÓN 7).
   *
   * `previousFolderName === null` reduce este método EXACTAMENTE al
   * comportamiento de {@link ensureModsvsFirst} (se salta el paso de remoción
   * por completo) — así es como `MergeOrchestrator#materialize` lo reutiliza
   * para su camino legado sin ninguna rama especial.
   *
   * @param gameInfoFile Ruta absoluta (Windows) del gameinfo.txt.
   * @param previousFolderName Carpeta a quitar (si la había), o `null`.
   * @param nextFolderName Carpeta a garantizar como primera y única entrada.
   * @returns {@link GameInfoEditResult} con el caso aplicado y si el archivo cambió.
   * @throws {GameInfoEditError} si el gameinfo.txt no tiene un bloque SearchPaths.
   */
  async switchFolderEntry(
    gameInfoFile: string,
    previousFolderName: string | null,
    nextFolderName: string,
  ): Promise<GameInfoEditResult> {
    const content = await this.#fs.readTextFile(gameInfoFile);

    let working = content;
    let removedSomething = false;
    if (previousFolderName !== null) {
      const removed = removeFolderEntryInContent(working, previousFolderName); // puede lanzar (DECISIÓN 1)
      working = removed.content;
      removedSomething = removed.changed;
    }

    const ensured = ensureModsvsFirstInContent(working, nextFolderName); // puede lanzar (DECISIÓN 1)
    const changed = removedSomething || ensured.changed;

    if (changed) {
      await this.#fs.writeTextFile(gameInfoFile, ensured.content);
    }

    if (!changed) {
      return { appliedCase: "unchanged", changed: false };
    }
    // Si `ensured` reportó su propio caso (insertó o movió `nextFolderName`),
    // se reexpone tal cual. Si `ensured` fue "unchanged" (nextFolderName ya
    // estaba primera-y-única ANTES de remover `previousFolderName`, un caso
    // borde donde ambas carpetas coexistían) pero SÍ se removió algo, el
    // archivo cambió igual: se informa como "moved" — la descripción más
    // precisa disponible en la unión existente (el contenido se reorganizó,
    // aunque no por una inserción nueva de `nextFolderName`), sin agregar un
    // cuarto caso a `GameInfoEditResult` solo para este borde.
    const appliedCase = ensured.appliedCase === "unchanged" ? "moved" : ensured.appliedCase;
    return { appliedCase, changed: true };
  }
}
