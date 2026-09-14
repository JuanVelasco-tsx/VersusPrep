/**
 * ElevationService — estrategia de permisos de administrador / elevación UAC
 * bajo demanda (Tareas 17.1 y 17.2, Requirement 9.2).
 *
 * La decisión de diseño (design.md, sección "ElevationService") es **elevación
 * UAC bajo demanda** (*re-launch on demand*): la app arranca SIN privilegios y
 * solo eleva para las escrituras en el Game_Root (backup, instalar el
 * Merged_Package en `modsvs\`, editar `gameinfo.txt`). No corre siempre elevada
 * ni pide reabrir la app a mano.
 *
 * La elevación se dispara por DOS caminos complementarios (ambos delegados por
 * el orquestador, tarea 18):
 *
 *   (a) PROACTIVO — `ensureCanWrite(gameRoot, entries)`, antes de escribir: si la
 *       instancia actual ya está elevada, procede directo; si no, y la heurística
 *       (`needsElevation`) dice que hará falta, relanza con `runas`.
 *   (b) REACTIVO — `handleWriteFailure(error, pending, entries)`, tras un fallo
 *       real de escritura con `EACCES`/`EPERM`: si la instancia ya está elevada,
 *       el fallo NO es por permisos y se propaga (`already-writable`); si no,
 *       eleva y reintenta en la instancia elevada. Un error que NO es de permisos
 *       nunca dispara elevación. Este camino cubre el caso de una biblioteca en
 *       otro disco (p. ej. `D:\SteamLibrary`) con permisos restringidos que la
 *       heurística de path del camino proactivo no predice.
 *
 * Ambos caminos chequean `isElevated()` PRIMERO: una vez elevada tras el primer
 * relanzo, la app **permanece elevada durante toda la sesión** y NO vuelve a
 * pedir UAC (elevación UNA VEZ POR SESIÓN, no por operación; design.md Decisión 2
 * del "Ciclo de vida de la elevación"). El relanzo `runas` solo ocurre si se
 * necesita elevar Y la instancia actual todavía NO está elevada.
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN 1 — DIVERGENCIA CONSCIENTE de las firmas de `relaunchElevated`,
 * `ensureCanWrite` y `handleWriteFailure` respecto de design.md: todas reciben
 * un parámetro adicional `entries: readonly AddonManifestEntry[]`.
 *
 * design.md (sección "ElevationService") publica:
 *   - `relaunchElevated(pending: PendingOperation): Promise<void>`
 *   - `ensureCanWrite(gameRoot: string): Promise<ElevationOutcome>`
 *   - `handleWriteFailure(error, pending: PendingOperation): Promise<ElevationOutcome>`
 *
 * Pero la tarea 17.1 exige que, **ANTES de relanzar**, `relaunchElevated`
 * persista el Active_Set candidato (selección + Priority_Order) vía
 * `LocalStore.savePendingSession(entries)`, para que la instancia elevada lo
 * REHIDRATE leyéndolo del LocalStore (`getPendingSession`) y NO de la línea de
 * comando. El conflicto: `savePendingSession(entries: AddonManifestEntry[])`
 * REQUIERE las `entries`, pero la `PendingOperation` —por diseño explícito— NO
 * las lleva: transporta SOLO lo mínimo (`type` + `resumeHandle`) para evitar
 * serializar el Active_Set entero en argumentos y chocar con el límite de
 * longitud de línea de comando (el mismo problema afrontado con `vpk x` y su
 * batching). Es decir: la firma publicada de `relaunchElevated` DESCARTA un dato
 * (las `entries`) que un requisito de la MISMA tarea necesita para cumplirse.
 *
 * Por eso las firmas REALES divergen del documento, agregando
 * `entries: readonly AddonManifestEntry[]`:
 *   - `relaunchElevated(pending, entries)` — persiste `entries` con
 *     `savePendingSession(entries)` ANTES de intentar el relanzo.
 *   - `ensureCanWrite(gameRoot, entries, operationType)` y `handleWriteFailure(error,
 *     pending, entries)` — CASCADEAN: ambas invocan a `relaunchElevated` internamente
 *     cuando hace falta elevar, así que deben poder pasarle las `entries`. Además,
 *     `ensureCanWrite` recibe el `operationType` REAL (P-15, RESUELTO en la Sección 18)
 *     para construir la `PendingOperation` con el `type` correcto en vez de hardcodear
 *     `"applyActiveSet"`.
 *
 * `PendingOperation` y `ElevationOutcome` (types.ts) NO cambian: siguen
 * correctos tal cual. La `PendingOperation` sigue llevando solo `type` +
 * `resumeHandle` (lo que viaja por argumentos/archivo a la instancia elevada);
 * las `entries` NO viajan por ahí — se persisten en el LocalStore y la instancia
 * elevada las rehidrata desde ahí. El parámetro extra es un dato que vive del
 * lado del que RELANZA (para persistir antes de irse), no del payload que cruza
 * a la instancia elevada.
 *
 * PRECEDENTE: es exactamente el mismo criterio de la DECISIÓN 6 de
 * `merge-engine.ts`, donde la firma `merge(...): Promise<string>` de design.md
 * descartaba el `MergeReport` que un requisito (7.1) necesitaba, y se divergió
 * conscientemente a `Promise<{ vpkPath, report }>`. Aquí, análogamente, la firma
 * publicada descartaba las `entries` que la tarea 17.1 necesita persistir. Ambas
 * divergencias quedan registradas en `Context/04-historial-decisiones.md`. Quien
 * lea design.md NO debe asumir que estas firmas siguen siendo las publicadas.
 * ---------------------------------------------------------------------------
 * DECISIÓN 2 — Proveedor de SO inyectable (`ElevationOsProvider`), mismo patrón
 * que `ProcessListProvider` (ProcessGuard) / `CommandRunner` (VpkTool).
 *
 * El core NO llama directo a ninguna API del sistema. Todo efecto dependiente
 * del SO (saber si el proceso corre elevado, hacer una escritura de prueba,
 * relanzar con el verbo `runas`) se delega en un {@link ElevationOsProvider}
 * inyectado por constructor, junto con el {@link LocalStore}. Así la LÓGICA DE
 * DECISIÓN de los dos caminos (proactivo/reactivo) queda PURA y aislable de los
 * efectos de I/O reales, y los tests inyectan un doble en memoria (mismo criterio
 * que el resto del dominio).
 *
 * Igual que `ProcessListProvider` en ProcessGuard, este módulo define SOLO el
 * CONTRATO inyectable; la IMPLEMENTACIÓN REAL de producción del proveedor
 * (Windows) queda pendiente para la capa de composición (orquestador tarea 18 /
 * IPC tarea 20 / arranque de la app). No obstante, se documenta abajo el
 * mecanismo concreto previsto para cada operación, para que quien implemente el
 * proveedor real siga el diseño ya acordado:
 *
 *   - `isElevated()` (mecanismo real previsto en Windows): intentar una operación
 *     que sólo un administrador puede hacer y ver si tiene éxito, o consultar el
 *     token del proceso. El enfoque simple acordado para el MVP es ejecutar
 *     `net session` (o `fltmc`/`whoami /groups`) y considerar elevado si retorna
 *     éxito; alternativamente, en Electron, chequear si se puede escribir en una
 *     ruta protegida. El core NO fija cuál: solo consume el booleano.
 *   - `probeWrite(dir)` (escritura de prueba): crear y borrar un archivo temporal
 *     efímero bajo `dir`. Resuelve `true` si la escritura tuvo éxito; si falla por
 *     `EACCES`/`EPERM`, resuelve `false`. Cualquier otro error (p. ej. `ENOENT`
 *     porque el dir no existe) es problema del proveedor real, no de la heurística.
 *   - `relaunchAsAdmin(pending)` (mecanismo real previsto): re-lanzar la PROPIA
 *     app con el verbo `runas` de Windows, que dispara el prompt UAC. El enfoque
 *     acordado para el MVP (design.md, "Alternativa considerada") es invocar
 *     `Start-Process -FilePath <exe> -Verb RunAs -ArgumentList <args>` vía
 *     PowerShell/`child_process` (o `ShellExecuteEx` con `lpVerb="runas"`), en vez
 *     de empaquetar un helper elevado dedicado. Los `args` llevan el payload
 *     MÍNIMO de la `PendingOperation` (`type` + `resumeHandle`), nunca el
 *     Active_Set. Ver más abajo cómo comunica la cancelación del UAC.
 * ---------------------------------------------------------------------------
 * DECISIÓN 3 — Cómo `relaunchAsAdmin` comunica la cancelación del UAC: devuelve
 * un {@link RelaunchOutcome} (`"launched" | "cancelled"`), NO lanza para el caso
 * de cancelación.
 *
 * Cuando el usuario cancela el prompt UAC, `runas`/`ShellExecute` falla con un
 * error específico de "operación cancelada por el usuario" (en Windows,
 * `ERROR_CANCELLED` / código 1223). Ese NO es un fallo excepcional del programa:
 * es una respuesta ESPERADA del flujo (el usuario dijo que no). Modelarlo como
 * un `throw` obligaría a envolver cada llamada en try/catch y a distinguir el
 * código de error del SO dentro del core. En su lugar, el contrato del proveedor
 * es explícito: `relaunchAsAdmin` resuelve
 *   - `"launched"`  — la instancia elevada se lanzó (esta instancia debe ceder).
 *   - `"cancelled"` — el usuario canceló el UAC.
 * Cualquier OTRO fallo (el SO no pudo lanzar por una razón inesperada) SÍ se
 * propaga como excepción del proveedor, y el core la deja propagar (no es una
 * cancelación ni un "escribible"; el orquestador la reportará como error real).
 *
 * `ElevationService.relaunchElevated` traduce ese `RelaunchOutcome` a un
 * {@link ElevationOutcome}: `"launched"` -> `elevated-handoff`; `"cancelled"` ->
 * `denied`. Persistir la sesión pendiente ocurre SIEMPRE antes de llamar al
 * proveedor; si el usuario luego cancela, el orquestador puede limpiar con
 * `clearPendingSession()` (fuera del alcance de este servicio).
 * ---------------------------------------------------------------------------
 * DECISIÓN 4 — Reconocimiento de errores de permisos: `EACCES`/`EPERM` por
 * `error.code`, case-sensitive sobre el string estándar de Node.
 *
 * `handleWriteFailure` clasifica el error entrante mirando `error.code`. Solo
 * `"EACCES"` y `"EPERM"` (los dos códigos que Node/libuv reportan ante falta de
 * permisos de escritura) se tratan como "posible falta de elevación" y disparan
 * el camino de elevación. Cualquier otro `code` (p. ej. `"ENOENT"`, `"EBUSY"`,
 * `"EEXIST"`) o un error sin `code` NO es de permisos: se devuelve
 * `already-writable` para que el orquestador PROPAGUE el error original tal cual,
 * sin elevar. (`already-writable` aquí significa "no es asunto de elevación",
 * coherente con la semántica del `ElevationOutcome`.)
 * ---------------------------------------------------------------------------
 */

import type { LocalStore } from "./local-store.js";
import type {
  AddonManifestEntry,
  ElevationOutcome,
  MergeProgressListener,
  PendingOperation,
} from "./types.js";

/**
 * Directorios protegidos del sistema bajo los que una escritura típicamente
 * requiere elevación (comparación case-insensitive; ver {@link isProtectedPath}).
 * Se cubren las dos variantes de `Program Files` de Windows de 64 bits.
 */
export const PROTECTED_PATH_PREFIXES: readonly string[] = [
  "c:\\program files (x86)\\",
  "c:\\program files\\",
];

/** Códigos de error de Node/libuv que indican falta de permisos (DECISIÓN 4). */
export const PERMISSION_ERROR_CODES: readonly string[] = ["EACCES", "EPERM"];

/**
 * Resultado del intento de relanzo elevado del proveedor de SO (DECISIÓN 3).
 *
 * - `"launched"`  — la instancia elevada se lanzó; esta instancia cede el trabajo.
 * - `"cancelled"` — el usuario canceló el prompt UAC.
 *
 * Cualquier otro fallo del lanzamiento se propaga como excepción del proveedor
 * (no se modela como valor), y `ElevationService` lo deja propagar.
 */
export type RelaunchOutcome = "launched" | "cancelled";

/**
 * Proveedor de SO inyectable de ElevationService (DECISIÓN 2). Reúne los ÚNICOS
 * efectos dependientes del sistema que el servicio necesita. Es un puerto neutro:
 * en producción se implementa contra Windows (token de proceso + `runas`) y en
 * los tests con un doble en memoria. La implementación real de producción queda
 * PENDIENTE para la capa de composición (tareas 18/20), igual que
 * `ProcessListProvider` de ProcessGuard.
 */
export interface ElevationOsProvider {
  /**
   * ¿El proceso actual ya corre con privilegios de administrador? Síncrono: es
   * un chequeo del token/estado del proceso actual, no una operación de I/O
   * bloqueante prolongada.
   */
  isElevated(): boolean;
  /**
   * Escritura de prueba (probe write) bajo `dir`: intenta crear/borrar un archivo
   * efímero. Resuelve `true` si la escritura fue posible; `false` si falló por
   * permisos (`EACCES`/`EPERM`). Es una OPTIMIZACIÓN proactiva, no la única vía
   * de elevación.
   */
  probeWrite(dir: string): Promise<boolean>;
  /**
   * Re-lanza la propia app con el verbo `runas` (prompt UAC), pasando el payload
   * mínimo de `pending` (nunca el Active_Set). Resuelve un {@link RelaunchOutcome}
   * (`"launched"` / `"cancelled"`); ver DECISIÓN 3. Cualquier otro fallo del
   * lanzamiento se propaga como excepción.
   */
  relaunchAsAdmin(pending: PendingOperation): Promise<RelaunchOutcome>;
}

/**
 * Contrato del servicio de elevación (design.md, sección "ElevationService"),
 * con las firmas divergentes de la DECISIÓN 1 (parámetro extra `entries`).
 */
export interface ElevationService {
  /** ¿`targetPath` cae bajo un directorio protegido del sistema (Program Files)? */
  isProtectedPath(targetPath: string): boolean;
  /** ¿El proceso actual ya corre elevado? (delega en el proveedor de SO). */
  isElevated(): boolean;
  /**
   * ¿La escritura en `gameRoot` necesitará elevación? `true` si `isProtectedPath`
   * O si una escritura de prueba (`probeWrite`) falla por permisos. Solo una
   * OPTIMIZACIÓN proactiva; no es la única vía de elevación (ver camino reactivo).
   */
  needsElevation(gameRoot: string): Promise<boolean>;
  /** Camino PROACTIVO. Ver {@link ElevationServiceImpl.ensureCanWrite}. */
  ensureCanWrite(
    gameRoot: string,
    entries: readonly AddonManifestEntry[],
    operationType: PendingOperation["type"],
    presetId?: string,
  ): Promise<ElevationOutcome>;
  /** Camino REACTIVO. Ver {@link ElevationServiceImpl.handleWriteFailure}. */
  handleWriteFailure(
    error: NodeJS.ErrnoException,
    pending: PendingOperation,
    entries: readonly AddonManifestEntry[],
  ): Promise<ElevationOutcome>;
  /**
   * Persiste el Active_Set candidato (`entries`) vía `LocalStore.savePendingSession`
   * y re-lanza la app elevada con la `PendingOperation` mínima. Ver DECISIÓN 1 y 3.
   */
  relaunchElevated(
    pending: PendingOperation,
    entries: readonly AddonManifestEntry[],
  ): Promise<ElevationOutcome>;
}

/** `true` si `error.code` es uno de los códigos de falta de permisos (DECISIÓN 4). */
export function isPermissionError(error: NodeJS.ErrnoException): boolean {
  return error.code !== undefined && PERMISSION_ERROR_CODES.includes(error.code);
}

/**
 * Implementación de {@link ElevationService}. La LÓGICA DE DECISIÓN de los dos
 * caminos es pura (solo consulta `isElevated`/`needsElevation` y decide); los
 * EFECTOS reales (probe write, relanzo `runas`) viven en el
 * {@link ElevationOsProvider} inyectado, y la persistencia de la sesión pendiente
 * en el {@link LocalStore} inyectado.
 */
export class ElevationServiceImpl implements ElevationService {
  readonly #os: ElevationOsProvider;
  readonly #store: LocalStore;
  /**
   * Listener OPCIONAL de progreso (BUG-004). Si se inyecta, `relaunchElevated`
   * emite `{ step: "restarting" }` JUSTO ANTES del relanzo `runas` (y por ende
   * antes de que esta instancia se cierre), para que la UI del renderer todavía
   * vivo avise el reinicio en vez de quedar congelada. Se inyecta el MISMO
   * broadcaster que consume el MergeOrchestrator (composition root), así el
   * evento viaja por el canal `merge:onProgress` ya existente. Si no se provee,
   * el servicio se comporta idéntico (no emite nada) — mismo criterio de
   * opcionalidad que `MergeOrchestratorDeps.onProgress`.
   */
  readonly #onProgress: MergeProgressListener | undefined;

  constructor(
    os: ElevationOsProvider,
    store: LocalStore,
    onProgress?: MergeProgressListener,
  ) {
    this.#os = os;
    this.#store = store;
    this.#onProgress = onProgress;
  }

  /**
   * `true` si `targetPath`, normalizado a minúsculas y con separadores `\`, cae
   * bajo alguno de los {@link PROTECTED_PATH_PREFIXES} (comparación
   * case-insensitive, como resuelve rutas Windows). NO hace I/O: es pura
   * heurística de path.
   */
  isProtectedPath(targetPath: string): boolean {
    const normalized = targetPath.replace(/\//g, "\\").toLowerCase();
    return PROTECTED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
  }

  isElevated(): boolean {
    return this.#os.isElevated();
  }

  /**
   * `true` si `gameRoot` está bajo una ruta protegida (heurística de path) O si
   * una escritura de prueba del proveedor falla por permisos. El short-circuit
   * evita el probe write innecesario cuando el path ya es claramente protegido.
   */
  async needsElevation(gameRoot: string): Promise<boolean> {
    if (this.isProtectedPath(gameRoot)) return true;
    const canWrite = await this.#os.probeWrite(gameRoot);
    return !canWrite;
  }

  /**
   * Camino PROACTIVO (garantiza capacidad de escritura ANTES de escribir):
   *   1. Chequea `isElevated()` PRIMERO: si la instancia actual ya está elevada,
   *      resuelve `already-writable` sin relanzar ni pedir UAC (elevación una vez
   *      por sesión).
   *   2. Si no está elevada y `needsElevation(gameRoot)` es `false`, resuelve
   *      `already-writable` (no hace falta elevar).
   *   3. Si no está elevada y `needsElevation` es `true`, delega en
   *      `relaunchElevated(pending, entries)` construyendo la `PendingOperation` con
   *      el `operationType` REAL que recibe del llamador (no un literal fijo), y
   *      devuelve su ElevationOutcome (`elevated-handoff` / `denied`).
   *
   * NOTA (pendiente P-15 — RESUELTO en la Sección 18, ver `Context/02-pendientes.md`):
   * el `type` de la `PendingOperation` del camino proactivo YA NO está hardcodeado.
   * `ensureCanWrite` recibe `operationType: PendingOperation["type"]` del llamador
   * (el MergeOrchestrator lo pasa según ejecute `applyActiveSet`/`addAddon`/
   * `removeAddon`/`switchActivePreset`), de modo que la instancia elevada reciba
   * el tipo CORRECTO. El parámetro se suma con el MISMO criterio de la DECISIÓN 1
   * (divergencia consciente de design.md): el documento publica
   * `ensureCanWrite(gameRoot)` sin `entries` ni `operationType`, pero ambos son
   * datos que el camino proactivo necesita para construir la `PendingOperation`
   * correcta y persistir el candidato antes de relanzar.
   *
   * `presetId` (P-30, Paso 3.5, cierra DECISIÓN 8 de `merge-orchestrator.ts`):
   * OPCIONAL, presente SOLO cuando `operationType === "switchActivePreset"`. Se
   * incluye en la `PendingOperation` construida para que, si hace falta elevar,
   * la instancia elevada sepa hacia QUÉ preset resumir el switch (en vez de caer,
   * incorrectamente, al camino legado de `applyActiveSet` hacia `modsvs`).
   */
  async ensureCanWrite(
    gameRoot: string,
    entries: readonly AddonManifestEntry[],
    operationType: PendingOperation["type"],
    presetId?: string,
  ): Promise<ElevationOutcome> {
    if (this.#os.isElevated()) return { kind: "already-writable" };
    if (!(await this.needsElevation(gameRoot))) return { kind: "already-writable" };
    const pending: PendingOperation =
      presetId !== undefined
        ? { type: operationType, resumeHandle: PENDING_SESSION_HANDLE, presetId }
        : { type: operationType, resumeHandle: PENDING_SESSION_HANDLE };
    return this.relaunchElevated(pending, entries);
  }

  /**
   * Camino REACTIVO (tras un fallo de escritura REAL):
   *   1. Si el error NO es de permisos (`EACCES`/`EPERM`), resuelve
   *      `already-writable`: no es asunto de elevación; el orquestador debe
   *      propagar el error original tal cual (DECISIÓN 4).
   *   2. Si es de permisos y la instancia ya está elevada, resuelve
   *      `already-writable`: el fallo NO se debe a falta de privilegios (ya se
   *      tienen) y debe propagarse; NO se relanza.
   *   3. Si es de permisos y NO está elevada, delega en `relaunchElevated(pending,
   *      entries)` para que la instancia elevada reintente la operación pendiente,
   *      en vez de abortar.
   */
  async handleWriteFailure(
    error: NodeJS.ErrnoException,
    pending: PendingOperation,
    entries: readonly AddonManifestEntry[],
  ): Promise<ElevationOutcome> {
    if (!isPermissionError(error)) return { kind: "already-writable" };
    if (this.#os.isElevated()) return { kind: "already-writable" };
    return this.relaunchElevated(pending, entries);
  }

  /**
   * Persiste el Active_Set candidato (`entries`) con `LocalStore.savePendingSession`
   * ANTES de intentar el relanzo (tarea 17.1 / DECISIÓN 1), de modo que la
   * instancia elevada lo rehidrate del LocalStore (`getPendingSession`) y NO de la
   * línea de comando. Luego pide al proveedor relanzar con `runas` y traduce el
   * {@link RelaunchOutcome} a {@link ElevationOutcome} (DECISIÓN 3):
   *   - `"launched"`  -> `elevated-handoff` (esta instancia cede el trabajo).
   *   - `"cancelled"` -> `denied` (el usuario canceló el UAC).
   * Un fallo inesperado del lanzamiento se propaga como excepción.
   */
  async relaunchElevated(
    pending: PendingOperation,
    entries: readonly AddonManifestEntry[],
  ): Promise<ElevationOutcome> {
    // Persistir SIEMPRE antes de relanzar: la instancia elevada rehidrata desde
    // el LocalStore, no desde los args. `entries` puede ser [] (Active_Set
    // candidato intencionalmente vacío; ver DECISIÓN 5 de local-store.ts).
    this.#store.savePendingSession([...entries]);
    // BUG-004: avisar al renderer todavía vivo JUSTO ANTES del relanzo `runas`
    // (que dispara el prompt UAC y, tras aceptarse, lleva al cierre de esta
    // instancia). Emitir acá y no después es deliberado: una vez que `runas`
    // relanza y la instancia se cierra, ya no hay renderer al que avisarle. El
    // evento viaja por el mismo canal de progreso; si no hay listener inyectado,
    // es un no-op.
    this.#onProgress?.({ step: "restarting" });
    const outcome = await this.#os.relaunchAsAdmin(pending);
    if (outcome === "cancelled") {
      return { kind: "denied", reason: "El usuario canceló el prompt de UAC." };
    }
    return { kind: "elevated-handoff" };
  }
}

/**
 * `resumeHandle` de la sesión pendiente. Hoy hay un único estado de sesión
 * pendiente en el LocalStore (una sola sesión candidata activa a la vez; ver
 * DECISIÓN 5 de `local-store.ts`), así que el handle es un literal fijo que la
 * instancia elevada usa para saber que debe leer `getPendingSession()`. Se deja
 * como constante nombrada para no esparcir el literal por el código.
 */
export const PENDING_SESSION_HANDLE = "pending-session";
