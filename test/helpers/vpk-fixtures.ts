/**
 * Generador de FIXTURES de VPK sintéticos para el test de integración de
 * `VpkTool` (tarea 3.1).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTOS FIXTURES NO SE VERSIONAN (contexto legal + técnico)
 *
 * Los binarios `.vpk` están EXCLUIDOS del repositorio por `.gitignore`
 * (`test/fixtures/**\/*.vpk` y `test/fixtures/vpk/generated/`). Ver
 * `test/fixtures/README.md`: redistribuir contenido de addons reales de la
 * Steam Workshop en un repo público tiene el mismo problema de términos de uso
 * que compartir un `pak01_dir.vpk` fusionado. Por eso lo que se versiona es
 * este GENERADOR (código), no los binarios. Cada máquina genera sus propios
 * `.vpk` sintéticos, con contenido DUMMY (bytes de relleno arbitrarios), nunca
 * copias de assets reales.
 *
 * IDEMPOTENCIA: los fixtures se generan bajo `test/fixtures/vpk/generated/`
 * SOLO si aún no existen (`ensureFixtures` chequea el `.vpk` de salida). Volver
 * a correr el test no re-empaqueta si el `.vpk` ya está.
 * ---------------------------------------------------------------------------
 *
 * QUÉ GENERA (dos fixtures, según la tarea 3.1):
 *
 *   1. FIXTURE GRANDE (`big.vpk`): una carpeta con MÁS de 200 archivos internos
 *      dummy, distribuidos en varias subcarpetas (`materials/`, `models/`,
 *      `sound/`) imitando SOLO EN FORMA el layout de un addon. Objetivo: al
 *      extraerlo, forzar que `batchInternalPaths` (2.3) parta la extracción en
 *      varios lotes y confirmar que NO ocurre el `exit -1` de pasar cientos de
 *      argumentos de una vez.
 *
 *   2. FIXTURE CON ESPACIOS (`spaced.vpk`): un fixture pequeño APARTE que
 *      contiene al menos un archivo interno con ESPACIOS en el nombre (p. ej.
 *      `materials/some model.vmt`), para poner a prueba el caveat de quoting
 *      documentado en el historial de la tarea 2.3. Se hace un fixture separado
 *      y pequeño (en vez de mezclarlo con el grande) para aislar el veredicto
 *      del caso de espacios: si algo falla ahí, se ve claramente que es por el
 *      nombre con espacios y no por el volumen de archivos.
 *
 * Nota sobre creación de directorios para `pack`: `vpk <carpeta>` empaqueta la
 * carpeta tal cual está en disco, así que el generador escribe primero el árbol
 * de archivos dummy y luego invoca `VpkTool.pack` sobre la carpeta raíz. El
 * `.vpk` resultante queda como `<carpeta>.vpk` (hermano de la carpeta).
 */

import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VpkTool } from "../../src/main/domain/index.js";
import { ChildProcessCommandRunner } from "../../src/main/data/child-process-command-runner.js";

/**
 * Ruta absoluta del ejecutable `vpk.exe` en esta máquina (confirmada por el
 * enunciado de la tarea). El test la usa tanto para construir el `VpkTool` real
 * como para decidir si se SALTA (skip) cuando el binario no está (otra máquina
 * o CI). Se centraliza aquí para no duplicar el literal.
 */
export const VPK_EXE_PATH =
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\left 4 dead 2\\bin\\vpk.exe";

/**
 * Directorio raíz donde se materializan los fixtures generados. Está bajo
 * `test/fixtures/vpk/generated/`, que `.gitignore` excluye por completo. Bajo
 * ESM (`module: NodeNext`) no hay `__dirname`, así que se deriva desde
 * `import.meta.url`: el directorio de este helper es `test/helpers/`, de modo
 * que subimos a `test/` y bajamos a `fixtures/vpk/generated`.
 */
const HELPER_DIR = dirname(fileURLToPath(import.meta.url));
export const GENERATED_DIR = join(HELPER_DIR, "..", "fixtures", "vpk", "generated");

/** Cantidad de archivos internos del fixture grande. > 200 para forzar batching. */
export const BIG_FIXTURE_FILE_COUNT = 260;

/**
 * Nombre del archivo con ESPACIOS incluido en el fixture `spaced`. Debe llevar
 * al menos un espacio para ejercitar el caveat de quoting (tarea 2.3).
 */
export const SPACED_INTERNAL_PATH = "materials/some model file.vmt";

/**
 * Descripción de un fixture generado: dónde está su `.vpk`, la carpeta fuente y
 * el conjunto EXACTO de paths internos (con `/`) que contiene. El test usa
 * `internalPaths` como verdad esperada para comparar contra lo que devuelve
 * `vpk l` y contra lo que aparece en disco tras `extract`.
 */
export interface GeneratedFixture {
  /** Ruta al `.vpk` empaquetado (`<sourceDir>.vpk`). */
  vpkPath: string;
  /** Carpeta fuente que se empaquetó (contiene el árbol de archivos dummy). */
  sourceDir: string;
  /** Paths internos esperados (con `/`), en forma ordenada y sin duplicados. */
  internalPaths: string[];
}

/** Escribe un archivo dummy, creando sus directorios padre si faltan. */
function writeDummyFile(absPath: string, content: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, "utf8");
}

/**
 * Construye el árbol de archivos dummy del fixture GRANDE en disco y devuelve
 * los paths internos (con `/`) que tendrá el VPK. Distribuye los archivos en
 * tres subcarpetas para imitar el layout de un addon (solo en forma).
 */
function layoutBigFixture(sourceDir: string): string[] {
  const subdirs = ["materials", "models", "sound"] as const;
  const internalPaths: string[] = [];

  for (let i = 0; i < BIG_FIXTURE_FILE_COUNT; i++) {
    // Repartir round-robin entre las subcarpetas.
    const sub = subdirs[i % subdirs.length]!;
    // Path interno del VPK: SIEMPRE con `/` (formato interno del VPK).
    const internal = `${sub}/dummy_${String(i).padStart(4, "0")}.bin`;
    internalPaths.push(internal);
    // En disco (para empaquetar) el separador nativo funciona; usamos join.
    const absPath = join(sourceDir, sub, `dummy_${String(i).padStart(4, "0")}.bin`);
    // Contenido dummy: relleno arbitrario, distinto por archivo para que el VPK
    // tenga datos reales que extraer (no importa el contenido en sí).
    writeDummyFile(absPath, `dummy fill content for entry ${i}\n`.repeat(3));
  }

  internalPaths.sort();
  return internalPaths;
}

/**
 * Construye el árbol del fixture con ESPACIOS: unos pocos archivos, al menos uno
 * con espacios en el nombre. Devuelve los paths internos esperados (con `/`).
 */
function layoutSpacedFixture(sourceDir: string): string[] {
  const internalPaths = [
    "materials/plain.vmt",
    SPACED_INTERNAL_PATH,
    "models/another one.mdl",
  ];

  for (const internal of internalPaths) {
    // Traducir `/` a separador de disco para escribir el archivo fuente.
    const absPath = join(sourceDir, ...internal.split("/"));
    writeDummyFile(absPath, `dummy content for "${internal}"\n`);
  }

  internalPaths.sort();
  return internalPaths;
}

/**
 * Genera (si no existen) los dos fixtures y devuelve sus descripciones.
 * Idempotente: si el `.vpk` de un fixture ya existe, no se regenera.
 *
 * @param vpkExePath Ruta a `vpk.exe` (por defecto {@link VPK_EXE_PATH}).
 * @returns `{ big, spaced }` con las descripciones de ambos fixtures.
 */
export async function ensureFixtures(
  vpkExePath: string = VPK_EXE_PATH,
): Promise<{ big: GeneratedFixture; spaced: GeneratedFixture }> {
  mkdirSync(GENERATED_DIR, { recursive: true });

  const runner = new ChildProcessCommandRunner();
  const tool = new VpkTool(runner, vpkExePath);

  const big = await ensureOneFixture(tool, "big", layoutBigFixture);
  const spaced = await ensureOneFixture(tool, "spaced", layoutSpacedFixture);

  return { big, spaced };
}

/**
 * Materializa un fixture concreto: si su `.vpk` ya existe, solo reconstruye la
 * descripción (paths internos) sin re-empaquetar; si no, escribe el árbol de
 * archivos dummy y lo empaqueta con `VpkTool.pack`.
 */
async function ensureOneFixture(
  tool: VpkTool,
  name: string,
  layout: (sourceDir: string) => string[],
): Promise<GeneratedFixture> {
  const sourceDir = join(GENERATED_DIR, name);
  const vpkPath = `${sourceDir}.vpk`;

  if (existsSync(vpkPath)) {
    // Ya generado: reconstruir la lista de paths esperados sin re-empaquetar.
    // Para ello re-derivamos el layout en un directorio temporal en memoria de
    // rutas (no se escribe si el .vpk existe): reusamos `layout` sobre una
    // carpeta que YA puede existir; layout solo devuelve los paths esperados y
    // (re)escribe archivos dummy idempotentemente, lo cual es inocuo.
    const internalPaths = layout(sourceDir);
    return { vpkPath, sourceDir, internalPaths };
  }

  // Carpeta fuente limpia para un empaquetado determinista.
  rmSync(sourceDir, { recursive: true, force: true });
  const internalPaths = layout(sourceDir);

  // `vpk <carpeta>` → genera `<carpeta>.vpk`. El addonId es arbitrario aquí
  // (solo etiquetaría un eventual VpkToolError); usamos el nombre del fixture.
  await tool.pack(sourceDir, `fixture:${name}`);

  return { vpkPath, sourceDir, internalPaths };
}
