/**
 * ManualPathProvider real (Tarea 20.4, bloque 2): abre el selector nativo de
 * archivo/carpeta de Electron via dialog.showOpenDialog.
 *
 * DECISION D2 (bloque 2): sin ventana modal. Hoy no hay ninguna BrowserWindow
 * accesible fuera de main.ts#createWindow (const local, sin getter ni
 * referencia a nivel de modulo), y el composition root (bloque 5 de la 20.4)
 * todavia no existe. Se usa la sobrecarga showOpenDialog(options), sin
 * BaseWindow. Si mas adelante se necesita modalidad, es un cambio aislado a
 * este archivo (agregar el parametro window al constructor), no una
 * reescritura del proveedor.
 *
 * DECISION E1 (bloque 2): el dialog real de Electron se inyecta como
 * Pick<Dialog, "showOpenDialog"> (mismo patron que Pick<WebContents,"send">
 * en createProgressBroadcaster y Pick<IpcMain,"handle"> en fakeIpcMain), para
 * poder testear el mapeo kind/pathKey -> OpenDialogOptions y
 * OpenDialogReturnValue -> ManualPathResponse sin el runtime de Electron.
 */
import type { Dialog, OpenDialogOptions, OpenDialogReturnValue } from "electron";

import type {
  ManualPathProvider,
  ManualPathRequest,
  ManualPathResponse,
  RequiredPathKey,
} from "../domain/index.js";

/**
 * Deriva las OpenDialogOptions para cada RequiredPathKey (AC 1.9): carpeta
 * para gameRoot/workshopFolder/modsvsFolder, archivo con filtro de extension
 * para vpkToolPath (.exe) y gameInfoFile (.txt). Exportada para test aislado.
 */
export function toRequiredPathOptions(pathKey: RequiredPathKey): OpenDialogOptions {
  switch (pathKey) {
    case "gameRoot":
      return {
        title: "Seleccioná la carpeta de Left 4 Dead 2 (Game_Root)",
        properties: ["openDirectory"],
      };
    case "workshopFolder":
      return {
        title: "Seleccioná la carpeta de Workshop (addons\\workshop)",
        properties: ["openDirectory"],
      };
    case "modsvsFolder":
      return {
        title: "Seleccioná la carpeta modsvs",
        properties: ["openDirectory"],
      };
    case "vpkToolPath":
      return {
        title: "Seleccioná vpk.exe",
        properties: ["openFile"],
        filters: [{ name: "vpk.exe", extensions: ["exe"] }],
      };
    case "gameInfoFile":
      return {
        title: "Seleccioná gameinfo.txt",
        properties: ["openFile"],
        filters: [{ name: "gameinfo.txt", extensions: ["txt"] }],
      };
  }
}

/**
 * Deriva las OpenDialogOptions para un ManualPathRequest completo. Los kind
 * steam-path (AC 1.2) y game-root (AC 1.4/1.6) son siempre carpeta;
 * required-path (AC 1.10) delega en toRequiredPathOptions segun el pathKey.
 * Exportada para test aislado.
 */
export function toOpenDialogOptions(request: ManualPathRequest): OpenDialogOptions {
  switch (request.kind) {
    case "steam-path":
      return {
        title: "Seleccioná la carpeta de instalación de Steam",
        properties: ["openDirectory"],
      };
    case "game-root":
      return {
        title: "Seleccioná la carpeta de Left 4 Dead 2 (Game_Root)",
        properties: ["openDirectory"],
      };
    case "required-path":
      return toRequiredPathOptions(request.pathKey);
  }
}

/**
 * Mapea el resultado crudo de Electron a ManualPathResponse. Defensivo ante
 * filePaths vacio incluso con canceled=false (no deberia pasar segun el
 * contrato de Electron, pero evita un path undefined si ocurriera). Exportada
 * para test aislado.
 */
export function toManualPathResponse(result: OpenDialogReturnValue): ManualPathResponse {
  const [selectedPath] = result.filePaths;
  if (result.canceled || selectedPath === undefined) {
    return { kind: "cancelled" };
  }
  return { kind: "selected", path: selectedPath };
}

export class RealManualPathProvider implements ManualPathProvider {
  readonly #dialog: Pick<Dialog, "showOpenDialog">;

  constructor(dialog: Pick<Dialog, "showOpenDialog">) {
    this.#dialog = dialog;
  }

  async requestPath(request: ManualPathRequest): Promise<ManualPathResponse> {
    const options = toOpenDialogOptions(request);
    const result = await this.#dialog.showOpenDialog(options);
    return toManualPathResponse(result);
  }
}