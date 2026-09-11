/**
 * TitleCache - cache EN MEMORIA de titulos de addon (id -> titulo legible),
 * poblado por el escaneo completo de la Workshop (BUG-001).
 *
 * PROBLEMA que resuelve: el panel "Activos" y el preview solo necesitan mapear
 * `addonId -> titulo` de unos pocos addons candidatos, pero antes pagaban un
 * `AddonScanner.scan()` COMPLETO de la Workshop (recorrer cada `.vpk` + extraer
 * `addoninfo.txt` via vpk.exe, 12-17s con ~73 addons; ver P-23/P-20) solo para
 * eso. La derivacion directa de `vpkPath` (`<workshopFolder>\<id>.vpk`) elimina
 * ese escaneo del camino caliente, pero el TITULO no es derivable del id (vive
 * dentro del `addoninfo.txt`). Este cache lo cubre:
 *
 *   - Lo POBLA el primer `scanAddons()` completo de la sesion (tipicamente la
 *     Biblioteca al abrirse), via `setMany(addons)`.
 *   - Activos/preview lo CONSULTAN con `get(id)`. Si el id no esta (p. ej. el
 *     usuario abrio Activos sin pasar nunca por Biblioteca), `get` devuelve
 *     `undefined` y el consumidor usa el `addonId` crudo como fallback temporal
 *     -NUNCA dispara una extraccion de addoninfo en el camino caliente-.
 *
 * ALCANCE deliberado: es un cache de SOLO memoria, sin invalidacion propia. Su
 * fuente de verdad es el ultimo escaneo completo; un `setMany` posterior
 * (re-escaneo de la Biblioteca) lo refresca. Vive lo que vive el proceso.
 */
import type { ScannedAddon } from "./types.js";

export class TitleCache {
  readonly #titles = new Map<string, string>();

  /**
   * Puebla/refresca el cache a partir de un escaneo. Para cada addon usa
   * `info.title` si esta presente; si no, NO cachea nada para ese id (asi el
   * consumidor cae al fallback de id crudo en vez de cachear el id como si
   * fuera un titulo, lo que ocultaria un titulo real que aparezca luego).
   */
  setMany(addons: readonly ScannedAddon[]): void {
    for (const addon of addons) {
      const title = addon.info?.title;
      if (title !== undefined && title !== "") {
        this.#titles.set(addon.id, title);
      }
    }
  }

  /** Titulo cacheado del addon, o `undefined` si no se conoce (fallback a id crudo). */
  get(addonId: string): string | undefined {
    return this.#titles.get(addonId);
  }

  /** Titulos conocidos hoy, como objeto plano (para exponer al renderer via IPC). */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.#titles);
  }
}
