/**
 * ProcessGuard — deteccion del proceso `left4dead2.exe` en ejecucion
 * (Tarea 14.1, Requirement 4; AC 4.1).
 *
 * Responsabilidad unica: responder si el juego (`left4dead2.exe`) esta
 * corriendo, para que el orquestador (tarea 18) pueda ABORTAR e informar que
 * hay que cerrar el juego antes de cualquier fusion/instalacion (AC 4.2). El
 * aborto en si NO vive aca: ProcessGuard solo DETECTA; la decision de abortar
 * y el mensaje al usuario son del orquestador.
 *
 * ---------------------------------------------------------------------------
 * DECISION 1 — Matching EXACTO (igualdad, no substring/prefix),
 * case-insensitive.
 *
 * El nombre de proceso se compara contra el literal `"left4dead2.exe"` con
 * IGUALDAD EXACTA tras pasar ambos lados por `.toLowerCase()`. NO se usa
 * `includes`/`startsWith` ni una regex de substring. Motivo: un nombre como
 * `"left4dead2.exe.bak"` o `"notleft4dead2.exe"` NO es el proceso del juego y
 * NO debe matchear; un substring lo daria como falso positivo. El casing se
 * ignora porque Windows no distingue mayusculas en nombres de ejecutable
 * (`LEFT4DEAD2.EXE`, `Left4Dead2.exe` y `left4dead2.exe` son el mismo binario).
 *
 * Corolario ya cubierto por el criterio de aceptacion de 14.2: `hl2.exe`
 * (el ejecutable de otros juegos Source) NO iguala a `left4dead2.exe`, asi que
 * su presencia por si sola devuelve `false`.
 * ---------------------------------------------------------------------------
 *
 * DECISION 2 — Extraccion de BASENAME antes de comparar, soportando `\` y `/`.
 *
 * Un proveedor de lista de procesos podria devolver el nombre a secas
 * (`"left4dead2.exe"`) o una ruta completa
 * (`"C:\\...\\left4dead2.exe"`, o con `/` en un futuro proveedor de
 * Linux/Steam Deck). Antes de comparar se extrae el ULTIMO segmento tras el
 * separador, aceptando TANTO `\` COMO `/`, de modo que la comparacion siempre
 * sea sobre el nombre de archivo y no sobre la ruta. Si el nombre ya viene sin
 * ruta, la extraccion es un no-op transparente (devuelve el mismo string).
 *
 * Se soportan ambos separadores aunque la plataforma primaria sea Windows
 * (secundaria Linux/Steam Deck) porque el proveedor real podria normalizar la
 * ruta de forma distinta en el futuro; extraer el basella de forma robusta ante
 * cualquiera de los dos evita depender de ese detalle del proveedor.
 * ---------------------------------------------------------------------------
 *
 * DECISION 3 — ALCANCE: `ProcessListProvider` es SOLO una interfaz inyectable.
 *
 * Esta tarea NO incluye una implementacion real de produccion del proveedor
 * (no existe en tasks.md una tarea equivalente a la "3" del VpkTool para
 * ProcessGuard). La enumeracion real de procesos de Windows (p. ej. parseando
 * la salida de `tasklist`, o via alguna libreria nativa) queda PENDIENTE para
 * cuando el orquestador (tarea 18) o la capa IPC (tarea 20) la necesiten. Aca
 * se define solo el contrato inyectable y la logica de deteccion sobre el, del
 * mismo modo que `VpkTool` define `CommandRunner` sin implementarlo, o
 * PathDetector define `RegistryReader`/`FileSystemProbe` sin implementarlos.
 *
 * Por la misma razon `isGameRunning` NO tiene error tipado ni rama de fallo:
 * su contrato es `Promise<boolean>` sin mas. Si el proveedor real llegara a
 * fallar algun dia, ese es un problema de SU implementacion (que decidira si
 * rechaza la promesa o resuelve con lista vacia), no de ProcessGuard.
 * ---------------------------------------------------------------------------
 */

/** Nombre canonico del ejecutable del juego que se busca (AC 4.1). */
export const GAME_PROCESS_NAME = "left4dead2.exe";

/**
 * Proveedor inyectable de la lista de procesos en ejecucion.
 *
 * Es SOLO un contrato (DECISION 3): la implementacion real de produccion queda
 * pendiente para la tarea que la necesite (orquestador/IPC). Devuelve los
 * nombres de proceso tal cual los reporte el sistema; cada nombre puede venir a
 * secas (`"left4dead2.exe"`) o con ruta completa (DECISION 2).
 */
export interface ProcessListProvider {
  /** Devuelve los nombres (o rutas) de los procesos actualmente en ejecucion. */
  listRunningProcessNames(): Promise<string[]>;
}

/**
 * Extrae el ultimo segmento (basename) de un nombre de proceso, aceptando
 * tanto `\` como `/` como separador (DECISION 2). Si no hay separador, devuelve
 * el string sin cambios (no-op transparente).
 */
function basename(name: string): string {
  let lastSeparator = -1;
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch === "\\" || ch === "/") {
      lastSeparator = i;
    }
  }
  return lastSeparator === -1 ? name : name.slice(lastSeparator + 1);
}

/**
 * Guarda de precondicion "juego cerrado": detecta si `left4dead2.exe` esta en
 * ejecucion consultando un {@link ProcessListProvider} inyectado.
 */
export class ProcessGuard {
  readonly #provider: ProcessListProvider;

  constructor(provider: ProcessListProvider) {
    this.#provider = provider;
  }

  /**
   * Pide la lista de procesos al proveedor y devuelve `true` si ALGUNO, tras
   * extraer su basename (DECISION 2), iguala EXACTAMENTE a `left4dead2.exe` de
   * forma case-insensitive (DECISION 1). Devuelve `false` en caso contrario,
   * incluida una lista vacia.
   */
  async isGameRunning(): Promise<boolean> {
    const names = await this.#provider.listRunningProcessNames();
    return names.some(
      (name) => basename(name).toLowerCase() === GAME_PROCESS_NAME,
    );
  }
}
