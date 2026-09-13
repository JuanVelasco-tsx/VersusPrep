/**
 * Punto de entrada del proceso main de Electron (bloque 5b de la Tarea 20.4:
 * wiring final del composition root).
 *
 * Importa "electron" dinamicamente (mismo patron de la Tarea 1) para que el
 * modulo compile y sea analizable por tsc sin exigir el runtime de Electron;
 * import type { BrowserWindow } se usa solo para tipar, no arrastra runtime.
 * El resto de los imports (better-sqlite3, node:*, composition-root,
 * ipc-handlers, ChildProcessCommandRunner) son estaticos: ninguno depende
 * del runtime de Electron para cargar.
 *
 * DECISION R (ruta del preload en ESM): sin __dirname disponible bajo
 * NodeNext/ESM, se deriva de import.meta.url via fileURLToPath (patron
 * estandar de Node ESM), NO de app.getAppPath() (que en dev apunta a la raiz
 * del proyecto, no a dist/). El build real compila main.ts a
 * dist/src/main/main.js y preload.ts a dist/src/preload/preload.js, asi que el
 * relativo entre ambos es "../preload/preload.js" (ambos comparten el nivel
 * dist/src/, main baja a main/ y preload a preload/).
 */
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import type { BrowserWindow } from "electron";

import { ChildProcessCommandRunner } from "./data/child-process-command-runner.js";
import { pathExists } from "./data/node-fs-helpers.js";
import { resolveCoverPath, TitleCache } from "./domain/index.js";
import {
  buildPathIndependentDomain,
  runStartupSequence,
} from "./app/composition-root.js";
import type { ResumeState } from "./app/ipc-contract.js";
import { createProgressBroadcaster, registerIpcHandlers } from "./app/ipc-handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap(): Promise<void> {
  const { app, BrowserWindow: BrowserWindowCtor, dialog, ipcMain, Menu, net, protocol } =
    await import("electron");

  // ---------------------------------------------------------------------------
  // DIAGNOSTICO (crash.log): instrumentacion minima para el bug "la app se abre
  // y se cierra sola" tras la elevacion UAC, sin error visible. SOLO agrega
  // logging; NO cambia ningun comportamiento funcional. Ver los puntos de log
  // en onElevatedHandoff, window-all-closed, render-process-gone y los dos
  // handlers de proceso de abajo.
  //
  // DECISION D-LOG-1 (escritura SINCRONA en append): se usa appendFileSync
  // (flag implicito "a") en vez de la API async, para GARANTIZAR que la entrada
  // quede en disco ANTES de que el proceso muera (un write async podria no
  // alcanzar a vaciarse si el proceso sale de inmediato). Cada entrada lleva un
  // timestamp ISO. La ruta vive en app.getPath("userData") (disponible apenas
  // resuelve import("electron"), NO requiere app.whenReady()). El propio
  // logging es best-effort: si escribir falla, se traga el error para no
  // introducir una nueva causa de cierre.
  // ---------------------------------------------------------------------------
  const nlSep = "\r\n";
  const crashLogPath = path.join(app.getPath("userData"), "crash.log");
  const logCrash = (label: string, detail?: unknown): void => {
    try {
      const stamp = new Date().toISOString();
      // Serializa el detalle segun su forma: un Error va con stack completo;
      // un objeto (p. ej. el payload del comando de relanzo elevado) va como
      // JSON legible (evita "[object Object]"); un primitivo, como String.
      let body = "";
      if (detail instanceof Error) {
        body = detail.stack ?? `${detail.name}: ${detail.message}`;
      } else if (detail !== undefined) {
        try {
          body = typeof detail === "object" && detail !== null
            ? JSON.stringify(detail, null, 2)
            : String(detail);
        } catch {
          body = String(detail);
        }
      }
      const line = body ? `[${stamp}] ${label}${nlSep}${body}${nlSep}${nlSep}` : `[${stamp}] ${label}${nlSep}`;
      appendFileSync(crashLogPath, line, "utf8");
    } catch {
      // best-effort: nunca dejamos que el logging de diagnostico tumbe el proceso.
    }
  };

  // DECISION D-LOG-2 (handlers de proceso ANTES de app.whenReady()): se
  // registran uncaughtException y unhandledRejection lo antes posible dentro de
  // bootstrap (antes de whenReady) para capturar un stack completo ante
  // cualquier excepcion no atrapada o promesa rechazada sin manejar que hoy
  // mataria el proceso sin dejar rastro visible. Solo loguean; no alteran el
  // flujo (uncaughtException deja que el comportamiento por defecto de Node/
  // Electron siga su curso).
  process.on("uncaughtException", (err) => {
    logCrash("uncaughtException", err);
  });
  process.on("unhandledRejection", (reason) => {
    logCrash("unhandledRejection", reason);
  });

  // (P-32) Quitar la barra de menu nativa de Electron ("File / Edit / View /
  // Window" del boilerplate por defecto). La app usa un titlebar propio
  // (sesion de Claude Design), asi que el menu nativo es sobrante y no forma
  // parte del diseno. `setApplicationMenu(null)` elimina el menu de la ventana
  // (en Windows/Linux tambien remueve la franja de menu del marco). NO se
  // pierden atajos: la app NO define aceleradores/roles propios via Menu ni
  // globalShortcut (los atajos de edicion estandar -copiar/pegar/seleccionar-
  // siguen funcionando en los inputs del renderer, porque los provee Chromium
  // a nivel de webContents, no el menu de aplicacion).
  Menu.setApplicationMenu(null);

  // Esquema del protocolo custom de covers (Tarea 21.1, Bloque 1). DEBE
  // registrarse como privileged ANTES de app.whenReady() para que un
  // <img src="l4d2cover://local/<id>"> cargue sin friccion desde el origen
  // http://localhost:5173 (dev) o file:// del build (prod). standard=true da
  // parsing de URL con host/path; secure + supportFetchAPI lo habilitan bajo
  // paginas https/http sin que webSecurity lo bloquee.
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "l4d2cover",
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);

  await app.whenReady();

  const db = new Database(path.join(app.getPath("userData"), "store.sqlite"));
  app.on("before-quit", () => db.close());

  const commandRunner = new ChildProcessCommandRunner();

  // La ventana y el broadcaster se declaran ANTES de construir el dominio para
  // poder inyectar el broadcaster al ElevationServiceImpl (BUG-004: emite
  // `restarting` antes del relanzo). El broadcaster captura `mainWindow` por
  // closure: aunque acá todavía sea null, para cuando se emita cualquier evento
  // la ventana ya existe (se crea más abajo, antes del resume).
  let mainWindow: BrowserWindow | null = null;
  const broadcaster = createProgressBroadcaster(() => mainWindow?.webContents);

  const base = buildPathIndependentDomain({
    commandRunner,
    dialog,
    spawnSyncFn: { spawnSync },
    db,
    onProgress: broadcaster,
  });

  // (BUG-001) Cache de títulos EN MEMORIA, compartido por el handler de scan
  // (lo puebla) y el de getTitles (lo lee). Una sola instancia para toda la
  // sesión; vive lo que vive el proceso.
  const titleCache = new TitleCache();

  // Handler del protocolo custom de covers (Tarea 21.1, Bloque 1). Se registra
  // tras whenReady (protocol.handle exige app ready) y una vez construido `base`
  // (necesita localStore.getPaths()). La logica pura de validacion+resolucion
  // vive en resolveCoverPath (dominio); aca solo se cablea el I/O: leer la
  // Workshop_Folder del store, chequear existencia con el FS real, y traducir el
  // resultado a Response. Un id invalido, rutas no detectadas o archivo ausente
  // devuelven una Response de error controlada (nunca un throw que tumbe el
  // handler). El path resuelto se sirve via net.fetch sobre file:// (patron
  // moderno de protocol.handle en Electron 44).
  protocol.handle("l4d2cover", async (request) => {
    // El <id> va en el PATHNAME (`l4d2cover://local/<id>`), NUNCA en el host.
    // Host FIJO literal "local" (Context/04-historial-decisiones.md, fix
    // confirmado via CDP): con el esquema registrado como standard:true, un
    // host VACIO (`l4d2cover:///<id>`, tres barras) NO sobrevive el parseo de
    // Chromium para un id numerico - Chromium recupera el host vacio
    // consumiendo el primer segmento del path como host, y al ser puramente
    // numerico lo canonicaliza como IPv4 (comprobado con
    // l4d2cover:///3237709870 -> request.url real
    // "l4d2cover://192.251.136.46/", pathname vacio, 400 invalid-id). Un host
    // FIJO no numerico evita esa heuristica por completo. El pathname sigue
    // siendo la unica fuente del id; NO leer el id del host.
    const { pathname } = new URL(request.url);
    const id = decodeURIComponent(pathname.replace(/^\//, ""));
    const workshopFolder = base.localStore.getPaths()?.workshopFolder ?? null;
    const resolution = await resolveCoverPath(id, workshopFolder, pathExists);
    if (!resolution.ok) {
      const status = resolution.reason === "not-found" ? 404 : 400;
      return new Response(null, { status });
    }
    return net.fetch(pathToFileURL(resolution.absolutePath).href);
  });

  const outcome = await runStartupSequence(base, {
    argv: process.argv,
    commandRunner,
    tempDir: path.join(os.tmpdir(), "l4d2-vam-scan-temp"),
    workRoot: path.join(os.tmpdir(), "l4d2-vam-work"),
    broadcaster,
  });

  if (outcome.kind === "fatal") {
    dialog.showErrorBox("L4D2 Versus Addon Manager", outcome.message);
    app.quit();
    return;
  }

  // (BUG-004, A1) El resume ya NO corrió en el startup: se dispara mas abajo,
  // DESPUES de crear la ventana. `getResumeState` delega en `readResumeState`
  // del outcome, que devuelve el estado ACTUAL (en curso -> `result: null`;
  // terminado -> `result` con el OperationResult). Ya NO es "lectura de un solo
  // uso que limpia": con `isResuming`, el renderer relee para obtener el
  // resultado terminal tras ver el evento final por `merge:onProgress`.
  const getResumeState = (): ResumeState | null => outcome.readResumeState();

  const createWindow = (): void => {
    mainWindow = new BrowserWindowCtor({
      width: 1024,
      height: 720,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "../preload/preload.js"),
      },
    });
    // Carga del renderer (Seccion 21). En dev (no empaquetado) apunta al dev
    // server de Vite con HMR; en prod carga el HTML buildeado por Vite. El
    // build de Vite emite en dist/renderer/ y main.ts corre desde
    // dist/src/main/, de ahi el relativo ../../renderer/index.html.
    if (app.isPackaged) {
      void mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"));
    } else {
      void mainWindow.loadURL("http://localhost:5173");
    }
    // (DIAGNOSTICO crash.log) Captura un crash del PROCESO DE RENDER (que hoy no
    // se registra en ningun lado): si el renderer muere (crash/oom/killed), la
    // ventana puede desaparecer sin error visible. `details.reason` dice el
    // motivo (crashed | oom | killed | ...). Solo loguea; no altera el flujo.
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      logCrash(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    });
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  };

  createWindow();

  registerIpcHandlers(ipcMain, {
    pathDetector: base.pathDetector,
    addonScanner: outcome.pathDependent.addonScanner,
    vscriptDetector: outcome.pathDependent.vscriptDetector,
    localStore: base.localStore,
    mergeOrchestrator: outcome.pathDependent.mergeOrchestrator,
    getResumeState,
    getIsResuming: () => outcome.isResuming,
    titleCache,
    getWillNeedElevation: () => outcome.willNeedElevation,
    // Handoff de elevación (fix del "reemplazo total, no coexisten" del diseño,
    // ElevationService Decisión 1 / tarea 17.1): cuando una operación resuelve
    // `status: "elevating"`, esta instancia SIN privilegios se cierra para ceder
    // el trabajo a la instancia elevada ya relanzada. Se usa app.quit() (NO
    // app.exit) para disparar el `before-quit` que cierra limpio la DB de
    // better-sqlite3 (ver el `app.on("before-quit", () => db.close())` de arriba).
    onElevatedHandoff: () => {
      // (DIAGNOSTICO crash.log) Motivo exacto del cierre: handoff de elevacion.
      logCrash("quit: onElevatedHandoff disparado (cesion a instancia elevada)");
      app.quit();
    },
  });

  // (BUG-004, A1) Disparar el resume DESPUES de crear la ventana y registrar los
  // handlers, y SIN await: la ventana ya está viva y el renderer, al montar,
  // consulta `isResuming` (true) y escucha `merge:onProgress` en vivo, de modo
  // que ve el progreso del resume con continuidad en vez de una ventana en
  // blanco mientras se reconstruye. `runResume` es no-op si este proceso no
  // arrancó para resumir. Un fallo inesperado del resume no debe tumbar el
  // arranque; se registra (el resultado terminal, éxito o error, ya viaja por
  // readResumeState()/getResumeState para que la UI lo muestre).
  void outcome.runResume().catch((error: unknown) => {
    // Red de seguridad de ÚLTIMO recurso: `runResume` ya captura internamente
    // las excepciones del resume y las traduce a un resultado terminal de fallo
    // en `resumeState` (BUG-004), así que este catch normalmente no se alcanza.
    // Se deja por si algo fuera del try/catch de `runResume` fallara, para no
    // dejar una promesa rechazada sin manejar.
    console.error("El resume de la sesión pendiente falló de forma inesperada.", error);
  });

  app.on("activate", () => {
    if (BrowserWindowCtor.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      // (DIAGNOSTICO crash.log) Motivo exacto del cierre: se cerraron todas las
      // ventanas. Se registra el estado de mainWindow para distinguir un cierre
      // normal del usuario de un cierre por ventana que nunca llego a existir /
      // se destruyo sola (mainWindow === null).
      logCrash(
        `quit: window-all-closed, mainWindow era ${mainWindow === null ? "null" : "no-null"}`,
      );
      app.quit();
    }
  });
}

// Solo arranca Electron cuando se ejecuta como proceso main real, no al ser
// importado por herramientas de analisis/tests.
if (process.versions.electron !== undefined) {
  void bootstrap();
}