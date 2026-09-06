import { expect, test } from "vitest";
import fc from "fast-check";

import { AddonScanner, VpkTool } from "../src/main/domain/index.js";
import type {
  AddonFileSystem,
  CommandResult,
  CommandRunner,
  DirEntry,
} from "../src/main/domain/index.js";
import { MIN_NUM_RUNS, propertyName } from "./helpers/property.js";

/**
 * Property tests del AddonScanner (Tareas 6.2 y 6.3).
 *
 * Cubre las Correctness Properties 3 y 4 del diseño, cada una como un test
 * independiente vía `propertyTest`. Ambas ejercitan `AddonScanner.scan` con un
 * {@link AddonFileSystem} MOCKEADO en memoria y un {@link VpkTool} REAL montado
 * sobre un {@link CommandRunner} que responde vacío a `vpk l` (así `info` queda
 * `null` y la metadata NO interfiere: el foco de estas propiedades es la lista
 * de `.vpk` de nivel superior y la asociación del Addon_Cover, no el addoninfo).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN — Mocks LOCALES mínimos en este archivo (no se importan los de
 * `test/addon-scanner.test.ts`). Se replican versiones mínimas de `MockFs`,
 * `ScriptedRunner` y `buildScanner` para no acoplar el archivo de property tests
 * a los unit tests ni forzar exports adicionales. Los mocks aquí son más chicos
 * porque estas propiedades no necesitan escriturar addoninfo.
 *
 * DECISIÓN — El VALOR ESPERADO se computa desde el MODELO generado (la lista de
 * entradas y el conjunto de covers presentes), NO desde el código bajo prueba.
 * El modelo es la FUENTE DE VERDAD independiente: se reconstruye el resultado
 * esperado (ids, vpkPath, coverPath) aplicando las reglas del contrato con una
 * implementación separada del `AddonScanner`. Si el escáner y el modelo
 * coinciden para toda entrada generada, la propiedad se sostiene.
 * ---------------------------------------------------------------------------
 */

const VPK_EXE = "C:\\game\\bin\\vpk.exe";
const TEMP = "C:\\tmp\\scan";

// ---------------------------------------------------------------------------
// Mocks locales mínimos.
// ---------------------------------------------------------------------------

/**
 * Ejecutor de comandos mockeado. Para estas propiedades la metadata es
 * irrelevante: `vpk l` devuelve stdout vacío (⇒ ningún addoninfo.txt en el
 * listado ⇒ `info: null`), y `vpk x` nunca se invoca. Se responde exit 0 para
 * no disparar `VpkToolError`.
 */
class EmptyRunner implements CommandRunner {
  run(_executable: string, _args: readonly string[]): Promise<CommandResult> {
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }
}

/**
 * FS mockeado en memoria: `entries` mapea directorio → entradas de nivel
 * superior; `existing` es el conjunto de rutas que existen (se usa para el
 * `<id>.jpg`). `readTextFile`/`ensureDir` no se ejercitan aquí (list vacío).
 */
class MockFs implements AddonFileSystem {
  readonly entries = new Map<string, DirEntry[]>();
  readonly existing = new Set<string>();

  listEntries(dir: string): Promise<DirEntry[]> {
    return Promise.resolve(this.entries.get(dir) ?? []);
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.existing.has(path));
  }

  readTextFile(path: string): Promise<string> {
    return Promise.reject(new Error(`ENOENT: ${path}`));
  }

  ensureDir(_dir: string): Promise<void> {
    return Promise.resolve();
  }
}

const buildScanner = (fs: MockFs): AddonScanner =>
  new AddonScanner(fs, new VpkTool(new EmptyRunner(), VPK_EXE), TEMP);

/**
 * Réplica INDEPENDIENTE de la regla de join de rutas de `addon-scanner.ts`
 * (`joinWindowsPath`): recorta separadores finales del directorio y concatena
 * `\` + nombre. Es la fuente de verdad del modelo para reconstruir el esperado
 * sin llamar al código bajo prueba.
 */
const joinWin = (dir: string, name: string): string =>
  `${dir.replace(/[\\/]+$/, "")}\\${name}`;

// ---------------------------------------------------------------------------
// Property 3 (Tarea 6.2)
// ---------------------------------------------------------------------------

/**
 * Feature: l4d2-versus-addon-manager, Property 3: El escaneo incluye exactamente
 * los `.vpk` de nivel superior.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3**
 *
 * ESTRATEGIA DE GENERACIÓN
 *
 * Se genera una carpeta Workshop con una MEZCLA ARBITRARIA de entradas de nivel
 * superior a partir de un `baseName` ÚNICO por entrada (ver más abajo):
 *   - archivos `.vpk` con casing arbitrario de la extensión (`.vpk`, `.VPK`,
 *     `.Vpk`, ...) para ejercitar el match case-insensitive del AC 2.1;
 *   - archivos `.jpg`;
 *   - archivos con OTRAS extensiones (`.txt`, `.bin`, ...) y SIN extensión;
 *   - SUBDIRECTORIOS (`isDirectory: true`), incluidos algunos cuyo nombre
 *     TERMINA en `.vpk` (p. ej. `foo.vpk`) para verificar que un directorio
 *     NUNCA cuenta como addon aunque su nombre parezca un vpk (AC 2.2).
 *
 * DECISIÓN sobre ids/nombres ÚNICOS: cada entrada se construye a partir de un
 * `baseName` tomado de un conjunto de bases DISTINTAS (`fc.uniqueArray`), de modo
 * que dos `.vpk` nunca compartan el mismo `id`. Esto refleja la realidad (en un
 * mismo directorio no pueden coexistir dos archivos con idéntico nombre) y hace
 * inequívocas las aserciones de CONJUNTO de ids y de conteo (sin duplicados que
 * enmascaren omisiones). El casing de la extensión varía por-entrada sin afectar
 * la unicidad del `id` (el `id` es el `baseName`, común a todas las variantes).
 *
 * El runner responde vacío a `vpk l`, así que `info` es siempre `null` y no
 * interfiere con lo que se verifica aquí.
 *
 * ASERCIONES (esperado computado desde el modelo, fuente independiente):
 *   (a) el CONJUNTO de `id`s devueltos es EXACTAMENTE el conjunto de baseNames
 *       de las entradas-ARCHIVO cuyo nombre termina en `.vpk` (case-insensitive).
 *       Ni subdirectorios (aunque se llamen `*.vpk`) ni otras extensiones.
 *   (b) NINGÚN resultado corresponde a un subdirectorio ni a un archivo de otra
 *       extensión (el conjunto de ids devueltos ⊆ ids esperados, sin extras).
 *   (c) cada `vpkPath` devuelto = join Windows de WORKSHOP + nombre ORIGINAL del
 *       archivo (con su casing de extensión original), reconstruido con `joinWin`.
 *   (d) la cantidad de addons = cantidad de archivos `.vpk` de nivel superior
 *       generados (sin duplicar, sin omitir).
 */

/** Extensiones "no-vpk" para archivos que deben ignorarse. */
const nonVpkExtension: fc.Arbitrary<string> = fc.constantFrom(
  ".jpg",
  ".txt",
  ".bin",
  ".nut",
  ".cfg",
  "", // sin extensión
);

/** Variantes de casing de la extensión `.vpk` (ejercita el case-insensitive). */
const vpkExtensionCasing: fc.Arbitrary<string> = fc.constantFrom(
  ".vpk",
  ".VPK",
  ".Vpk",
  ".vPk",
  ".vpK",
  ".VpK",
);

/**
 * Tipo de entrada a generar por cada baseName único. Se describe con un
 * `kind` para que el modelo pueda derivar tanto la `DirEntry` como el esperado.
 */
type EntrySpec =
  | { kind: "vpk-file"; casing: string }
  | { kind: "other-file"; ext: string }
  | { kind: "dir-plain" }
  | { kind: "dir-vpk-name"; casing: string };

const entrySpecArb: fc.Arbitrary<EntrySpec> = fc.oneof(
  vpkExtensionCasing.map((casing): EntrySpec => ({ kind: "vpk-file", casing })),
  nonVpkExtension.map((ext): EntrySpec => ({ kind: "other-file", ext })),
  fc.constant<EntrySpec>({ kind: "dir-plain" }),
  vpkExtensionCasing.map(
    (casing): EntrySpec => ({ kind: "dir-vpk-name", casing }),
  ),
);

/**
 * baseNames ÚNICOS: identificadores sin separadores de ruta, no vacíos y sin
 * espacios ambiguos al recortar. Se restringe el charset a alfanumérico + `_`/`-`
 * y `.` internos para nombres realistas de Workshop (ids numéricos, títulos), y
 * `fc.uniqueArray` garantiza que no se repitan (base = id inequívoco).
 */
const baseNameArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,20}$/)
  .filter((s) => s.length > 0);

/** Una lista de baseNames distintos; cada uno recibe un `EntrySpec`. */
const scenario = fc
  .uniqueArray(baseNameArb, { minLength: 0, maxLength: 40 })
  .chain((baseNames) =>
    fc
      .tuple(
        ...baseNames.map(() => entrySpecArb),
      )
      .map((specs) =>
        baseNames.map((baseName, i) => ({
          baseName,
          spec: specs[i] as EntrySpec,
        })),
      ),
  );

/** Deriva la `DirEntry` que se poblará en el FS a partir de baseName + spec. */
const toDirEntry = (baseName: string, spec: EntrySpec): DirEntry => {
  switch (spec.kind) {
    case "vpk-file":
      return { name: `${baseName}${spec.casing}`, isDirectory: false };
    case "other-file":
      return { name: `${baseName}${spec.ext}`, isDirectory: false };
    case "dir-plain":
      return { name: baseName, isDirectory: true };
    case "dir-vpk-name":
      return { name: `${baseName}${spec.casing}`, isDirectory: true };
  }
};

/**
 * NO-VACUIDAD (estilo Property 2 del PathDetector). Como `propertyTest` no
 * permite ejecutar código tras completar las iteraciones, se registra un
 * `test()` propio con el nombre canónico (`propertyName(3, ...)`) y numRuns
 * fijado en `MIN_NUM_RUNS`. Tras `fc.assert(...)` se afirma que los escenarios
 * NO triviales se ejercieron con frecuencia > 0 en las >=100 iteraciones.
 * Como la propiedad no falla, fast-check no hace shrinking y cada iteración
 * incrementa los contadores exactamente una vez.
 *
 * Valores observados (medición temporal con MIN_NUM_RUNS=100 iteraciones):
 *   mixedCount = 60, nonEmptyResultCount = 64, dirVpkNameCount = 62.
 * Los tres quedan holgadamente > 0 SIN necesidad de sesgar el generador: la
 * `entrySpecArb` reparte de forma pareja entre `vpk-file`, `other-file`,
 * `dir-plain` y `dir-vpk-name`, y `uniqueArray` produce listas de tamaño medio
 * suficiente para mezclar categorías casi siempre. No se ajustó el generador.
 */
test(
  propertyName(3, "El escaneo incluye exactamente los `.vpk` de nivel superior"),
  async () => {
    let mixedCount = 0;
    let nonEmptyResultCount = 0;
    let dirVpkNameCount = 0;

    await fc.assert(
      fc.asyncProperty(
        scenario,
        fc.string({ minLength: 0, maxLength: 30 }),
        async (items, workshopSuffix) => {
          // WORKSHOP arbitrario (con posible separador final) para ejercitar el
          // recorte de `joinWin`; se ancla en una raíz absoluta Windows.
          const WORKSHOP = `C:\\ws${workshopSuffix}`;

          const fs = new MockFs();
          const entries = items.map(({ baseName, spec }) =>
            toDirEntry(baseName, spec),
          );
          fs.entries.set(WORKSHOP, entries);

          // MODELO: los `.vpk` de nivel superior son SOLO las entradas-archivo cuyo
          // nombre termina en `.vpk` (case-insensitive). id = baseName; vpkPath =
          // join Windows del nombre ORIGINAL (con su casing de extensión).
          const expected = items
            .filter(({ spec }) => spec.kind === "vpk-file")
            .map(({ baseName, spec }) => {
              const casing = (spec as { kind: "vpk-file"; casing: string })
                .casing;
              return {
                id: baseName,
                vpkPath: joinWin(WORKSHOP, `${baseName}${casing}`),
              };
            });

          // Contadores de no-vacuidad (una vez por iteración).
          const hasTopLevelVpk = items.some(({ spec }) => spec.kind === "vpk-file");
          const hasNonVpk = items.some(
            ({ spec }) => spec.kind !== "vpk-file",
          );
          if (hasTopLevelVpk && hasNonVpk) mixedCount += 1;
          if (items.some(({ spec }) => spec.kind === "dir-vpk-name")) {
            dirVpkNameCount += 1;
          }

          const result = await buildScanner(fs).scan(WORKSHOP);

          if (result.length > 0) nonEmptyResultCount += 1;

          // (d) misma cantidad que archivos .vpk de nivel superior.
          if (result.length !== expected.length) return false;

          const expectedById = new Map(expected.map((e) => [e.id, e]));
          const resultIds = new Set<string>();

          for (const addon of result) {
            // (b) ningún resultado fuera del conjunto esperado (ni dirs ni otras exts).
            const exp = expectedById.get(addon.id);
            if (exp === undefined) return false;
            // (c) vpkPath = join Windows del nombre original.
            if (addon.vpkPath !== exp.vpkPath) return false;
            // ids no repetidos en el resultado.
            if (resultIds.has(addon.id)) return false;
            resultIds.add(addon.id);
          }

          // (a) el conjunto de ids devueltos es EXACTAMENTE el esperado (⊇ ya que
          //     tamaños iguales + ⊆ verificado arriba, pero se comprueba explícito).
          for (const e of expected) {
            if (!resultIds.has(e.id)) return false;
          }

          return true;
        },
      ),
      { numRuns: MIN_NUM_RUNS },
    );

    // No-vacuidad: los escenarios NO triviales se ejercieron con frecuencia > 0.
    expect(mixedCount).toBeGreaterThan(0);
    expect(nonEmptyResultCount).toBeGreaterThan(0);
    expect(dirVpkNameCount).toBeGreaterThan(0);
  },
);

// ---------------------------------------------------------------------------
// Property 4 (Tarea 6.3)
// ---------------------------------------------------------------------------

/**
 * Feature: l4d2-versus-addon-manager, Property 4: Asociación correcta de
 * Addon_Cover.
 *
 * **Validates: Requirements 2.4**
 *
 * ESTRATEGIA DE GENERACIÓN
 *
 * Se genera un conjunto de addons `.vpk` de nivel superior con ids ÚNICOS
 * (`fc.uniqueArray`, misma justificación que en Property 3: en un mismo dir no
 * pueden coexistir dos archivos con idéntico nombre, y la unicidad hace
 * inequívoca la asociación cover↔id). A cada addon se le asocia un booleano
 * `hasCover` arbitrario: si es `true`, se REGISTRA su `<id>.jpg` en
 * `MockFs.existing` (el cover existe junto al VPK); si es `false`, no se
 * registra (el cover no existe).
 *
 * RUIDO DELIBERADO — para verificar que la existencia de OTROS archivos no
 * afecta la asociación, se registran además en `MockFs.existing` rutas de:
 *   - `<otroId>.jpg` de ids que NO son addons (basenames distintos de los ids),
 *   - archivos con otras extensiones (`<id>.png`, `<id>.txt`) para algunos ids
 *     de addon SIN su `.jpg` (para confirmar que NO se confunden con el cover).
 * Nada de este ruido debe cambiar el `coverPath` resuelto por el escáner.
 *
 * El runner responde vacío a `vpk l` (info irrelevante, siempre `null`).
 *
 * ASERCIONES (esperado computado desde el modelo, fuente independiente):
 *   - para cada addon con `hasCover=true` → `coverPath` = join Windows de
 *     WORKSHOP + `<id>.jpg` (misma regla `joinWin`).
 *   - para cada addon con `hasCover=false` → `coverPath === null`.
 *   - (refuerzo) cuando `coverPath` no es null, apunta al `<id>.jpg` del PROPIO
 *     id del addon, no al de otro (con ids únicos, la igualdad exacta lo prueba).
 */

/** Un addon a generar: baseName único + si su `<id>.jpg` existe. */
interface CoverSpec {
  baseName: string;
  hasCover: boolean;
}

const coverScenario = fc
  .uniqueArray(baseNameArb, { minLength: 0, maxLength: 40 })
  .chain((baseNames) =>
    fc
      .tuple(...baseNames.map(() => fc.boolean()))
      .map((flags): CoverSpec[] =>
        baseNames.map((baseName, i) => ({
          baseName,
          hasCover: flags[i] as boolean,
        })),
      ),
  );

/** baseNames de ruido (para `<otroId>.jpg` que no corresponde a ningún addon). */
const noiseNamesArb: fc.Arbitrary<string[]> = fc.uniqueArray(baseNameArb, {
  minLength: 0,
  maxLength: 10,
});

/**
 * NO-VACUIDAD (estilo Property 2 del PathDetector). `test()` propio con el
 * nombre canónico (`propertyName(4, ...)`) y numRuns fijado en `MIN_NUM_RUNS`.
 * Tras `fc.assert(...)` se afirma que se ejercieron AMBOS casos —al menos un
 * cover presente y al menos uno ausente— con frecuencia > 0. Como la propiedad
 * no falla, no hay shrinking y cada iteración cuenta una vez.
 *
 * Valores observados (medición temporal con MIN_NUM_RUNS=100 iteraciones):
 *   withCoverCount = 80, withoutCoverCount = 79.
 * Ambos quedan holgadamente > 0 SIN sesgar el generador: `fc.boolean()` reparte
 * `hasCover` ~50/50 y `uniqueArray` produce listas de tamaño medio, así que casi
 * toda iteración tiene a la vez algún cover presente y algún cover ausente. No
 * se ajustó el generador.
 */
test(propertyName(4, "Asociación correcta de Addon_Cover"), async () => {
  let withCoverCount = 0;
  let withoutCoverCount = 0;

  await fc.assert(
    fc.asyncProperty(
      coverScenario,
      noiseNamesArb,
      fc.string({ minLength: 0, maxLength: 30 }),
      async (specs, noiseNames, workshopSuffix) => {
        const WORKSHOP = `C:\\ws${workshopSuffix}`;

        const fs = new MockFs();

        // Entradas: un `.vpk` (extensión canónica en minúscula) por addon.
        fs.entries.set(
          WORKSHOP,
          specs.map(({ baseName }) => ({
            name: `${baseName}.vpk`,
            isDirectory: false,
          })),
        );

        // Registrar los `<id>.jpg` de los addons con hasCover=true.
        for (const { baseName, hasCover } of specs) {
          if (hasCover) {
            fs.existing.add(joinWin(WORKSHOP, `${baseName}.jpg`));
          }
        }

        // RUIDO 1: `.jpg` de ids que NO son addons (no debe asociarse a nada).
        const addonIds = new Set(specs.map((s) => s.baseName));
        for (const noise of noiseNames) {
          if (!addonIds.has(noise)) {
            fs.existing.add(joinWin(WORKSHOP, `${noise}.jpg`));
          }
        }
        // RUIDO 2: otras extensiones para addons SIN cover (no deben contar como cover).
        for (const { baseName, hasCover } of specs) {
          if (!hasCover) {
            fs.existing.add(joinWin(WORKSHOP, `${baseName}.png`));
            fs.existing.add(joinWin(WORKSHOP, `${baseName}.txt`));
          }
        }

        // MODELO: coverPath esperado por id (join Windows de <id>.jpg si hasCover).
        const expectedCoverById = new Map<string, string | null>(
          specs.map(({ baseName, hasCover }) => [
            baseName,
            hasCover ? joinWin(WORKSHOP, `${baseName}.jpg`) : null,
          ]),
        );

        // Contadores de no-vacuidad (una vez por iteración).
        if (specs.some(({ hasCover }) => hasCover)) withCoverCount += 1;
        if (specs.some(({ hasCover }) => !hasCover)) withoutCoverCount += 1;

        const result = await buildScanner(fs).scan(WORKSHOP);

        if (result.length !== specs.length) return false;

        for (const addon of result) {
          if (!expectedCoverById.has(addon.id)) return false;
          const expectedCover = expectedCoverById.get(addon.id) ?? null;
          // coverPath exacto: ruta del PROPIO <id>.jpg cuando existe, o null.
          if (addon.coverPath !== expectedCover) return false;
        }

        return true;
      },
    ),
    { numRuns: MIN_NUM_RUNS },
  );

  // No-vacuidad: se ejercieron tanto covers presentes como ausentes.
  expect(withCoverCount).toBeGreaterThan(0);
  expect(withoutCoverCount).toBeGreaterThan(0);
});
