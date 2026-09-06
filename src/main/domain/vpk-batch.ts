/**
 * Batching de la extracción `vpk x` por longitud de línea de comando
 * (AC 6.4, 6.5 / Property 9).
 *
 * `vpk.exe` se invoca como `vpk x <vpkPath> <path1> <path2> ...` para extraer
 * contenido. Está confirmado empíricamente que pasar cientos de argumentos de
 * una sola vez hace fallar la invocación (exit `-1`, extrae 0 archivos): la
 * línea de comando supera el máximo real de Windows (~8191 caracteres para
 * `cmd`). Para evitarlo, se particiona `internalPaths` en LOTES cuya línea de
 * comando estimada quede por debajo de un límite seguro (con margen).
 *
 * Esta función es PURA: no realiza I/O ni tiene efectos. Solo decide CÓMO
 * agrupar los paths. La invocación real de `vpk x` (por lote) la hará
 * `VpkTool.extract()` (tarea 2.7, todavía NO implementada). Aquí NO se
 * construye ni ejecuta ningún comando; solo se particiona.
 *
 * ---------------------------------------------------------------------------
 * MODELO DE COSTO DE LA LÍNEA DE COMANDO (decisión explícita y documentada)
 *
 * El spec (AC 6.4) exige que "la longitud total de la línea de comando de cada
 * invocación (ejecutable, VPK y todos los paths de archivo) no exceda un límite
 * seguro". El spec NO fija con precisión qué caracteres se cuentan ni cómo, así
 * que este módulo adopta un modelo CONSERVADOR y explícito. Conservador
 * significa: ante la duda, contar de MÁS antes que de menos, porque el objetivo
 * es no exceder el límite REAL de Windows, y sobrestimar solo produce lotes un
 * poco más chicos (inocuo), mientras que subestimar podría producir el fallo
 * `exit -1` que justamente queremos evitar.
 *
 * Definición del costo (ver {@link commandLengthForBatch} para el cálculo):
 *
 *   costo(lote) = overheadBase + Σ_{path ∈ lote} (1 + len(path))
 *
 * donde:
 *
 *   - `overheadBase` = len(overheadPrefix), y `overheadPrefix` es el literal
 *     `"<executableName> x <vpkPath>"` (por defecto `executableName = "vpk.exe"`).
 *     Es decir, se cuenta el nombre del ejecutable, un espacio, el subcomando
 *     `x`, otro espacio y la ruta completa del VPK. Esta es la parte FIJA que
 *     está presente en TODA invocación, independientemente de qué paths lleve el
 *     lote. Se cuenta el nombre del ejecutable (no la ruta absoluta a él) porque
 *     la invocación por `execFile`/`spawn` recibe el ejecutable resuelto por su
 *     nombre/ruta corta; asumir solo el nombre es lo esperado y, si el llamador
 *     quiere ser aún más conservador, puede pasar una ruta más larga vía
 *     `executableName`.
 *
 *   - Por CADA path del lote se suma `1 + len(path)`: el `1` es el espacio
 *     separador que precede al argumento en la línea de comando, y `len(path)`
 *     es la longitud del path tal cual (los paths internos del VPK usan `/`;
 *     este módulo NO los altera ni traduce separadores — eso es la tarea 2.5).
 *
 * Naturaleza APROXIMADA del modelo: este cálculo es una aproximación
 * conservadora del costo real de la línea de comando de Windows, NO el conteo
 * exacto del sistema operativo. En particular NO modela el quoting/escaping que
 * el SO podría aplicar a argumentos con espacios o caracteres especiales (que
 * añadiría comillas y, por tanto, más caracteres). Como el modelo ya deja un
 * margen amplio respecto del máximo real (~6000 vs ~8191) y como la invocación
 * se hace SIN shell (argumentos como array, ver diseño VpkTool), el quoting
 * extra queda absorbido por el margen. El objetivo no es replicar el conteo del
 * SO, sino quedar cómodamente por debajo del límite.
 *
 * El cálculo se expone como {@link commandLengthForBatch} (función nombrada y
 * reutilizable) para que el property test de la tarea 2.4 (Property 9) pueda
 * razonar sobre EXACTAMENTE el mismo modelo de costo que usa el particionado,
 * sin duplicar la fórmula.
 *
 * ---------------------------------------------------------------------------
 * COMPORTAMIENTO DEL PARTICIONADO (garantías, alineadas con Property 9)
 *
 *   (a) Cada lote respeta el límite: `commandLengthForBatch(lote) <=
 *       maxCommandLength`, SALVO el caso del path sobredimensionado (ver (c)).
 *   (b) Sin pérdida: concatenar los lotes en orden reproduce EXACTAMENTE
 *       `internalPaths`, en el mismo orden, sin omitir, duplicar ni reordenar
 *       ningún path.
 *   (c) Un path que POR SÍ SOLO ya excede el límite (esto es,
 *       `overheadBase + 1 + len(path) > maxCommandLength`) NO se descarta ni se
 *       trunca: se coloca en su PROPIO lote individual (que inevitablemente
 *       excede el límite, pero es lo mejor posible sin perder el archivo). La
 *       tarea 2.7/2.5 y la validación real decidirán cómo invocar ese caso; a
 *       nivel de particionado, lo preservamos aislado.
 *
 * Entrada vacía: `internalPaths` vacío devuelve `[]` (cero lotes). NUNCA se
 * generan lotes vacíos: todo lote devuelto contiene al menos un path.
 * ---------------------------------------------------------------------------
 */

/**
 * Límite seguro por defecto (en caracteres) para la longitud estimada de la
 * línea de comando de una invocación `vpk x`. Se fija en 6000, cómodamente por
 * debajo del máximo real de Windows para `cmd` (~8191), dejando margen para el
 * quoting/escaping que el modelo de costo no cuenta explícitamente.
 *
 * Se exporta como constante nombrada para reutilización y para que los tests
 * (tarea 2.4) referencien el mismo valor sin duplicar el literal. El límite
 * puede sobreescribirse por invocación vía `options.maxCommandLength`.
 */
export const DEFAULT_MAX_COMMAND_LENGTH = 6000;

/**
 * Nombre de ejecutable por defecto asumido para el cálculo del overhead base.
 * Ver el MODELO DE COSTO en el encabezado del archivo.
 */
export const DEFAULT_EXECUTABLE_NAME = "vpk.exe";

/** Opciones del particionado / cálculo de costo. */
export interface BatchInternalPathsOptions {
  /**
   * Límite seguro (en caracteres) para la longitud estimada de la línea de
   * comando de cada lote. Por defecto {@link DEFAULT_MAX_COMMAND_LENGTH}.
   */
  maxCommandLength?: number;
  /**
   * Nombre (o ruta) del ejecutable a asumir en el overhead base. Por defecto
   * {@link DEFAULT_EXECUTABLE_NAME}. Pasar una ruta más larga produce una
   * estimación más conservadora.
   */
  executableName?: string;
}

/**
 * Construye el prefijo FIJO de la línea de comando: `"<executableName> x
 * <vpkPath>"`. Es la parte que aparece en toda invocación `vpk x`,
 * independientemente de los paths del lote. Su longitud es el `overheadBase`
 * del modelo de costo.
 */
export function commandOverheadPrefix(vpkPath: string, executableName: string): string {
  return `${executableName} x ${vpkPath}`;
}

/**
 * Calcula el costo (longitud estimada de la línea de comando, en caracteres) de
 * un lote de paths, según el MODELO DE COSTO documentado en el encabezado:
 *
 *   costo = len("<executableName> x <vpkPath>") + Σ (1 + len(path))
 *
 * El `1` por path es el espacio separador que precede a cada argumento. Esta es
 * la ÚNICA fuente de verdad del cálculo de costo; el particionado y el property
 * test (2.4) deben usar esta función para razonar sobre el mismo modelo.
 *
 * @param paths Paths del lote (o de un lote hipotético).
 * @param vpkPath Ruta del VPK de origen (parte del overhead base).
 * @param executableName Nombre/ruta del ejecutable (parte del overhead base).
 * @returns Longitud estimada de la línea de comando para ese lote.
 */
export function commandLengthForBatch(
  paths: readonly string[],
  vpkPath: string,
  executableName: string = DEFAULT_EXECUTABLE_NAME,
): number {
  let total = commandOverheadPrefix(vpkPath, executableName).length;
  for (const path of paths) {
    // 1 (espacio separador) + longitud del argumento.
    total += 1 + path.length;
  }
  return total;
}

/**
 * Particiona `internalPaths` en lotes cuya línea de comando estimada no exceda
 * `maxCommandLength`, según el MODELO DE COSTO documentado en el encabezado.
 *
 * Estrategia (greedy, preservando el orden): recorre los paths en orden y los
 * va acumulando en el lote actual mientras el costo estimado del lote (con el
 * path candidato incluido) no supere el límite. Cuando agregar el siguiente
 * path excedería el límite, cierra el lote actual y abre uno nuevo con ese
 * path. Un path que POR SÍ SOLO ya excede el límite se coloca en su propio lote
 * individual (ver garantía (c)).
 *
 * @param internalPaths Paths internos del VPK a extraer (en el orden deseado).
 * @param vpkPath Ruta del VPK de origen (afecta el overhead base del costo).
 * @param options Ver {@link BatchInternalPathsOptions}.
 * @returns Array de lotes (cada lote es `string[]` de paths), en el MISMO orden
 *          de entrada, sin omitir, duplicar ni reordenar. Nunca hay lotes
 *          vacíos; entrada vacía devuelve `[]`.
 */
export function batchInternalPaths(
  internalPaths: readonly string[],
  vpkPath: string,
  options?: BatchInternalPathsOptions,
): string[][] {
  const maxCommandLength = options?.maxCommandLength ?? DEFAULT_MAX_COMMAND_LENGTH;
  const executableName = options?.executableName ?? DEFAULT_EXECUTABLE_NAME;

  // overheadBase: parte fija de toda invocación (ejecutable + subcomando + vpk).
  const overheadBase = commandOverheadPrefix(vpkPath, executableName).length;

  const batches: string[][] = [];
  let current: string[] = [];
  // Costo acumulado del lote actual; arranca en el overhead base.
  let currentLength = overheadBase;

  for (const path of internalPaths) {
    // Costo de agregar este path al lote (espacio separador + longitud).
    const pathCost = 1 + path.length;

    if (current.length === 0) {
      // El lote actual está vacío: este path SIEMPRE entra (aunque por sí solo
      // exceda el límite, en cuyo caso queda aislado — garantía (c)). No se
      // descarta ni se trunca.
      current.push(path);
      currentLength += pathCost;
      continue;
    }

    if (currentLength + pathCost <= maxCommandLength) {
      // Cabe en el lote actual sin exceder el límite.
      current.push(path);
      currentLength += pathCost;
    } else {
      // No cabe: cierra el lote actual y abre uno nuevo con este path.
      batches.push(current);
      current = [path];
      currentLength = overheadBase + pathCost;
    }
  }

  // Cierra el último lote en curso (si contiene algo). Nunca se emite un lote
  // vacío: `current` solo tiene elementos si se agregó al menos un path.
  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}
