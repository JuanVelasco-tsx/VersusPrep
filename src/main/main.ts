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
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";
import type { BrowserWindow } from "electron";

import { ChildProcessCommandRunner } from "./data/child-process-command-runner.js";
import { pathExists } from "./data/node-fs-helpers.js";
import { resolveCoverPath } from "./domain/index.js";
import {
  buildPathIndependentDomain,
  runStartupSequence,
} from "./app/composition-root.js";
import type { ResumeState } from "./app/ipc-contract.js";
import { createProgressBroadcaster, registerIpcHandlers } from "./app/ipc-handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap(): Promise<void> {
  const { app, BrowserWindow: BrowserWindowCtor, dialog, ipcMain, net, protocol } =
    await import("electron");

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

  const base = buildPathIndependentDomain({
    commandRunner,
    dialog,
    spawnSyncFn: { spawnSync },
    db,
  });

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

  let mainWindow: BrowserWindow | null = null;
  const broadcaster = createProgressBroadcaster(() => mainWindow?.webContents);

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

  // Buffer de resume (D2a-i): lectura de un solo uso; se limpia tras el
  // primer replay que pida el renderer via activeSet:resumeState.
  let resumeState: ResumeState | null = outcome.resumeState;
  const getResumeState = (): ResumeState | null => {
    const current = resumeState;
    resumeState = null;
    return current;
  };

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
  });

  app.on("activate", () => {
    if (BrowserWindowCtor.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}

// Solo arranca Electron cuando se ejecuta como proceso main real, no al ser
// importado por herramientas de analisis/tests.
if (process.versions.electron !== undefined) {
  void bootstrap();
}