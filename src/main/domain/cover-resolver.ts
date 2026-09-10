/**
 * Cover_Resolver - resolucion y validacion del path del Addon_Cover para el
 * protocolo custom `l4d2cover://<id>` (Bloque 1 de la Tarea 21.1).
 *
 * El renderer nunca ve rutas de disco: pide `<img src="l4d2cover://<id>">` y el
 * proceso main resuelve el `<id>` al archivo `<workshopFolder>\<id>.jpg`. Este
 * modulo concentra la LOGICA PURA de esa resolucion (validacion del id +
 * armado del path + contencion dentro de la Workshop_Folder + chequeo de
 * existencia), separada del wiring de `protocol.handle` (que vive en main.ts y
 * depende del runtime de Electron). Asi la validacion es testeable inyectando
 * el chequeo de existencia, sin arrancar Electron (mismo criterio de FS
 * inyectable que AddonScanner / PathDetector).
 *
 * DEFENSA EN PROFUNDIDAD (dos capas independientes contra path traversal):
 *   1. Validacion del id POR PATRON conservador ANTES de tocar disco: se
 *      rechaza cualquier id con separadores (`/`, `\`), `..`, o caracteres
 *      fuera de `[A-Za-z0-9_-]`. Se valida por PATRON, no por longitud ni
 *      asumiendo que el id es numerico (los ids de Workshop lo son en la
 *      practica, pero no se asume ciegamente).
 *   2. Confirmacion EXPLICITA de que el path resuelto queda DENTRO de la
 *      Workshop_Folder, aun si (1) dejara pasar algo: se compara el path
 *      resuelto contra el prefijo de la carpeta base normalizada. Es
 *      redundante a proposito.
 */
import * as path from "node:path";

/** Extension (con punto) del archivo de portada, igual que AddonScanner. */
export const COVER_EXTENSION = ".jpg";

/**
 * Patron conservador de id de Addon_Cover: uno o mas caracteres alfanumericos,
 * guion bajo o guion medio. NO admite separadores de path, puntos (descarta
 * `..` y cualquier extension embebida) ni espacios. Anclado a toda la cadena.
 */
export const COVER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Resultado de resolver un cover. Union discriminada por `ok` (mismo estilo que
 * el resto del dominio). El caso de error lleva un `reason` legible para que el
 * handler de protocolo elija el status HTTP/respuesta apropiada sin adivinar.
 */
export type CoverResolution =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: CoverResolutionFailure };

/**
 * Motivo por el que no se pudo resolver un cover. Cada variante mapea a una
 * respuesta de error distinta del handler (Bloque 1, punto 2):
 *   - `paths-not-detected`: `getPaths()` devolvio null (mismo gate que scanAddons).
 *   - `invalid-id`: el id no paso la validacion por patron (capa 1).
 *   - `out-of-bounds`: el path resuelto quedo fuera de la Workshop_Folder (capa 2).
 *   - `not-found`: el `<id>.jpg` no existe en disco.
 */
export type CoverResolutionFailure =
  | "paths-not-detected"
  | "invalid-id"
  | "out-of-bounds"
  | "not-found";

/** Chequeo de existencia inyectable (igual patron que AddonFileSystem.exists). */
export type CoverFileExists = (absolutePath: string) => Promise<boolean>;

/**
 * Valida un id de cover por patron (capa 1 de la defensa). Exportada aparte
 * para poder testear el patron de forma aislada.
 */
export function isValidCoverId(id: string): boolean {
  return COVER_ID_PATTERN.test(id);
}

/**
 * Confirma que `candidate` queda DENTRO de `baseDir` (capa 2 de la defensa).
 * Normaliza ambos con `path.win32` (rutas de disco Windows, coherente con el
 * resto del dominio) y compara por prefijo de segmento: `candidate` debe ser el
 * propio `baseDir` o colgar de el con un separador en el limite (evita que
 * `C:\\ws-evil` matchee contra base `C:\\ws`).
 */
export function isWithinBase(baseDir: string, candidate: string): boolean {
  const base = path.win32.normalize(baseDir).replace(/[\\/]+$/, "");
  const target = path.win32.normalize(candidate);
  if (target.toLowerCase() === base.toLowerCase()) return true;
  const prefix = base + "\\";
  return target.toLowerCase().startsWith(prefix.toLowerCase());
}

/**
 * Resuelve el path absoluto del `<id>.jpg` de un cover, aplicando las dos capas
 * de defensa y el chequeo de existencia. NO lee el archivo (eso lo hace el
 * handler); solo decide QUE path servir o por que rechazar.
 *
 * @param id `<id>` extraido de la URL `l4d2cover://<id>`.
 * @param workshopFolder Workshop_Folder de GamePaths, o `null` si getPaths()
 *   aun no tiene rutas (mismo gate que scanAddons).
 * @param fileExists Chequeo de existencia inyectado (FS real en produccion).
 */
export async function resolveCoverPath(
  id: string,
  workshopFolder: string | null,
  fileExists: CoverFileExists,
): Promise<CoverResolution> {
  if (workshopFolder === null) {
    return { ok: false, reason: "paths-not-detected" };
  }
  if (!isValidCoverId(id)) {
    return { ok: false, reason: "invalid-id" };
  }
  const absolutePath = path.win32.join(workshopFolder, id + COVER_EXTENSION);
  if (!isWithinBase(workshopFolder, absolutePath)) {
    return { ok: false, reason: "out-of-bounds" };
  }
  if (!(await fileExists(absolutePath))) {
    return { ok: false, reason: "not-found" };
  }
  return { ok: true, absolutePath };
}
