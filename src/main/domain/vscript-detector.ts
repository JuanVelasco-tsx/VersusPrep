/**
 * VScriptDetector — clasificación anti-VScript a partir del listado REAL del VPK
 * (Requirement 3; AC 3.1, 3.2, 3.3, 3.4, 3.5).
 *
 * Responsable de decidir si un addon es incompatible con Versus por contener
 * VScripts. La clasificación se hace SIEMPRE inspeccionando el listado de paths
 * internos que devuelve `VpkTool.list` (`vpk l`), NUNCA el flag
 * `addonContent_Script` del `addoninfo.txt` (AC 3.4). Esta decisión está
 * validada empíricamente: se observó un addon con el flag en 0 que sin embargo
 * tenía 3 `.nut` reales (ver Context/04-historial-decisiones.md).
 *
 * El diseño (sección "VScriptDetector") fija la interfaz objetivo. Este módulo
 * la implementa separando DOS niveles:
 *
 *   1. Un NÚCLEO PURO ({@link classifyVScriptPaths}) que, dado un `string[]` de
 *      paths internos, devuelve si hay un `.nut` bajo `scripts/vscripts/`. Es
 *      trivialmente testeable como propiedad (tarea 7.2) sin mocks ni I/O.
 *   2. Una ORQUESTACIÓN async ({@link VScriptDetector.classify}) que llama a
 *      `VpkTool.list`, maneja el fallo (`vpk l` con exit ≠ 0 lanza
 *      `VpkToolError`) clasificando como VScript_Addon POR PRECAUCIÓN (AC 3.5),
 *      y en éxito aplica el núcleo puro.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN de normalización del match del prefijo/extensión (AC 3.2, 3.3).
 *
 * Un path del listado CUENTA como VScript si y solo si, tras normalizar:
 *   - su PREFIJO es exactamente `scripts/vscripts/` (case-insensitive), Y
 *   - su EXTENSIÓN es `.nut` (case-insensitive).
 *
 * Normalización aplicada a cada path antes de comparar:
 *   - Se pasa a minúsculas (`toLowerCase`) para hacer AMBAS comparaciones
 *     (prefijo y extensión) case-insensitive: `Scripts/VScripts/Foo.NUT` cuenta.
 *   - Se contempla un `./` inicial opcional (`vpk l` podría emitir paths con o
 *     sin ese prefijo relativo): se recorta un único `./` líder si está presente
 *     antes de evaluar el prefijo. NO se intenta resolver `../` ni colapsar
 *     segmentos intermedios: los paths de `vpk l` son relativos a la raíz del
 *     VPK y no contienen navegación hacia arriba.
 *   - El separador es `/` (formato interno del VPK, ya garantizado por VpkTool);
 *     no se normalizan `\`.
 *
 * Con esa normalización:
 *   - `scripts/vscripts/foo.nut` ⇒ cuenta.
 *   - `scripts/vscripts/ai/bar.nut` (subdir más profundo) ⇒ cuenta (está BAJO el
 *     prefijo; `startsWith("scripts/vscripts/")` lo cubre).
 *   - `scripts/foo.nut`, `materials/vscripts/foo.nut`, `vscripts/foo.nut`
 *     (sin `scripts/` delante) ⇒ NO cuentan (AC 3.3).
 *   - Un `.nut` fuera del prefijo NUNCA afecta la clasificación (AC 3.3);
 *     basta UN `.nut` bajo el prefijo para clasificar como VScript_Addon.
 *
 * SUPOSICIÓN a revisar contra un VPK real con vscripts: se asume que `vpk l`
 * emite los paths internos con `/`, en minúsculas o con casing arbitrario, y
 * como mucho con un `./` líder. La contemplación del `./` inicial NO se verificó
 * empíricamente en esta subtarea; queda "a revisar contra un VPK real con
 * vscripts". El resto (separador `/`, casing arbitrario) sí es coherente con lo
 * observado en la validación end-to-end previa.
 * ---------------------------------------------------------------------------
 */

import type { ScannedAddon, VScriptClassification } from "./types.js";
import type { VpkTool } from "./vpk-tool.js";

/**
 * Prefijo (case-insensitive, ya en minúsculas) bajo el cual un `.nut` cuenta
 * como VScript. Se compara con `path.startsWith(...)`, de modo que cualquier
 * profundidad de subdirectorio bajo `scripts/vscripts/` queda cubierta.
 */
export const VSCRIPTS_PREFIX = "scripts/vscripts/";

/**
 * Extensión (case-insensitive, ya en minúsculas) que, combinada con el prefijo,
 * marca un path como VScript.
 */
export const VSCRIPT_EXTENSION = ".nut";

/**
 * NÚCLEO PURO de la clasificación (AC 3.2, 3.3).
 *
 * Dado el listado de paths internos de un VPK (ruido ya filtrado por
 * `VpkTool.list`, separador `/`), devuelve `true` si y solo si AL MENOS un path
 * es un `.nut` bajo `scripts/vscripts/` (case-insensitive, prefijo + extensión).
 * Los `.nut` fuera de ese prefijo se ignoran; los no-`.nut` bajo el prefijo
 * también (deben cumplirse AMBAS condiciones).
 *
 * Es una función sin I/O ni estado, apta para property testing (tarea 7.2).
 *
 * @param paths Paths internos del VPK (con `/`).
 * @returns `true` si hay un `.nut` bajo `scripts/vscripts/`.
 */
export function classifyVScriptPaths(paths: readonly string[]): boolean {
  return paths.some(isVScriptPath);
}

/**
 * Predicado para un único path: ¿es un `.nut` bajo `scripts/vscripts/`?
 *
 * Normaliza según la DECISIÓN documentada en el encabezado del módulo
 * (minúsculas + recorte de un `./` líder opcional) y exige AMBAS condiciones:
 * prefijo `scripts/vscripts/` y extensión `.nut`.
 */
export function isVScriptPath(path: string): boolean {
  let normalized = path.toLowerCase();
  // Recorta un único `./` líder si está presente (variación posible de vpk l).
  if (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized.startsWith(VSCRIPTS_PREFIX) && normalized.endsWith(VSCRIPT_EXTENSION);
}

/**
 * VScriptDetector — orquesta `VpkTool.list` + núcleo puro para clasificar un
 * addon (AC 3.1, 3.5).
 *
 * Recibe el {@link VpkTool} inyectado por constructor (mismo patrón que
 * AddonScanner/VpkTool: dependencia estable de la instancia). Se elige una clase
 * para mantener la dependencia como estado privado inmutable y exponer
 * `classify` tal como lo describe la interfaz de diseño.
 */
export class VScriptDetector {
  readonly #vpkTool: VpkTool;

  /**
   * @param vpkTool Herramienta VPK inyectada (usa `list(vpkPath, addonId)`).
   */
  constructor(vpkTool: VpkTool) {
    this.#vpkTool = vpkTool;
  }

  /**
   * Clasifica un addon a partir del listado REAL de su VPK.
   *
   * Flujo:
   *   1. `await vpkTool.list(addon.vpkPath, addon.id)`.
   *   2. Si LANZA (VpkToolError por exit ≠ 0, o cualquier error de ejecución) ⇒
   *      `{ isVScriptAddon: true, reason: "listing-failed" }` POR PRECAUCIÓN
   *      (AC 3.5): no pudo determinarse, así que se bloquea por defecto.
   *   3. Si tiene éxito ⇒ aplica {@link classifyVScriptPaths}:
   *      - match ⇒ `{ isVScriptAddon: true, reason: "nut-in-vscripts" }`.
   *      - sin match ⇒ `{ isVScriptAddon: false, reason: "clean" }`.
   *
   * NUNCA inspecciona `addon.info` ni ningún flag (AC 3.4); solo el listado.
   *
   * @param addon Addon escaneado (usa `id` y `vpkPath`).
   */
  async classify(addon: ScannedAddon): Promise<VScriptClassification> {
    let paths: string[];
    try {
      paths = await this.#vpkTool.list(addon.vpkPath, addon.id);
    } catch {
      // AC 3.5: `vpk l` falló o retornó exit ≠ éxito ⇒ no determinable ⇒
      // clasificar como VScript_Addon por precaución.
      return {
        addonId: addon.id,
        isVScriptAddon: true,
        reason: "listing-failed",
      };
    }

    if (classifyVScriptPaths(paths)) {
      return {
        addonId: addon.id,
        isVScriptAddon: true,
        reason: "nut-in-vscripts",
      };
    }

    return {
      addonId: addon.id,
      isVScriptAddon: false,
      reason: "clean",
    };
  }
}
