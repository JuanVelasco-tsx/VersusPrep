/**
 * Parser KeyValues del formato de Valve, especializado para `libraryfolders.vdf`
 * (AC 1.3 / Tarea 5.1 / Property 1).
 *
 * El AC 1.3 exige interpretar `<Steam_Path>\steamapps\libraryfolders.vdf` como
 * formato KeyValues de Valve. La estructura real confirmada (ver design.md,
 * sección PathDetector, y `Context/04-historial-decisiones.md`) es:
 *
 *   "libraryfolders"
 *   {
 *       "0"
 *       {
 *           "path"    "D:\\SteamLibrary"
 *           "apps"    { "550"  "..." ... }
 *       }
 *   }
 *
 * Esta función es PURA: opera sobre el CONTENIDO del archivo (un `string`) y NO
 * realiza I/O. La lectura desde disco a partir del `steamPath` es de la tarea 5.3
 * (`readSteamPath` + `derivePaths` + `verifyPathsOnDisk`); mantener el parseo
 * aislado del I/O lo hace trivialmente testeable (unit y property tests).
 *
 * DECISIÓN DE FIRMA (documentada en el historial): aunque `design.md` muestra
 * `parseLibraryFolders(steamPath: string)`, para esta subtarea —parseo puro— la
 * función opera sobre el CONTENIDO del VDF, no sobre la ruta. La lectura del
 * archivo a partir de la ruta se compondrá en la tarea 5.3.
 *
 * ---------------------------------------------------------------------------
 * ALCANCE DEL PARSER (Tarea 5.1)
 *
 * El parser es un tokenizador + constructor de árbol KeyValues genérico capaz de
 * manejar el formato de Valve:
 *  - Pares clave-valor entre comillas: `"clave"  "valor"`.
 *  - Bloques anidados con `{ ... }` (el valor de una clave es un sub-bloque).
 *  - Indentación, espacios y tabs arbitrarios entre tokens.
 *  - Saltos de línea `\n` y `\r\n`.
 *  - Comentarios de Valve `//` hasta el fin de línea.
 *
 * De ese árbol, `parseLibraryFolders` extrae por cada biblioteca su `path` y las
 * claves de su bloque `apps` (los AppIDs) EN ORDEN DE APARICIÓN, produciendo
 * `LibraryEntry[]` (ver `types.ts`). No se necesita label ni tamaño por app: la
 * forma `{ path; apps: string[] }` alcanza para `findGameLibrary` (5.1) y
 * `derivePaths` (5.3).
 *
 * ---------------------------------------------------------------------------
 * DECISIONES DE COMPORTAMIENTO NO FIJADAS POR EL SPEC (documentadas para evitar
 * ambigüedad y para que el property test 5.2 razone sin sorpresas):
 *
 * 1. COMENTARIOS `//`. Se soportan: al encontrar `//` FUERA de una cadena
 *    entrecomillada, se descarta el resto de la línea. Un `//` DENTRO de comillas
 *    es parte del valor (p. ej. una ruta o URL) y NO inicia comentario.
 *
 * 2. CLAVES/VALORES SIN COMILLAS. El formato real de Valve permite tokens sin
 *    comillas (p. ej. macros de condición). El tokenizador los soporta como
 *    tokens delimitados por espacios en blanco / llaves; para `libraryfolders.vdf`
 *    en la práctica todo va entrecomillado, pero se aceptan por robustez.
 *
 * 3. CASING DE LA CLAVE "550". La clave del AppID se compara de forma EXACTA
 *    (sensible a mayúsculas). "550" es numérico, así que el casing no aplica al
 *    dígito en sí; se conserva el token tal cual aparece en el archivo. La
 *    detección de L4D2 en `findGameLibrary` compara contra el literal `"550"`.
 *
 * 4. CASING DE LAS CLAVES ESTRUCTURALES (`path`, `apps`). Se comparan de forma
 *    INSENSIBLE a mayúsculas al extraer `LibraryEntry`, porque el nombre de campo
 *    estructural del formato de Valve no es sensible a mayúsculas y distintos
 *    dumps podrían variar el casing. Los VALORES (rutas, AppIDs) se conservan tal
 *    cual.
 *
 * 5. CLAVES DUPLICADAS dentro de un mismo bloque. El formato no las prohíbe. Para
 *    los AppIDs del bloque `apps`, se PRESERVAN en orden de aparición incluyendo
 *    duplicados (no se deduplican): `findGameLibrary` solo necesita saber si
 *    `"550"` está presente, y preservar el orden/duplicados mantiene el parser
 *    como un reflejo fiel del archivo. Si `path` apareciera duplicado en una
 *    biblioteca, gana la ÚLTIMA ocurrencia (semántica habitual de "última
 *    asignación gana" de KeyValues).
 *
 * 6. BIBLIOTECA SIN `path` o SIN `apps`. Si una entrada de biblioteca no declara
 *    `path`, se usa cadena vacía (`""`) como `path` (la verificación en disco de
 *    la tarea 5.3 la descartará). Si no declara `apps`, `apps` es `[]`.
 *
 * 7. RUTA RAÍZ. Se busca el bloque de nivel superior `libraryfolders` de forma
 *    insensible a mayúsculas. Si el contenido es directamente el mapa de
 *    bibliotecas sin ese envoltorio, el parser también lo tolera tomando el
 *    primer bloque raíz cuyos hijos parezcan entradas de biblioteca.
 * ---------------------------------------------------------------------------
 */

import type { LibraryEntry } from "./types.js";

/** Nombre (insensible a mayúsculas) del bloque raíz del `libraryfolders.vdf`. */
export const LIBRARY_FOLDERS_ROOT_KEY = "libraryfolders";

/** Nombre (insensible a mayúsculas) de la clave con la ruta de la biblioteca. */
export const LIBRARY_PATH_KEY = "path";

/** Nombre (insensible a mayúsculas) del bloque de AppIDs de una biblioteca. */
export const LIBRARY_APPS_KEY = "apps";

/**
 * Un nodo del árbol KeyValues. El VALOR de una clave es o bien un `string`
 * (par clave-valor simple) o bien un `VdfNode` (sub-bloque `{ ... }`).
 *
 * Se modela como una lista ORDENADA de pares para PRESERVAR el orden de
 * aparición y admitir claves duplicadas (ver decisión 5). No se usa un objeto
 * `Record<string, ...>` justamente porque perdería orden y colapsaría duplicados.
 */
export interface VdfNode {
  /** Pares clave→valor en orden de aparición. */
  entries: VdfEntry[];
}

/** Un par clave→valor de un {@link VdfNode}. */
export interface VdfEntry {
  key: string;
  value: string | VdfNode;
}

/** Tipos de token que produce el tokenizador. */
type TokenType = "string" | "open" | "close";

interface Token {
  type: TokenType;
  /** Presente solo para tokens `string` (clave o valor textual). */
  value?: string;
}

/**
 * Tokeniza el contenido KeyValues: strings (entrecomillados o no), llaves de
 * apertura `{` y cierre `}`. Descarta espacios en blanco y comentarios `//`.
 */
function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  const length = content.length;
  let i = 0;

  while (i < length) {
    const ch = content[i];

    // Espacios en blanco (incluye \n y \r): se saltan.
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i += 1;
      continue;
    }

    // Comentario `//` hasta fin de línea (decisión 1). Fuera de comillas.
    if (ch === "/" && content[i + 1] === "/") {
      i += 2;
      while (i < length && content[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    // Llaves de bloque.
    if (ch === "{") {
      tokens.push({ type: "open" });
      i += 1;
      continue;
    }
    if (ch === "}") {
      tokens.push({ type: "close" });
      i += 1;
      continue;
    }

    // Cadena entrecomillada. Un `//` dentro NO inicia comentario (decisión 1).
    if (ch === '"') {
      i += 1;
      let str = "";
      while (i < length && content[i] !== '"') {
        // Soporte de escapes de Valve dentro de comillas (p. ej. `\\` y `\"`).
        if (content[i] === "\\" && i + 1 < length) {
          const next = content[i + 1];
          if (next === "\\") {
            str += "\\";
            i += 2;
            continue;
          }
          if (next === '"') {
            str += '"';
            i += 2;
            continue;
          }
          if (next === "n") {
            str += "\n";
            i += 2;
            continue;
          }
          if (next === "t") {
            str += "\t";
            i += 2;
            continue;
          }
        }
        str += content[i];
        i += 1;
      }
      // Consume la comilla de cierre si existe (tolerante a EOF sin cerrar).
      if (i < length) {
        i += 1;
      }
      tokens.push({ type: "string", value: str });
      continue;
    }

    // Token sin comillas (decisión 2): hasta espacio en blanco, llave o comilla.
    let bare = "";
    while (i < length) {
      const c = content[i];
      if (
        c === " " ||
        c === "\t" ||
        c === "\r" ||
        c === "\n" ||
        c === "{" ||
        c === "}" ||
        c === '"'
      ) {
        break;
      }
      // Un `//` fuera de comillas corta el token e inicia comentario.
      if (c === "/" && content[i + 1] === "/") {
        break;
      }
      bare += c;
      i += 1;
    }
    tokens.push({ type: "string", value: bare });
  }

  return tokens;
}

/**
 * Construye un {@link VdfNode} a partir de una lista de tokens, empezando en el
 * índice `start` (el contenido de un bloque, sin la `{` inicial). Devuelve el
 * nodo y el índice del token siguiente al `}` de cierre (o al final).
 */
function parseNode(tokens: Token[], start: number): { node: VdfNode; next: number } {
  const entries: VdfEntry[] = [];
  let i = start;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined) {
      break;
    }

    // `}` cierra este bloque.
    if (token.type === "close") {
      return { node: { entries }, next: i + 1 };
    }

    // Una `{` suelta sin clave previa: se ignora de forma tolerante.
    if (token.type === "open") {
      const sub = parseNode(tokens, i + 1);
      i = sub.next;
      continue;
    }

    // token.type === "string": es una CLAVE. Su valor es el siguiente token.
    const key = token.value ?? "";
    const valueToken = tokens[i + 1];

    if (valueToken === undefined) {
      // Clave sin valor al final del stream: se registra con valor vacío.
      entries.push({ key, value: "" });
      i += 1;
      continue;
    }

    if (valueToken.type === "open") {
      // El valor es un sub-bloque.
      const sub = parseNode(tokens, i + 2);
      entries.push({ key, value: sub.node });
      i = sub.next;
      continue;
    }

    if (valueToken.type === "string") {
      entries.push({ key, value: valueToken.value ?? "" });
      i += 2;
      continue;
    }

    // valueToken.type === "close": clave sin valor; cerramos con el `}`.
    entries.push({ key, value: "" });
    i += 1;
  }

  return { node: { entries }, next: i };
}

/**
 * Parsea el contenido KeyValues completo a un {@link VdfNode} raíz cuyos
 * `entries` son las claves de nivel superior (p. ej. `libraryfolders`).
 *
 * @param content Texto del archivo VDF.
 * @returns Nodo raíz con las entradas de nivel superior.
 */
export function parseVdf(content: string): VdfNode {
  const tokens = tokenize(content);
  const { node } = parseNode(tokens, 0);
  return node;
}

/** Busca (insensible a mayúsculas) el primer valor de tipo `string` de una clave. */
function findString(node: VdfNode, key: string): string | undefined {
  const lower = key.toLowerCase();
  let found: string | undefined;
  for (const entry of node.entries) {
    if (entry.key.toLowerCase() === lower && typeof entry.value === "string") {
      // "Última asignación gana" ante duplicados (decisión 5).
      found = entry.value;
    }
  }
  return found;
}

/** Busca (insensible a mayúsculas) el primer sub-bloque de una clave. */
function findBlock(node: VdfNode, key: string): VdfNode | undefined {
  const lower = key.toLowerCase();
  let found: VdfNode | undefined;
  for (const entry of node.entries) {
    if (entry.key.toLowerCase() === lower && typeof entry.value !== "string") {
      found = entry.value;
    }
  }
  return found;
}

/**
 * Devuelve el nodo raíz que contiene las entradas de biblioteca. Prefiere el
 * bloque `libraryfolders` (insensible a mayúsculas, decisión 7); si no existe,
 * usa el nodo raíz tal cual (tolerancia a VDF sin el envoltorio).
 */
function resolveLibrariesContainer(root: VdfNode): VdfNode {
  const wrapped = findBlock(root, LIBRARY_FOLDERS_ROOT_KEY);
  return wrapped ?? root;
}

/**
 * Convierte una entrada de biblioteca (un sub-bloque `"0" { path ... apps { } }`)
 * en un {@link LibraryEntry}. Los AppIDs del bloque `apps` se preservan en orden
 * de aparición, incluyendo duplicados (decisión 5).
 */
function toLibraryEntry(libraryBlock: VdfNode): LibraryEntry {
  const path = findString(libraryBlock, LIBRARY_PATH_KEY) ?? "";
  const appsBlock = findBlock(libraryBlock, LIBRARY_APPS_KEY);

  const apps: string[] = [];
  if (appsBlock) {
    for (const entry of appsBlock.entries) {
      // Las claves del bloque `apps` son los AppIDs (su valor es el tamaño, que
      // no se usa). Se preserva el orden y los duplicados.
      apps.push(entry.key);
    }
  }

  return { path, apps };
}

/**
 * Parsea el CONTENIDO de un `libraryfolders.vdf` a una lista de
 * {@link LibraryEntry}, preservando el orden de aparición de las bibliotecas.
 *
 * Ver el encabezado del archivo para la DECISIÓN DE FIRMA (opera sobre el
 * contenido, no sobre la ruta; el I/O de lectura es de la tarea 5.3) y las
 * decisiones de comportamiento del parser.
 *
 * @param content Texto completo del archivo `libraryfolders.vdf`.
 * @returns Bibliotecas en orden de aparición; `[]` si no hay ninguna.
 */
export function parseLibraryFolders(content: string): LibraryEntry[] {
  const root = parseVdf(content);
  const container = resolveLibrariesContainer(root);

  const libraries: LibraryEntry[] = [];
  for (const entry of container.entries) {
    // Cada biblioteca es una clave (índice "0", "1", ...) cuyo valor es un
    // sub-bloque. Se ignoran los pares clave-valor simples de nivel superior.
    if (typeof entry.value !== "string") {
      libraries.push(toLibraryEntry(entry.value));
    }
  }

  return libraries;
}
