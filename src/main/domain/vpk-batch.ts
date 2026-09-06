/**
 * Batching de la extracción `vpk x` por DOS límites simultáneos: longitud de
 * línea de comando Y cantidad de paths por lote (AC 6.4, 6.5 / Property 9).
 *
 * `vpk.exe` se invoca como `vpk x <vpkPath> <path1> <path2> ...` para extraer
 * contenido. Hay DOS modos de falla, ambos confirmados empíricamente, que este
 * módulo evita particionando `internalPaths` en LOTES:
 *
 *   1) LÍMITE POR LONGITUD (el original). Pasar cientos de argumentos de una
 *      sola vez puede hacer que la línea de comando supere el máximo real de
 *      Windows (~8191 caracteres para `cmd`), fallando la invocación. Para
 *      evitarlo, cada lote se mantiene por debajo de un límite de LONGITUD
 *      seguro con margen ({@link DEFAULT_MAX_COMMAND_LENGTH}).
 *
 *   2) LÍMITE POR CANTIDAD (nuevo — hallazgo del test de integración contra el
 *      `vpk.exe` real). Se confirmó a mano que `vpk.exe` CRASHEA con
 *      `STATUS_STACK_BUFFER_OVERRUN` (exit `0xC0000409`) cuando recibe
 *      DEMASIADOS ARGUMENTOS de path en una sola invocación `vpk x`,
 *      INDEPENDIENTEMENTE de la longitud total de la línea de comando. Umbral
 *      observado: 64 argumentos funcionan (exit 0, extrae todo), ~72-79 ya
 *      crashean. Es decir: un lote de >70 paths CORTOS respeta de sobra el
 *      límite de longitud (1) y aun así crashea. Por eso el límite de longitud
 *      NO es suficiente y se agrega un segundo límite sobre la CANTIDAD de
 *      paths por lote ({@link DEFAULT_MAX_BATCH_SIZE}).
 *
 * Los dos límites son DIMENSIONES INDEPENDIENTES y se aplican SIMULTÁNEAMENTE:
 * un lote es válido solo si respeta AMBOS. Al recorrer los paths, se cierra el
 * lote actual y se abre uno nuevo en cuanto agregar el siguiente path violaría
 * CUALQUIERA de los dos (longitud O cantidad). El límite que primero se alcance
 * corta el lote (ver COMPORTAMIENTO DEL PARTICIONADO más abajo).
 *
 * Esta función es PURA: no realiza I/O ni tiene efectos. Solo decide CÓMO
 * agrupar los paths. La invocación real de `vpk x` (por lote) la hará
 * `VpkTool.extract()`. Aquí NO se construye ni ejecuta ningún comando; solo se
 * particiona.
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
 * IMPORTANTE — el modelo de costo SOLO modela la LONGITUD. El segundo límite
 * (cantidad de paths por lote) es una restricción APARTE que se aplica sobre
 * `batch.length`, NO sobre el costo de longitud. Son dos dimensiones
 * INDEPENDIENTES: {@link commandLengthForBatch} no cambia y no sabe nada de la
 * cantidad; el particionado ({@link batchInternalPaths}) es quien combina
 * ambas. Por eso `maxBatchSize` no aparece en la fórmula de costo.
 *
 * ---------------------------------------------------------------------------
 * COMPORTAMIENTO DEL PARTICIONADO (garantías, alineadas con Property 9)
 *
 * El particionado respeta SIMULTÁNEAMENTE los dos límites. Recorriendo los
 * paths en orden (greedy), agregar un path al lote actual cierra ese lote y
 * abre uno nuevo si se cumple CUALQUIERA de estas condiciones:
 *   - (longitud) agregar el path haría que el costo del lote exceda
 *     `maxCommandLength` (lógica original), O
 *   - (cantidad) el lote actual ya alcanzó `maxBatchSize` paths.
 * El límite que PRIMERO se alcance corta el lote.
 *
 * Garantías resultantes:
 *
 *   (a) Cada lote respeta el límite de LONGITUD: `commandLengthForBatch(lote)
 *       <= maxCommandLength`, SALVO el caso del path sobredimensionado por
 *       longitud (ver (c)).
 *   (a') Cada lote respeta el límite de CANTIDAD: `lote.length <= maxBatchSize`.
 *       Bajo la precondición `maxBatchSize >= 1` esto se cumple SIEMPRE (incluso
 *       para el lote aislado de (c), que tiene length 1): el criterio de
 *       cantidad NUNCA fuerza un lote vacío ni impide que un solo path entre.
 *   (b) Sin pérdida: concatenar los lotes en orden reproduce EXACTAMENTE
 *       `internalPaths`, en el mismo orden, sin omitir, duplicar ni reordenar
 *       ningún path.
 *   (c) Un path que POR SÍ SOLO ya excede el límite de LONGITUD (esto es,
 *       `overheadBase + 1 + len(path) > maxCommandLength`) NO se descarta ni se
 *       trunca: se coloca en su PROPIO lote individual (que inevitablemente
 *       excede el límite de longitud, pero es lo mejor posible sin perder el
 *       archivo). NOTA sobre la dimensión de cantidad: con `maxBatchSize >= 1`
 *       un solo path SIEMPRE cabe por el criterio de cantidad, así que "un path
 *       que por sí solo excede la CANTIDAD" no puede ocurrir (solo pasaría con
 *       `maxBatchSize < 1`, que se asume fuera de contrato). El único caso real
 *       de "path solo que excede" es el de LONGITUD, ya cubierto aquí.
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
 * Cantidad MÁXIMA de paths por lote (segundo límite, por CANTIDAD de
 * argumentos). Se fija en 50 como MARGEN EMPÍRICO conservador, no como un
 * límite documentado por Valve: `vpk.exe` NO documenta un máximo de argumentos.
 * El valor surge del hallazgo del test de integración contra el binario real,
 * donde 64 argumentos aún funcionan y ~72-79 ya crashean con
 * `STATUS_STACK_BUFFER_OVERRUN` (exit `0xC0000409`). 50 queda cómodamente por
 * debajo de ese umbral observado (70-80), dejando margen ante variaciones del
 * binario/entorno.
 *
 * Se exporta como constante nombrada para reutilización y para que los tests
 * (tarea 2.4) referencien el mismo valor sin duplicar el literal. El límite
 * puede sobreescribirse por invocación vía `options.maxBatchSize`.
 */
export const DEFAULT_MAX_BATCH_SIZE = 50;

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
   * Cantidad MÁXIMA de paths por lote (segundo límite, independiente del de
   * longitud). Por defecto {@link DEFAULT_MAX_BATCH_SIZE}. Se aplica
   * SIMULTÁNEAMENTE con `maxCommandLength`: el que primero se alcance corta el
   * lote. Precondición razonable: `maxBatchSize >= 1` (con `>= 1` un solo path
   * siempre cabe por el criterio de cantidad; el criterio nunca fuerza un lote
   * vacío).
   */
  maxBatchSize?: number;
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
 * Particiona `internalPaths` en lotes que respeten SIMULTÁNEAMENTE dos límites:
 * la longitud estimada de la línea de comando (`maxCommandLength`, según el
 * MODELO DE COSTO documentado en el encabezado) y la CANTIDAD de paths por lote
 * (`maxBatchSize`).
 *
 * Estrategia (greedy, preservando el orden): recorre los paths en orden y los
 * va acumulando en el lote actual mientras (a) el costo estimado del lote —con
 * el path candidato incluido— no supere `maxCommandLength` Y (b) el lote no haya
 * alcanzado ya `maxBatchSize` paths. Cuando agregar el siguiente path violaría
 * CUALQUIERA de los dos límites, cierra el lote actual y abre uno nuevo con ese
 * path. Un path que POR SÍ SOLO ya excede el límite de LONGITUD se coloca en su
 * propio lote individual (ver garantía (c)); el límite de CANTIDAD, con
 * `maxBatchSize >= 1`, nunca impide que un solo path entre.
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
  const maxBatchSize = options?.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
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
      // exceda el límite de longitud, en cuyo caso queda aislado — garantía
      // (c)). No se descarta ni se trunca. El límite de cantidad no aplica aquí
      // porque un solo path siempre cabe (asumiendo maxBatchSize >= 1).
      current.push(path);
      currentLength += pathCost;
      continue;
    }

    // Dos restricciones INDEPENDIENTES para que el path quepa en el lote actual:
    //   - longitud: el costo acumulado con el path no debe exceder el límite.
    //   - cantidad: el lote no debe haber alcanzado ya maxBatchSize paths.
    const fitsLength = currentLength + pathCost <= maxCommandLength;
    const fitsCount = current.length < maxBatchSize;

    if (fitsLength && fitsCount) {
      // Cabe en el lote actual por AMBAS dimensiones.
      current.push(path);
      currentLength += pathCost;
    } else {
      // Violaría al menos uno de los dos límites: cierra el lote actual y abre
      // uno nuevo con este path. El que primero se alcance corta el lote.
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
