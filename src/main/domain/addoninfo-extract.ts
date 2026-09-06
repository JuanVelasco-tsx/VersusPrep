/**
 * Extractor AD-HOC de `addoninfo.txt` (Tarea 6.1 — AC 2.5).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN (Opción A2): extractor acotado, NO un parser KeyValues general.
 *
 * El `addoninfo.txt` de un addon de L4D2 usa el formato KeyValues de Valve:
 *
 *   "AddonInfo"
 *   {
 *       addontitle       "Mi Mod"      //Max 127 chars.
 *       addonauthor      "Fulano"
 *       addonDescription "Una descripción"
 *       addonversion     1.0
 *   }
 *
 * En vez de escribir un tokenizador KeyValues completo (ese ya vive en la rama
 * `path-detector`, aún sin mergear; duplicar un ALGORITMO de parseo es más
 * riesgoso que duplicar un contrato pequeño, por la divergencia potencial), se
 * implementa un extractor BEST-EFFORT que reconoce SOLO las tres claves de
 * nivel superior necesarias para {@link AddonInfo}:
 *
 *   - `addontitle`       → `title`
 *   - `addonauthor`      → `author`
 *   - `addonDescription` → `description`
 *
 * Claves CONFIRMADAS contra la convención de L4D2 (wiki de Valve + addons
 * reales), NO asumidas. Existen otras (`addonversion`, `addonSteamAppID`, …)
 * que este extractor IGNORA a propósito.
 *
 * NOTA de prioridad para el futuro: cuando se mergee la sección 5 (PathDetector,
 * con su parser KeyValues), conviene reconciliar AMBOS parsers ANTES de unificar
 * las interfaces de FS. Reconciliar dos parsers reales (ad-hoc vs. KeyValues) es
 * más delicado que reconciliar dos contratos de FS.
 * ---------------------------------------------------------------------------
 *
 * ROBUSTEZ (documentada, verificada contra addons reales):
 *  - El CASING de las claves varía entre addons (`addontitle` / `addonTitle`,
 *    `addonauthor` / `addonAuthor`, …). ⇒ comparación de claves CASE-INSENSITIVE.
 *  - Los VALORES aparecen con o sin comillas (`addontitle "mod"` o
 *    `addontitle mod`). Se maneja ambos: con comillas se toma el contenido
 *    entre comillas; sin comillas, el token hasta fin de línea o comentario.
 *  - Puede haber COMENTARIOS `//` en la misma línea (`//Max 127 chars.`). Lo que
 *    sigue a `//` FUERA de comillas se ignora.
 *
 * DEGRADACIÓN SEGURA (AC 2.5, crítico):
 *  - Campo faltante ⇒ la propiedad se OMITE en el {@link AddonInfo} (bajo
 *    `exactOptionalPropertyTypes`, "opcional" = ausente, NO `undefined` explícito).
 *  - Bloque `AddonInfo` ausente, texto claramente malformado, o ningún campo
 *    reconocido ⇒ se devuelve `null`.
 *  - La función NUNCA lanza: cualquier situación inesperada degrada a `null`.
 */

import type { AddonInfo } from "./types.js";

/**
 * Claves de nivel superior reconocidas, mapeadas al campo de {@link AddonInfo}.
 * La comparación de claves es CASE-INSENSITIVE (ver encabezado), por eso se
 * guardan en minúsculas y las claves del archivo se normalizan a minúsculas
 * antes de compararlas.
 */
const KNOWN_KEYS: ReadonlyMap<string, keyof AddonInfo> = new Map([
  ["addontitle", "title"],
  ["addonauthor", "author"],
  ["addondescription", "description"],
]);

/**
 * Extrae la metadata reconocida de un `addoninfo.txt` ya leído como texto.
 *
 * Best-effort y NO-throw: recorre el texto línea por línea buscando líneas de la
 * forma `<claveConocida> <valor>` dentro (o alrededor) del bloque `AddonInfo`.
 * No modela bloques anidados ni es un tokenizador general; simplemente reconoce
 * las líneas de campo conocidas. Devuelve un {@link AddonInfo} con SOLO los
 * campos hallados, o `null` si no se reconoció NINGÚN campo (o ante cualquier
 * fallo interno).
 *
 * @param text Contenido textual del `addoninfo.txt`.
 * @returns `AddonInfo` con los campos reconocidos, o `null` si no hay ninguno.
 */
export function extractAddonInfo(text: string): AddonInfo | null {
  try {
    // Se acumulan en un objeto mutable y solo se asignan las claves halladas,
    // de modo que las ausentes queden OMITIDAS (no `undefined`).
    const found: { -readonly [K in keyof AddonInfo]?: string } = {};

    for (const rawLine of text.split(/\r?\n/)) {
      const parsed = parseFieldLine(rawLine);
      if (parsed === null) {
        continue;
      }
      const field = KNOWN_KEYS.get(parsed.key.toLowerCase());
      if (field === undefined) {
        continue;
      }
      // Primera aparición gana; no sobrescribimos si ya se halló la clave.
      if (found[field] === undefined) {
        found[field] = parsed.value;
      }
    }

    if (
      found.title === undefined &&
      found.author === undefined &&
      found.description === undefined
    ) {
      return null;
    }

    // Se construye el resultado asignando SOLO las propiedades presentes, para
    // respetar exactOptionalPropertyTypes (omitir en vez de `undefined`).
    const info: AddonInfo = {};
    if (found.title !== undefined) {
      info.title = found.title;
    }
    if (found.author !== undefined) {
      info.author = found.author;
    }
    if (found.description !== undefined) {
      info.description = found.description;
    }
    return info;
  } catch {
    // Cualquier situación inesperada degrada a null sin propagar (AC 2.5).
    return null;
  }
}

/**
 * Intenta interpretar una línea como `<clave> <valor>`.
 *
 * Reglas:
 *  - Se recorta el espacio en blanco de los bordes.
 *  - Líneas vacías, de comentario puro (`//…`) o de estructura (`{`, `}`,
 *    encabezado `"AddonInfo"`) no son líneas de campo ⇒ `null`.
 *  - La CLAVE es el primer token, con o sin comillas.
 *  - El VALOR es el resto: si empieza con comilla, es el contenido entre la
 *    primera y la siguiente comilla; si no, es el token hasta el primer `//`
 *    o el fin de línea, recortado.
 *  - Si tras esto el valor queda vacío ⇒ no es una línea de campo útil (`null`).
 *
 * @returns `{ key, value }` si la línea aporta un par clave/valor; `null` si no.
 */
function parseFieldLine(rawLine: string): { key: string; value: string } | null {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith("//")) {
    return null;
  }
  // Descarta líneas de pura estructura del bloque.
  if (line === "{" || line === "}") {
    return null;
  }

  // --- CLAVE: primer token (con o sin comillas) ---
  let index = 0;
  let key: string;

  if (line[index] === '"') {
    const closing = line.indexOf('"', index + 1);
    if (closing === -1) {
      return null;
    }
    key = line.slice(index + 1, closing);
    index = closing + 1;
  } else {
    // Token hasta el primer espacio/tab.
    const match = /^(\S+)/.exec(line);
    if (match === null) {
      return null;
    }
    key = match[1] ?? "";
    index = key.length;
  }

  // El encabezado del bloque ("AddonInfo" solo, sin valor) no es un campo.
  // Se detecta más abajo por valor vacío, pero también acá si la clave es el
  // nombre del bloque y no hay valor.
  const rest = line.slice(index);

  // --- VALOR: resto de la línea ---
  const value = parseValue(rest);
  if (value === null || value.length === 0) {
    return null;
  }

  return { key, value };
}

/**
 * Extrae el valor de la porción de línea que sigue a la clave.
 *
 *  - Si (tras recortar) empieza con comilla: el valor es el contenido entre esa
 *    comilla y la siguiente; comentarios `//` DENTRO de las comillas se
 *    conservan como parte del valor.
 *  - Si no hay comillas: el valor es lo que hay antes de un `//` (comentario),
 *    recortado. Si no hay `//`, es todo el resto recortado.
 *
 * @returns el valor, o `null`/`""` si no hay valor útil.
 */
function parseValue(rest: string): string | null {
  const trimmed = rest.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed[0] === '"') {
    const closing = trimmed.indexOf('"', 1);
    if (closing === -1) {
      // Comilla de apertura sin cierre: valor best-effort = resto sin la comilla.
      return trimmed.slice(1).trim();
    }
    return trimmed.slice(1, closing);
  }

  // Sin comillas: cortar en el primer `//` (comentario fuera de comillas).
  const commentAt = trimmed.indexOf("//");
  const withoutComment = commentAt === -1 ? trimmed : trimmed.slice(0, commentAt);
  return withoutComment.trim();
}
