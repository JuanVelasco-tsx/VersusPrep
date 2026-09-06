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

// ===========================================================================
// Property 2 (Tarea 5.4)
//
// Feature: l4d2-versus-addon-manager, Property 2: Ninguna ruta se persiste sin
// verificación en disco
// **Validates: Requirements 1.9, 1.11, 1.13**
//
// ---------------------------------------------------------------------------
// QUÉ INVARIANTE PRUEBA
//
// Es IMPOSIBLE obtener un resultado `ready` (estado "listo para persistir", AC
// 1.13) sin que la verificación en disco (AC 1.9) haya confirmado las 5 rutas
// requeridas, y toda ruta suplida manualmente pasa por re-verificación (AC
// 1.11). El test ejerce el PIPELINE REAL `detector.detect()` (registro +
// parseo del VDF + findGameLibrary + derivePaths + verifyPathsOnDisk +
// selección manual con re-verificación) contra un FileSystemProbe mockeado, y
// usa ese mismo FS como ORÁCULO INDEPENDIENTE: nunca reimplementa `detect` ni
// `verifyPathsOnDisk`, solo consulta `exists()` sobre las rutas del resultado.
//
// ---------------------------------------------------------------------------
// ESTRATEGIA DE GENERACIÓN
//
// El generador varía el estado del FS mockeado y las respuestas de selección
// manual, cubriendo tanto el camino "VDF con 550 → deriva rutas → verifica" como
// el camino "usuario da Game_Root", con foco fuerte en la verificación de las 5
// rutas requeridas y su selección manual/cancelación:
//
//   1. RUTAS REQUERIDAS EXISTENTES. Se genera un subconjunto ARBITRARIO de las 5
//      rutas requeridas derivadas (`derivePaths(LIB, STEAM)`) que existen en el
//      FS: incluye "ninguna", "todas" y parciales. gameRoot/left4dead2Dir se
//      añaden como existentes solo si su bandera lo indica; el resto (workshop,
//      vpkTool, gameinfo, modsvs) por bandera individual.
//
//   2. CAMINO DE DERIVACIÓN. `useVdf` decide el camino:
//        - true  → el FS entrega un `libraryfolders.vdf` con 550 en LIB, de modo
//          que `detect` deriva las rutas desde la Game_Library (AC 1.7) y las
//          verifica (camino principal de la Property 2).
//        - false → el VDF está AUSENTE (readTextFile ok:false); `detect` pide el
//          Game_Root. El usuario puede darlo (existente/inexistente) o cancelar,
//          ejercitando el camino manual → verificación.
//
//   3. RESPUESTAS DE SELECCIÓN MANUAL (colas FINITAS). Para cada tipo de request
//      (`steam-path` no se ejercita aquí porque el registro SIEMPRE da STEAM;
//      `game-root` y cada `required-path`) se programa una COLA FINITA de
//      respuestas. Cada respuesta es una de:
//        (i)   cancelación,
//        (ii)  selección de una ruta que NO existe en el FS (fuerza el reintento
//              de #requestExisting por AC 1.12), o
//        (iii) selección de una ruta que SÍ existe en el FS.
//      GARANTÍA ANTI-BUCLE: el MockManual consume la cola y, AL AGOTARSE,
//      CANCELA. Como #requestExisting solo reintenta ante `selected`-inexistente
//      y las colas son finitas, tras a lo sumo N iteraciones el provider devuelve
//      `cancelled` y el bucle termina. Así el test nunca cuelga.
//
//   4. RUTAS MANUALES CANDIDATAS. Las rutas "existentes" ofrecidas manualmente se
//      toman del conjunto de rutas requeridas que el generador marcó como
//      existentes (para (iii)); las "inexistentes" son literales fijos fuera del
//      set (para (ii)). Para game-root existente se usa GAME_ROOT solo si el
//      generador lo marcó existente.
//
// ---------------------------------------------------------------------------
// ORÁCULO Y PROPIEDADES VERIFICADAS (consultando el FS mock, no el código)
//
//   (a) NUNCA ready sin las 5 rutas realmente existentes: si `ready`, las 5
//       rutas de `result.paths` existen en el FS (via `exists` del mock),
//       `verification.allPresent === true` y `verification.missing === []`.
//   (b) `missing` refleja lo ausente: para el PathVerification del resultado,
//       toda ruta requerida cuyo valor final NO existe está en `missing`, y
//       ninguna existente está en `missing`.
//   (c) Ruta manual inexistente nunca produce ready: en `ready`, ninguna ruta
//       requerida final es reportada inexistente por el FS (refuerzo de (a)); y
//       si el resultado es `ready`, toda ruta final pasó la re-verificación.
// ---------------------------------------------------------------------------

import { PathDetector } from "../src/main/domain/index.js";
import type {
  FileReadResult,
  FileSystemProbe,
  GamePaths,
  ManualPathProvider,
  ManualPathRequest,
  ManualPathResponse,
  PathVerification,
  RegistryReader,
  RequiredPathKey,
} from "../src/main/domain/index.js";

// Rutas de referencia (Game_Library en disco D:, Steam en C:); coinciden con las
// del unit test para reusar la topología real de derivePaths.
const P2_STEAM = "C:\\Program Files (x86)\\Steam";
const P2_LIB = "D:\\SteamLibrary";
const P2_VDF_PATH = `${P2_STEAM}\\steamapps\\libraryfolders.vdf`;

/** VDF con 550 en la biblioteca D: (otro disco que Steam en C:). */
function p2VdfWithL4D2(): string {
  return `
"libraryfolders"
{
    "0" { "path" "${P2_STEAM.replace(/\\/g, "\\\\")}" "apps" { "440" "1" } }
    "1" { "path" "${P2_LIB.replace(/\\/g, "\\\\")}" "apps" { "550" "2" } }
}
`;
}

/** Registro mínimo que SIEMPRE devuelve STEAM (no ejercitamos el fallo de registro aquí). */
class P2Registry implements RegistryReader {
  async readValue(): Promise<string | null> {
    return P2_STEAM;
  }
}

/** FS mockeado: un Set de rutas existentes + un mapa opcional de archivos de texto. */
class P2Fs implements FileSystemProbe {
  readonly existing: Set<string>;
  readonly #files: Map<string, string>;

  constructor(existing: Iterable<string>, files: Iterable<[string, string]> = []) {
    this.existing = new Set(existing);
    this.#files = new Map(files);
  }

  async readTextFile(path: string): Promise<FileReadResult> {
    const content = this.#files.get(path);
    return content === undefined ? { ok: false } : { ok: true, content };
  }

  async exists(path: string): Promise<boolean> {
    return this.existing.has(path);
  }
}

/**
 * ManualPathProvider con colas FINITAS por tipo de request; al agotarse la cola
 * correspondiente, CANCELA. Esto garantiza terminación de #requestExisting.
 */
class P2Manual implements ManualPathProvider {
  #steamPath: ManualPathResponse[];
  #gameRoot: ManualPathResponse[];
  #required: Map<string, ManualPathResponse[]>;

  constructor(opts: {
    steamPath?: ManualPathResponse[];
    gameRoot?: ManualPathResponse[];
    required?: Map<string, ManualPathResponse[]>;
  }) {
    this.#steamPath = [...(opts.steamPath ?? [])];
    this.#gameRoot = [...(opts.gameRoot ?? [])];
    this.#required = new Map();
    for (const [k, v] of opts.required ?? []) {
      this.#required.set(k, [...v]);
    }
  }

  async requestPath(request: ManualPathRequest): Promise<ManualPathResponse> {
    if (request.kind === "steam-path") {
      return this.#steamPath.shift() ?? { kind: "cancelled" };
    }
    if (request.kind === "game-root") {
      return this.#gameRoot.shift() ?? { kind: "cancelled" };
    }
    const list = this.#required.get(request.pathKey) ?? [];
    return list.shift() ?? { kind: "cancelled" };
  }
}

/**
 * Las 5 rutas requeridas en orden canónico (AC 1.9). Se declara LOCALMENTE en el
 * test (no se importa del dominio) para no acoplar el test a un export interno;
 * el orden coincide con `RequiredPathKey`/`REQUIRED_PATH_KEYS` del dominio y el
 * tipado `readonly RequiredPathKey[]` obliga a que cualquier cambio en las claves
 * requeridas rompa la compilación aquí.
 */
const REQUIRED_KEYS: readonly RequiredPathKey[] = [
  "gameRoot",
  "workshopFolder",
  "vpkToolPath",
  "gameInfoFile",
  "modsvsFolder",
];

/** Deriva las 5 rutas requeridas desde LIB/STEAM usando la topología real. */
function requiredPathsOf(detector: PathDetector): Record<RequiredPathKey, string> {
  const paths: GamePaths = detector.derivePaths(P2_LIB, P2_STEAM);
  const out = {} as Record<RequiredPathKey, string>;
  for (const key of REQUIRED_KEYS) {
    out[key] = paths[key];
  }
  return out;
}

// Rutas "inexistentes" fijas para respuestas manuales tipo (ii): NUNCA se añaden
// al Set de existentes del FS, así fuerzan el reintento de AC 1.12.
const NONEXISTENT_MANUAL_PATHS = [
  "Z:\\nope\\a",
  "Z:\\nope\\b",
  "Z:\\nope\\c",
] as const;

/** Arbitrary de una respuesta manual, parametrizada por rutas existentes candidatas. */
function manualResponseArb(
  existentCandidates: string[],
): fc.Arbitrary<ManualPathResponse> {
  const options: fc.Arbitrary<ManualPathResponse>[] = [
    fc.constant<ManualPathResponse>({ kind: "cancelled" }),
    fc
      .constantFrom(...NONEXISTENT_MANUAL_PATHS)
      .map<ManualPathResponse>((path) => ({ kind: "selected", path })),
  ];
  if (existentCandidates.length > 0) {
    options.push(
      fc
        .constantFrom(...existentCandidates)
        .map<ManualPathResponse>((path) => ({ kind: "selected", path })),
    );
  }
  return fc.oneof(...options);
}

/** Cola FINITA de respuestas manuales (0..4 elementos). */
function manualQueueArb(existentCandidates: string[]): fc.Arbitrary<ManualPathResponse[]> {
  return fc.array(manualResponseArb(existentCandidates), { minLength: 0, maxLength: 4 });
}

interface P2Scenario {
  /** Qué rutas requeridas existen en el FS (subconjunto arbitrario). */
  existRequired: Record<RequiredPathKey, boolean>;
  /** true → FS entrega VDF con 550; false → VDF ausente (pide Game_Root). */
  useVdf: boolean;
  /** Cola finita de respuestas para game-root (solo relevante si !useVdf). */
  gameRootQueue: ManualPathResponse[];
  /** Colas finitas por cada required-path. */
  requiredQueues: Record<RequiredPathKey, ManualPathResponse[]>;
}

const boolByKeyArb: fc.Arbitrary<Record<RequiredPathKey, boolean>> = fc.record({
  gameRoot: fc.boolean(),
  workshopFolder: fc.boolean(),
  vpkToolPath: fc.boolean(),
  gameInfoFile: fc.boolean(),
  modsvsFolder: fc.boolean(),
});

/**
 * Construye el escenario. Necesita las rutas requeridas derivadas para poder
 * ofrecer, en las colas manuales, rutas EXISTENTES reales (las que el escenario
 * marcó como existentes). Por eso el arbitrary se arma sobre un detector fijo.
 */
function scenarioArbFor(required: Record<RequiredPathKey, string>): fc.Arbitrary<P2Scenario> {
  return boolByKeyArb.chain((existRequired) => {
    // Candidatas existentes para respuestas (iii): las rutas requeridas marcadas
    // como existentes. Se ofrecen como posibles selecciones manuales válidas.
    const existentCandidates = REQUIRED_KEYS.filter((k) => existRequired[k]).map(
      (k) => required[k],
    );
    return fc.record({
      existRequired: fc.constant(existRequired),
      useVdf: fc.boolean(),
      gameRootQueue: manualQueueArb(existentCandidates),
      requiredQueues: fc.record({
        gameRoot: manualQueueArb(existentCandidates),
        workshopFolder: manualQueueArb(existentCandidates),
        vpkToolPath: manualQueueArb(existentCandidates),
        gameInfoFile: manualQueueArb(existentCandidates),
        modsvsFolder: manualQueueArb(existentCandidates),
      }),
    });
  });
}

// Detector "plantilla" solo para derivar las rutas requeridas (derivePaths es puro).
const templateDetector = new PathDetector({
  registry: new P2Registry(),
  fs: new P2Fs([]),
  manual: new P2Manual({}),
});
const REQUIRED = requiredPathsOf(templateDetector);

propertyTest(
  2,
  "Ninguna ruta se persiste sin verificación en disco",
  fc.asyncProperty(scenarioArbFor(REQUIRED), async (scenario) => {
    // FS: rutas requeridas existentes según el escenario. Si useVdf, además
    // entrega el VDF con 550 en LIB (para derivar por Game_Library).
    const existing = REQUIRED_KEYS.filter((k) => scenario.existRequired[k]).map(
      (k) => REQUIRED[k],
    );
    const files: Array<[string, string]> = scenario.useVdf
      ? [[P2_VDF_PATH, p2VdfWithL4D2()]]
      : [];
    const fs = new P2Fs(existing, files);

    const requiredQueueMap = new Map<string, ManualPathResponse[]>(
      REQUIRED_KEYS.map((k) => [k, scenario.requiredQueues[k]]),
    );

    const manual = new P2Manual({
      gameRoot: scenario.gameRootQueue,
      required: requiredQueueMap,
    });

    const detector = new PathDetector({
      registry: new P2Registry(),
      fs,
      manual,
    });

    const result = await detector.detect();

    // Oráculo independiente: consulta directa al FS mock.
    const existsInFs = (p: string): boolean => fs.existing.has(p);

    if (result.kind === "ready") {
      // (a) Las 5 rutas requeridas finales existen realmente en el FS.
      for (const key of REQUIRED_KEYS) {
        if (!existsInFs(result.paths[key])) {
          return false;
        }
      }
      // (a) verification consistente.
      if (!result.verification.allPresent) return false;
      if (result.verification.missing.length !== 0) return false;
      // (b)+(c) reforzado: ninguna ruta requerida final es inexistente en el FS.
      const anyMissing = REQUIRED_KEYS.some((k) => !existsInFs(result.paths[k]));
      if (anyMissing) return false;
      return true;
    }

    // needs-manual: si trae paths+verification (required-path-missing), el
    // oráculo debe coincidir con `missing` (b).
    if (result.paths !== undefined && result.verification !== undefined) {
      const v: PathVerification = result.verification;
      for (const key of REQUIRED_KEYS) {
        const existsNow = existsInFs(result.paths[key]);
        const inMissing = v.missing.includes(key);
        if (existsNow && inMissing) return false; // existente jamás en missing
        if (!existsNow && !inMissing) return false; // ausente siempre en missing
      }
      // Un needs-manual con verificación no puede tener allPresent true.
      if (v.allPresent) return false;
    }
    // (c) si el resultado NO es ready, no hay nada que "persistir": OK.
    return true;
  }),
);
