/**
 * Test de integracion del bloque 3 de la Tarea 20.4: verifica que SqliteLocalStore
 * persiste datos en un archivo .sqlite REAL en disco (no :memory:), sobreviviendo
 * un cierre y una reapertura de la Database contra el mismo archivo. Complementa
 * a local-store.test.ts / local-store.property.test.ts (ambos contra :memory:,
 * que por definicion no pueden probar persistencia entre cierres).
 *
 * DECISION G: archivo temporal bajo os.tmpdir(), limpiado en afterEach incluso
 * si el test falla.
 */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { SqliteLocalStore } from "../src/main/domain/index.js";
import type { GamePaths } from "../src/main/domain/index.js";

// GamePaths COMPLETO: getPaths() solo devuelve un objeto (no null) cuando estan
// presentes las 7 rutas (un GamePaths incompleto no es valido, por diseno de
// local-store.ts). Un guardado parcial nunca se lee de vuelta, asi que la
// persistencia de rutas solo se puede verificar con el conjunto completo.
const FULL_PATHS: GamePaths = {
  steamPath: "C:\\Steam",
  gameRoot: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2",
  left4dead2Dir: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2",
  workshopFolder: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\addons\\workshop",
  vpkToolPath: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\bin\\vpk.exe",
  gameInfoFile: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\gameinfo.txt",
  modsvsFolder: "C:\\Steam\\steamapps\\common\\Left 4 Dead 2\\left4dead2\\modsvs",
};

describe("SqliteLocalStore contra archivo real en disco", () => {
  let dbPath: string;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "l4d2-local-store-"));
    dbPath = path.join(dir, "store.sqlite");
  });

  afterEach(async () => {
    // En Windows, el handle del .sqlite puede seguir liberandose un instante
    // despues de db.close() (binario nativo de better-sqlite3), lo que hace que
    // un unlink inmediato lance EBUSY/EPERM. maxRetries/retryDelay de fs.rm
    // reintenta el borrado hasta que el lock se libera (comportamiento pensado
    // por Node justamente para este caso en Windows).
    await fs.rm(path.dirname(dbPath), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });

  test("paths, manifest y pending session sobreviven un cierre + reapertura real", () => {
    // Primera apertura: escribe datos (GamePaths COMPLETO, ver nota arriba).
    const db1 = new Database(dbPath);
    const store1 = new SqliteLocalStore(db1);
    store1.savePaths(FULL_PATHS);
    store1.saveManifest([{ addonId: "123", priorityOrder: 0 }]);
    store1.savePendingSession([{ addonId: "456", priorityOrder: 1 }]);
    db1.close();

    // Segunda apertura: Database NUEVA contra el MISMO archivo.
    const db2 = new Database(dbPath);
    const store2 = new SqliteLocalStore(db2);
    expect(store2.getPaths()).toEqual(FULL_PATHS);
    expect(store2.getManifest()).toEqual([{ addonId: "123", priorityOrder: 0 }]);
    expect(store2.getPendingSession()).toEqual([{ addonId: "456", priorityOrder: 1 }]);
    db2.close();
  });

  test("reapertura sin escrituras previas: getPaths/getManifest/getPendingSession en estado inicial", () => {
    const db1 = new Database(dbPath);
    new SqliteLocalStore(db1);
    db1.close();

    const db2 = new Database(dbPath);
    const store2 = new SqliteLocalStore(db2);
    expect(store2.getPaths()).toBeNull();
    expect(store2.getManifest()).toEqual([]);
    expect(store2.getPendingSession()).toBeNull();
    db2.close();
  });
});