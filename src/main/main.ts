/**
 * Punto de entrada del proceso main de Electron (esqueleto de la Tarea 1).
 *
 * Alcance intencionalmente mínimo: la Tarea 1 solo deja el proyecto compilando y
 * el andamiaje listo. El wiring real (ventana, IPC/preload, orquestador) llega
 * en tareas posteriores (20+). Aquí solo se crea una ventana básica cuando la
 * app está lista, sin cargar UI compleja.
 *
 * Se importa dinámicamente `electron` para que el módulo compile y sea analizable
 * por tsc sin exigir el runtime de Electron durante los tests del núcleo.
 */

async function bootstrap(): Promise<void> {
  const { app, BrowserWindow } = await import("electron");

  await app.whenReady();

  const createWindow = (): void => {
    const win = new BrowserWindow({
      width: 1024,
      height: 720,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // Placeholder: la UI del renderer se construye en la tarea 21.
    void win.loadURL(
      "data:text/html,<h1>L4D2 Versus Addon Manager</h1><p>Andamiaje inicial.</p>",
    );
  };

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
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
// importado por herramientas de análisis/tests.
if (process.versions.electron !== undefined) {
  void bootstrap();
}
