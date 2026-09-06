import fc from "fast-check";

import { findGameLibrary, parseLibraryFolders } from "../src/main/domain/index.js";
import { propertyTest } from "./helpers/property.js";

/**
 * Property test de la selección de la Game_Library (Tarea 5.2).
 *
 * Property 1: Selección de la primera biblioteca con L4D2
 * **Validates: Requirements 1.5**
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EL GENERADOR PRODUCE VDF-TEXTO Y PASA POR EL PARSER REAL
 *
 * El requisito explícito de esta tarea es ejercitar el PIPELINE COMPLETO
 * `parseLibraryFolders` seguido de `findGameLibrary`, NO la selección aislada
 * sobre `LibraryEntry[]` ya parseadas. Por eso el arbitrary NO genera
 * estructuras parseadas: genera un MODELO ABSTRACTO de bibliotecas y a partir de
 * él (a) RENDERIZA un `libraryfolders.vdf` sintéticamente VÁLIDO y (b) COMPUTA
 * el resultado esperado. El test hace entonces:
 *
 *   expect(findGameLibrary(parseLibraryFolders(renderedVdf))).toBe(expected)
 *
 * De esta forma el parser real (tokenizador KeyValues + construcción de árbol) y
 * la política de selección se validan juntos, tal como se usan en producción.
 *
 * El `expected` se computa desde el MODELO abstracto (la lista de bibliotecas
 * con su flag "tiene 550"), que es una FUENTE INDEPENDIENTE del código bajo
 * prueba: NO se reimplementa `findGameLibrary` recorriendo `LibraryEntry[]`, se
 * deriva directamente del modelo generado.
 *
 * ---------------------------------------------------------------------------
 * ESTRATEGIA DE GENERACIÓN
 *
 * MODELO. Un caso es una lista ORDENADA de 0..n bibliotecas. Cada biblioteca
 * tiene:
 *   - `path`: ruta en disco.
 *   - `apps`: lista ORDENADA de AppIDs (strings), que incluye o no el literal
 *     "550" en una posición arbitraria (no siempre primero/único), mezclado con
 *     AppIDs de RUIDO ("440", "620", "228980", "570"). Puede estar vacía.
 *
 * DECISIONES para que el VDF renderizado sea válido y el `expected` inequívoco:
 *
 *   1. CHARSET SEGURO DE PATHS. Los `path` se generan con un charset acotado
 *      (letras, dígitos, espacio, ':', '\\', '/', '.', '-', '_', '(', ')') que
 *      NO incluye ninguno de los caracteres con escape especial del parser
 *      (`\`, `"`, salto de línea, tab). Ojo: la barra invertida SÍ está en el
 *      charset porque es habitual en rutas Windows, y al RENDERIZAR se escapa
 *      como `\\` para que el parser la devuelva tal cual. Ningún otro carácter
 *      del charset necesita escape. Así el `path` esperado es EXACTAMENTE el que
 *      el parser reconstruye. (Se evita generar `"` y saltos de línea a
 *      propósito: no aportan cobertura sobre la política de SELECCIÓN, que es lo
 *      que prueba la Property 1, y complicarían el escaping sin beneficio.)
 *
 *   2. PATHS ÚNICOS. Para que la aserción `.toBe(expected)` sea inequívoca aun
 *      cuando varias bibliotecas contengan "550", cada `path` se hace único
 *      prefijándolo con su índice (`L{i}|...`). Con paths únicos, el `path` de
 *      la primera lib con "550" no puede coincidir con el de otra lib, de modo
 *      que un resultado correcto identifica sin ambigüedad esa primera lib.
 *
 *   3. LITERAL "550" EXACTO. El ruido NUNCA incluye variantes tipo "0550" ni
 *      "5500": el conjunto de AppIDs de ruido está fijado y no colisiona con el
 *      literal "550". La presencia de L4D2 se controla con un flag booleano por
 *      biblioteca; solo cuando ese flag es true se inserta el token EXACTO
 *      "550" en una posición arbitraria de `apps`.
 *
 *   4. RENDERIZADO. Se envuelve todo en `"libraryfolders" { "0" { ... } "1" { ...
 *      } }`, usando índices "0","1",... como claves de biblioteca. Cada
 *      biblioteca emite `"path" "<escapado>"` y un bloque `"apps" { "<appid>"
 *      "<size>" ... }`. El `size` es irrelevante para el pipeline (el parser
 *      solo conserva las CLAVES de `apps`), así que se usa un valor fijo.
 *
 * COBERTURA de casos exigidos:
 *   - 0 bibliotecas: `fc.array` con `minLength: 0` -> VDF `"libraryfolders" { }`.
 *   - bibliotecas con `apps` vacío: `appsArb` permite lista vacía.
 *   - "550" en posición arbitraria y con ruido alrededor: se inserta en un
 *     índice arbitrario dentro de la lista de ruido.
 *   - orden de aparición variado: el orden de las bibliotecas y de los AppIDs es
 *     el que fast-check genere; la política "primera en orden de aparición" se
 *     valida contra el `expected` computado con ese mismo orden.
 * ---------------------------------------------------------------------------
 */

/** Literal EXACTO del AppID de L4D2 (coincide con `L4D2_APP_ID` del dominio). */
const L4D2 = "550";

/**
 * AppIDs de RUIDO. Se fija un conjunto que NO contiene "550" ni variantes que
 * pudieran confundirse con él (p. ej. "0550", "5500"), para que el flag "tiene
 * 550" del modelo sea la ÚNICA fuente de presencia de L4D2.
 */
const NOISE_APP_IDS = ["440", "620", "228980", "570", "730", "240"] as const;

/**
 * Charset SEGURO para paths: sin `"` ni saltos de línea/tab. Incluye `\` (rutas
 * Windows), que al renderizar se escapa como `\\`. Ningún otro carácter necesita
 * escape, así que el path parseado vuelve idéntico al generado.
 */
const PATH_CHARSET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 :\\/.-_()";

/** Un fragmento de path con el charset seguro (puede ser vacío). */
const pathFragmentArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(...PATH_CHARSET.split("")),
    { minLength: 0, maxLength: 40 },
  )
  .map((chars) => chars.join(""));

/** Modelo abstracto de una biblioteca antes de asignarle índice/unicidad. */
interface LibraryModel {
  /** Fragmento de path (se hará único al renderizar prefijando el índice). */
  pathFragment: string;
  /** AppIDs de ruido de esta biblioteca, en orden. */
  noise: string[];
  /** Si true, se insertará el literal "550" en `insertAt`. */
  hasL4D2: boolean;
  /** Posición (0..noise.length) donde insertar "550" si `hasL4D2`. */
  insertAt: number;
}

/** Arbitrary de una biblioteca del modelo. */
const libraryModelArb: fc.Arbitrary<LibraryModel> = fc
  .record({
    pathFragment: pathFragmentArb,
    noise: fc.array(fc.constantFrom(...NOISE_APP_IDS), {
      minLength: 0,
      maxLength: 5,
    }),
    hasL4D2: fc.boolean(),
    // insertAt se acota luego a [0, noise.length] al construir los apps.
    insertAt: fc.nat(),
  });

/** Caso completo: lista ordenada de 0..n bibliotecas. */
const scenarioArb: fc.Arbitrary<LibraryModel[]> = fc.array(libraryModelArb, {
  minLength: 0,
  maxLength: 8,
});

/**
 * Escapa un valor para emitirlo entre comillas en el VDF renderizado. Con el
 * charset seguro solo hace falta escapar la barra invertida (`\` -> `\\`), que
 * el parser volverá a colapsar a un único `\`.
 */
function escapeVdfValue(value: string): string {
  return value.replace(/\\/g, "\\\\");
}

/** Construye la lista ORDENADA de AppIDs de una biblioteca a partir del modelo. */
function buildApps(model: LibraryModel): string[] {
  if (!model.hasL4D2) {
    return [...model.noise];
  }
  const apps = [...model.noise];
  // Posición estable en [0, apps.length] para insertar el "550" exacto.
  const at = apps.length === 0 ? 0 : model.insertAt % (apps.length + 1);
  apps.splice(at, 0, L4D2);
  return apps;
}

/**
 * Renderiza el `libraryfolders.vdf` VÁLIDO a partir del modelo. El `path` de cada
 * biblioteca se hace ÚNICO prefijándolo con su índice (`L{i}|...`).
 */
function renderVdf(models: LibraryModel[]): string {
  const lines: string[] = ['"libraryfolders"', "{"];
  models.forEach((model, index) => {
    const uniquePath = `L${index}|${model.pathFragment}`;
    const apps = buildApps(model);
    lines.push(`  "${index}"`, "  {");
    lines.push(`    "path"  "${escapeVdfValue(uniquePath)}"`);
    lines.push('    "apps"', "    {");
    for (const appId of apps) {
      // El "size" es irrelevante: el parser solo conserva las claves de `apps`.
      lines.push(`      "${appId}"  "1"`);
    }
    lines.push("    }", "  }");
  });
  lines.push("}");
  return lines.join("\n");
}

/**
 * Computa el resultado ESPERADO desde el MODELO (fuente independiente del código
 * bajo prueba): el `path` único de la PRIMERA biblioteca con `hasL4D2`, o `null`.
 */
function expectedGameLibrary(models: LibraryModel[]): string | null {
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    if (model !== undefined && model.hasL4D2) {
      return `L${index}|${model.pathFragment}`;
    }
  }
  return null;
}

propertyTest(
  1,
  "Selección de la primera biblioteca con L4D2",
  fc.property(scenarioArb, (models) => {
    const vdf = renderVdf(models);
    const expected = expectedGameLibrary(models);

    // Pipeline COMPLETO: parseo real + selección.
    const actual = findGameLibrary(parseLibraryFolders(vdf));

    return actual === expected;
  }),
);
