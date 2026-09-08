import { describe, expect, test } from "vitest";

import { BackupManager } from "../src/main/domain/index.js";
import type { BackupFileSystem, BackupResult } from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 12.1: backup de un unico nivel antes de sobrescribir
 * el Merged_Package (Requirement 5; AC 5.1, 5.2, 5.3).
 *
 * Se ejercita BackupManager con un {@link BackupFileSystem} MOCKEADO en
 * memoria (exists + copyFile), sin tocar disco. El "estado del disco" se modela
 * como un Set de rutas existentes y un log de copias, de modo que se pueda
 * afirmar: (a) que solo se copia cuando el pak01_dir.vpk actual existe, (b) que
 * la ausencia del actual es un no-op exitoso (no aborta, no copia), y (c) que un
 * fallo de copyFile se PROPAGA (no se atrapa), para que el orquestador aborte
 * (AC 5.2).
 *
 * NOTA: NO son property tests (ese es 12.2 / Property 7, commit aparte). Son
 * ejemplos concretos que fijan el contrato documentado en backup-manager.ts.
 */

const MODSVS = "C:\\Game\\left4dead2\\modsvs";
const SOURCE = "C:\\Game\\left4dead2\\modsvs\\pak01_dir.vpk";
const BACKUP = "C:\\Game\\left4dead2\\modsvs\\pak01_dir.vpk.backup";

// ---------------------------------------------------------------------------
// Mock de BackupFileSystem en memoria.
// ---------------------------------------------------------------------------

/**
 * FS mockeado. existing es el conjunto de rutas que exists reporta como
 * presentes. copyLog registra cronologicamente cada copia [source, dest].
 * failCopyWith, si se setea, hace que copyFile RECHACE con ese error
 * (simula EACCES/EPERM/etc.), para verificar la propagacion del fallo.
 */
class MockFs implements BackupFileSystem {
  readonly existing = new Set<string>();
  readonly copyLog: Array<[string, string]> = [];
  failCopyWith: Error | null = null;

  exists(path: string): Promise<boolean> {
    return Promise.resolve(this.existing.has(path));
  }

  copyFile(sourcePath: string, destPath: string): Promise<void> {
    if (this.failCopyWith !== null) {
      // No se registra la copia: fallo antes de completar. Propaga el error.
      return Promise.reject(this.failCopyWith);
    }
    this.copyLog.push([sourcePath, destPath]);
    // Modela la sobrescritura: el backup pasa a existir tras la copia.
    this.existing.add(destPath);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// AC 5.1: se crea un Backup del pak01_dir.vpk actual antes de sobrescribir.
// ---------------------------------------------------------------------------

describe("BackupManager: crea backup del pak01_dir.vpk actual (AC 5.1)", () => {
  test("con pak01_dir.vpk presente, copia a pak01_dir.vpk.backup y devuelve created:true", async () => {
    const fs = new MockFs();
    fs.existing.add(SOURCE);
    const manager = new BackupManager(fs);

    const result = await manager.backupExisting(MODSVS);

    // Se copio el actual al backup, en la misma carpeta, con nombre fijo.
    expect(fs.copyLog).toEqual([[SOURCE, BACKUP]]);
    // Resultado discrimina created:true con la ruta del backup.
    expect(result).toEqual<BackupResult>({ created: true, backupPath: BACKUP });
  });
});

// ---------------------------------------------------------------------------
// AC 5.1 (cobertura de primera instalacion): ausencia del actual = no-op.
// ---------------------------------------------------------------------------

describe("BackupManager: primera instalacion sin pak01_dir.vpk previo (AC 5.1)", () => {
  test("sin pak01_dir.vpk actual, NO copia nada y devuelve created:false (no aborta)", async () => {
    const fs = new MockFs();
    // existing vacio: no hay pak01_dir.vpk actual.
    const manager = new BackupManager(fs);

    const result = await manager.backupExisting(MODSVS);

    // No se intento ninguna copia.
    expect(fs.copyLog).toEqual([]);
    // No-op exitoso: no es un fallo, no hay backupPath.
    expect(result).toEqual<BackupResult>({ created: false });
  });
});

// ---------------------------------------------------------------------------
// AC 5.3: un unico nivel de backup — se sobrescribe el backup previo.
// ---------------------------------------------------------------------------

describe("BackupManager: unico nivel de backup, se sobrescribe el previo (AC 5.3)", () => {
  test("con un backup previo existente, la copia lo sobrescribe (mismo destino)", async () => {
    const fs = new MockFs();
    fs.existing.add(SOURCE);
    fs.existing.add(BACKUP); // ya habia un backup de una operacion anterior
    const manager = new BackupManager(fs);

    const result = await manager.backupExisting(MODSVS);

    // La copia va al MISMO destino de backup (nombre fijo -> un solo nivel).
    expect(fs.copyLog).toEqual([[SOURCE, BACKUP]]);
    expect(result).toEqual<BackupResult>({ created: true, backupPath: BACKUP });
  });

  test("dos backups consecutivos siempre apuntan al mismo destino (nunca acumula)", async () => {
    const fs = new MockFs();
    fs.existing.add(SOURCE);
    const manager = new BackupManager(fs);

    await manager.backupExisting(MODSVS);
    await manager.backupExisting(MODSVS);

    // Ambas copias fueron al MISMO backupPath: nunca hay backup de backup.
    expect(fs.copyLog).toEqual([
      [SOURCE, BACKUP],
      [SOURCE, BACKUP],
    ]);
    // Solo existen el original y un unico backup (no un pak01_dir.vpk.backup.backup).
    const backupLikePaths = [...fs.existing].filter((p) => p.includes(".backup"));
    expect(backupLikePaths).toEqual([BACKUP]);
  });
});

// ---------------------------------------------------------------------------
// AC 5.2: si la creacion del Backup falla, se PROPAGA (no se atrapa) para que
// el orquestador aborte.
// ---------------------------------------------------------------------------

describe("BackupManager: fallo de copia se propaga sin atrapar (AC 5.2)", () => {
  test("si copyFile rechaza (p. ej. EACCES), backupExisting propaga el error", async () => {
    const fs = new MockFs();
    fs.existing.add(SOURCE);
    const eacces = Object.assign(new Error("permiso denegado"), { code: "EACCES" });
    fs.failCopyWith = eacces;
    const manager = new BackupManager(fs);

    // El error NO se atrapa: sube tal cual (el orquestador decidira abortar/elevar).
    await expect(manager.backupExisting(MODSVS)).rejects.toBe(eacces);
  });

  test("no se intenta copiar (ni propaga) si NO existe el pak01_dir.vpk actual", async () => {
    const fs = new MockFs();
    // Aunque copyFile fallaria, nunca deberia llamarse: no hay actual que respaldar.
    fs.failCopyWith = new Error("no deberia llamarse");
    const manager = new BackupManager(fs);

    const result = await manager.backupExisting(MODSVS);

    expect(result).toEqual<BackupResult>({ created: false });
    expect(fs.copyLog).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Construccion de rutas: nombre y ubicacion del backup (junto al original).
// ---------------------------------------------------------------------------

describe("BackupManager: ruta del backup en la misma carpeta modsvs/", () => {
  test("tolera separador final en modsvsFolder sin duplicarlo", async () => {
    const fs = new MockFs();
    const modsvsWithSlash = "C:\\Game\\left4dead2\\modsvs\\";
    fs.existing.add(SOURCE); // el source se resuelve sin el separador duplicado
    const manager = new BackupManager(fs);

    const result = await manager.backupExisting(modsvsWithSlash);

    // El backup queda en la misma carpeta, sin separador duplicado.
    expect(result).toEqual<BackupResult>({ created: true, backupPath: BACKUP });
    expect(fs.copyLog).toEqual([[SOURCE, BACKUP]]);
  });
});