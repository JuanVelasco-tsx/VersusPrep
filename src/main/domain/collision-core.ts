/**
 * Núcleo PURO de resolución de colisiones (Tarea 10.2, Requirement 6.7, 7.1, 7.2).
 *
 * Extrae la lógica de DECISIÓN de la fusión —independiente del I/O— que hoy vive
 * embebida en `CollisionResolver.mergeInto` (Tarea 10.1): dado, por addon, el
 * conjunto de paths relativos que aporta EN Priority_Order ASCENDENTE, determina
 * de forma DETERMINISTA:
 *   - qué addon GANA cada path final (el ÚLTIMO del Priority_Order que lo aporta,
 *     AC 7.2), y
 *   - las {@link FileCollision} (paths aportados por ≥ 2 addons, con
 *     `contributors` en orden ascendente y `winner` = el último), tal como las
 *     arma hoy `mergeInto`.
 *
 * Al ser PURO (sin FS, sin async, determinista respecto de la entrada) se puede
 * testear como PROPIEDAD (Tarea 10.3, Property 11) sin tocar disco. `mergeInto`
 * DELEGA en este núcleo la decisión de ganador y el armado del `MergeReport`,
 * quedando responsable solo del I/O (walk + ensureDir + copyFile en orden).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN — Tipo de entrada propio ({@link AddonContribution}) en vez de
 * reutilizar {@link ExtractedRoot}.
 *
 * `ExtractedRoot` (`{ addonId, rootDir }`) modela una carpeta EN DISCO: su
 * contenido solo se conoce recorriéndola (I/O). El núcleo puro no debe tocar
 * disco, así que necesita el contenido YA materializado como datos: por eso
 * recibe, por addon, la lista de paths relativos (`relativePaths`). Es la vista
 * "addonId + paths" que menciona la tarea, y es lo que un walk produce. En la
 * práctica `mergeInto` obtiene esos paths con `fs.walk(root.rootDir)` y arma la
 * entrada de este núcleo; el núcleo se queda solo con la decisión.
 * ---------------------------------------------------------------------------
 *
 * NORMALIZACIÓN DE CLAVE — se reutiliza EXACTAMENTE la misma que
 * `collision-resolver.ts` (DECISIÓN 2 de ese archivo): separadores `\` → `/`,
 * sin separador líder, `toLowerCase`. La función {@link toCollisionKey} vive
 * aquí y `collision-resolver.ts` la reutiliza, para que el comportamiento sea
 * idéntico y no haya dos normalizaciones que puedan divergir.
 */

import type { FileCollision, MergeReport } from "./types.js";

/** Separador canónico usado en la clave/`relativePath` normalizado (Windows usa `\` en disco). */
const CANONICAL_SEPARATOR = "/";

/**
 * Contribución de un addon a la fusión: su `addonId` y el conjunto de paths
 * relativos (respecto de su root de extracción) que aporta. Es la vista PURA
 * (sin disco) del contenido de un `ExtractedRoot`, materializada como datos.
 *
 * El ORDEN de `relativePaths` dentro de un mismo addon NO afecta la política de
 * colisiones (el ganador se decide ENTRE addons, no dentro de uno): dos paths
 * distintos del mismo addon no colisionan entre sí. Cada `relativePath` puede
 * venir con `/` o `\` y en cualquier casing; la normalización a clave la hace
 * este núcleo (ver {@link toCollisionKey}).
 */
export interface AddonContribution {
  /** Identificador del addon que aporta estos paths. */
  addonId: string;
  /** Paths relativos que el addon aporta a la fusión (separador/casing libres). */
  relativePaths: readonly string[];
}

/**
 * Ganador de un path final: el addon cuyo archivo prevalece en `pak01_dir`
 * (el último del Priority_Order que aportó ese path). `relativePath` es la clave
 * NORMALIZADA (forma estable con `/`, minúsculas), la misma con la que se
 * detectan las colisiones y se construye el destino canónico.
 */
export interface ResolvedWinner {
  /** Path final normalizado (separadores `/`, sin líder, minúsculas). */
  relativePath: string;
  /** addonId cuyo archivo prevalece en este path (el último del Priority_Order). */
  winner: string;
}

/**
 * Resultado PURO de resolver la fusión (sin tocar disco):
 *
 *  - `winners`: mapa clave-normalizada → {@link ResolvedWinner}, con el ganador
 *    de CADA path aportado (haya o no colisión). Preserva el orden de PRIMERA
 *    aparición de cada path (orden de inserción del Map), de modo que un
 *    consumidor pueda recorrerlo de forma determinista.
 *  - `report`: el {@link MergeReport} con SOLO las colisiones (paths con ≥ 2
 *    contribuidores), idéntico al que arma hoy `mergeInto`.
 */
export interface ResolvedMerge {
  /** Ganador por path normalizado (todos los paths, colisionen o no). */
  winners: Map<string, ResolvedWinner>;
  /** Reporte de colisiones (paths con ≥ 2 contribuidores). */
  report: MergeReport;
}

/**
 * Normaliza una ruta relativa a la CLAVE canónica de colisión: separadores
 * `\` → `/`, sin separador líder, en minúsculas. Es la ÚNICA normalización de
 * clave del dominio de colisiones; `collision-resolver.ts` la reutiliza para que
 * la clave con la que se agrupan contribuidores y se construye el destino en
 * disco sea idéntica a la que decide el ganador.
 *
 * Justificación (heredada de la DECISIÓN 2 de `collision-resolver.ts`):
 *  - `\` → `/`: forma canónica independiente del separador con que el FS listó.
 *  - `toLowerCase`: el destino real (NTFS) es case-insensitive, así que
 *    `Materials/a.vmt` y `materials/A.VMT` colisionan en disco; la clave debe
 *    reflejarlo para no perder una colisión real.
 */
export function toCollisionKey(relativePath: string): string {
  return relativePath
    .replace(/\\/g, CANONICAL_SEPARATOR)
    .replace(/^\/+/, "")
    .toLowerCase();
}

/**
 * Acumulador interno de contribuidores por path normalizado, preservando el
 * orden de recorrido (ascendente) en que cada addon aportó el path.
 */
interface Contribution {
  /** addonIds que aportaron este path, en orden de recorrido ascendente. */
  contributors: string[];
}

/**
 * Resuelve la fusión de forma PURA (AC 6.7, 7.1, 7.2).
 *
 * Recorre `contributions` EN EL ORDEN RECIBIDO (Priority_Order ASCENDENTE) y,
 * para cada path de cada addon, registra su contribución bajo la clave
 * normalizada. Como el último addon del Priority_Order se procesa al final, es
 * el `winner` de cada path (gana el último, AC 7.2). Un path aportado por ≥ 2
 * addons es una {@link FileCollision} (AC 7.1); uno aportado por uno solo tiene
 * ganador pero no genera colisión.
 *
 * DETERMINISMO: el resultado depende SOLO del orden de `contributions` y de los
 * paths de cada addon; no hay estado externo ni I/O. El orden de `winners` y de
 * `report.collisions` sigue la PRIMERA aparición de cada path (orden de
 * inserción del Map), lo que hace el resultado reproducible (Property 11).
 *
 * @param contributions Contribuciones por addon, en Priority_Order ASCENDENTE.
 */
export function resolveMerge(contributions: readonly AddonContribution[]): ResolvedMerge {
  // Map clave-normalizada → contribuidores en orden de recorrido. Un Map
  // preserva el orden de INSERCIÓN de las claves, dando un resultado
  // determinista (primera aparición del path).
  const acc = new Map<string, Contribution>();

  for (const { addonId, relativePaths } of contributions) {
    for (const relativePath of relativePaths) {
      const key = toCollisionKey(relativePath);
      const existing = acc.get(key);
      if (existing === undefined) {
        acc.set(key, { contributors: [addonId] });
      } else {
        existing.contributors.push(addonId);
      }
    }
  }

  // La clave del Map `acc` YA es la clave normalizada; es también el
  // `relativePath` reportado, así que se reutiliza como clave de `winners`.
  const winners = new Map<string, ResolvedWinner>();
  const collisions: FileCollision[] = [];
  for (const [relativePath, { contributors }] of acc) {
    const winner = contributors[contributors.length - 1];
    // `contributors` nunca está vacío (se creó con ≥ 1 elemento); el guard
    // satisface a TypeScript bajo `noUncheckedIndexedAccess`.
    if (winner === undefined) {
      continue;
    }
    winners.set(relativePath, { relativePath, winner });
    if (contributors.length >= 2) {
      collisions.push({
        relativePath,
        contributors: [...contributors],
        winner,
      });
    }
  }

  return { winners, report: { collisions } };
}
