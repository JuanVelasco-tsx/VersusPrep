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
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import type { BrowserWindow } from "electron";

import { ChildProcessCommandRunner } from "./data/child-process-command-runner.js";
import {
  buildPathIndependentDomain,
  runStartupSequence,
} from "./app/composition-root.js";
import type { ResumeState } from "./app/ipc-contract.js";
import { createProgressBroadcaster, registerIpcHandlers } from "./app/ipc-handlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap(): Promise<void> {
  const { app, BrowserWindow: BrowserWindowCtor, dialog, ipcMain } = await import(
    "electron"
  );

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
    // Placeholder: la UI del renderer se construye en la Tarea 21.
    void mainWindow.loadURL(
      "data:text/html,<h1>L4D2 Versus Addon Manager</h1><p>Andamiaje inicial.</p>",
    );
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