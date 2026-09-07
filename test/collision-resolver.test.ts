import { describe, expect, test } from "vitest";

import { CollisionResolver } from "../src/main/domain/index.js";
import type {
  CollisionFileSystem,
  ExtractedRoot,
  WalkedFile,
} from "../src/main/domain/index.js";

/**
 * Unit tests de la Tarea 10.1: fusión con política "el último del Priority_Order
 * gana" (AC 7.1, 7.2).
 *
 * Se ejercita `CollisionResolver` con un {@link CollisionFileSystem} MOCKEADO en
 * memoria (walk recursivo, creación de directorios y copia con sobrescritura),
 * sin tocar disco. El "estado del disco" de destino se modela como un Map
 * ruta→contenido que refleja qué archivo quedó tras cada copia (sobrescritura
 * incluida), de modo que podamos afirmar quién ganó cada colisión.
 *
 * NOTA: NO son property tests (ese es 10.3, commit aparte). Son ejemplos que
 * fijan el contrato documentado en `collision-resolver.ts`.
 */

const DEST = "C:\\work\\pak01_dir";

// ---------------------------------------------------------------------------
// Mock de CollisionFileSystem en memoria.
// ---------------------------------------------------------------------------

/**
 * FS mockeado. `roots` mapea un `rootDir` a los archivos que su walk devuelve.
 * `sourceContent` mapea la ruta ABSOLUTA de un archivo de origen a un contenido
 * marcador (para verificar qué archivo terminó en cada destino). `disk` modela
 * el destino tras las copias (última copia gana). `ensuredDirs` registra los
 * directorios creados para poder verificar que se crean antes de copiar.
 */
class MockFs implements CollisionFileSystem {
  readonly roots = new Map<string, WalkedFile[]>();
  readonly sourceContent = new Map<string, string>();
  readonly disk = new Map<string, string>();
  readonly ensuredDirs: string[] = [];
  /** Registro cronológico de copias: [destPath, contenido]. */
  readonly copyLog: Array<[string, string]> = [];

  walk(rootDir: string): Promise<WalkedFile[]> {
    return Promise.resolve(this.roots.get(rootDir) ?? []);
  }

  ensureDir(dir: string): Promise<void> {
    this.ensuredDirs.push(dir);
    return Promise.resolve();
  }

  copyFile(sourcePath: string, destPath: string): Promise<void> {
    // El contenido "copiado" es el marcador del origen (o el propio sourcePath
    // si no se registró marcador), permitiendo verificar el ganador por destino.
    const content = this.sourceContent.get(sourcePath) ?? sourcePath;
    this.disk.set(destPath, content); // sobrescribe: última copia gana
    this.copyLog.push([destPath, content]);
    return Promise.resolve();
  }
}

const wf = (relativePath: string): WalkedFile => ({ relativePath });

// ---------------------------------------------------------------------------
// AC 7.1: copia recursiva de todo el contenido a destDir.
// ---------------------------------------------------------------------------

describe("CollisionResolver: copia recursiva a destDir (AC 7.1)", () => {
  test("copia todos los archivos de todos los roots, creando subdirectorios", async () => {
    const fs = new MockFs();
    fs.roots.set("C:\\ex\\A", [wf("materials\\a.vmt"), wf("models\\b.mdl")]);
    fs.roots.set("C:\\ex\\B", [wf("sound\\c.wav")]);
    const roots: ExtractedRoot[] = [
      { addonId: "A", rootDir: "C:\\ex\\A" },
      { addonId: "B", rootDir: "C:\\ex\\B" },
    ];
    const resolver = new CollisionResolver(fs);

    const report = await resolver.mergeInto(DEST, roots);

    // Los tres archivos quedaron escritos en destino (con separador de Windows).
    expect(fs.disk.has("C:\\work\\pak01_dir\\materials\\a.vmt")).toBe(true);
    expect(fs.disk.has("C:\\work\\pak01_dir\\models\\b.mdl")).toBe(true);
    expect(fs.disk.has("C:\\work\\pak01_dir\\sound\\c.wav")).toBe(true);
    // Se aseguraron los subdirectorios de destino.
    expect(fs.ensuredDirs).toContain("C:\\work\\pak01_dir\\materials");
    expect(fs.ensuredDirs).toContain("C:\\work\\pak01_dir\\models");
    expect(fs.ensuredDirs).toContain("C:\\work\\pak01_dir\\sound");
    // Sin colisiones: rutas distintas.
    expect(report.collisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC 7.2: en colisión, gana el ÚLTIMO del Priority_Order (ascendente).
// ---------------------------------------------------------------------------

describe("CollisionResolver: el último del Priority_Order gana (AC 7.2)", () => {
  test("el archivo del último root sobrescribe y queda en disco", async () => {
    const fs = new MockFs();
    fs.roots.set("C:\\ex\\A", [wf("materials\\shared.vmt")]);
    fs.roots.set("C:\\ex\\B", [wf("materials\\shared.vmt")]);
    fs.sourceContent.set("C:\\ex\\A\\materials\\shared.vmt", "contenido-de-A");
    fs.sourceContent.set("C:\\ex\\B\\materials\\shared.vmt", "contenido-de-B");
    // A antes que B ⇒ B es el último ⇒ B gana.
    const roots: ExtractedRoot[] = [
      { addonId: "A", rootDir: "C:\\ex\\A" },
      { addonId: "B", rootDir: "C:\\ex\\B" },
    ];
    const resolver = new CollisionResolver(fs);

    const report = await resolver.mergeInto(DEST, roots);

    // En disco quedó el contenido de B (el último).
    expect(fs.disk.get("C:\\work\\pak01_dir\\materials\\shared.vmt")).toBe("contenido-de-B");
    // Se registró la colisión con contributors en orden y winner = B.
    expect(report.collisions).toEqual([
      {
        relativePath: "materials/shared.vmt",
        contributors: ["A", "B"],
        winner: "B",
      },
    ]);
    // El destino se escribió dos veces (A luego B): confirma la sobrescritura.
    const writes = fs.copyLog.filter(
      ([dest]) => dest === "C:\\work\\pak01_dir\\materials\\shared.vmt",
    );
    expect(writes.map(([, content]) => content)).toEqual(["contenido-de-A", "contenido-de-B"]);
  });

  test("con tres addons, gana el tercero y contributors preserva el orden", async () => {
    const fs = new MockFs();
    for (const id of ["A", "B", "C"]) {
      fs.roots.set(`C:\\ex\\${id}`, [wf("cfg\\x.cfg")]);
      fs.sourceContent.set(`C:\\ex\\${id}\\cfg\\x.cfg`, `de-${id}`);
    }
    const roots: ExtractedRoot[] = [
      { addonId: "A", rootDir: "C:\\ex\\A" },
      { addonId: "B", rootDir: "C:\\ex\\B" },
      { addonId: "C", rootDir: "C:\\ex\\C" },
    ];
    const resolver = new CollisionResolver(fs);

    const report = await resolver.mergeInto(DEST, roots);

    expect(fs.disk.get("C:\\work\\pak01_dir\\cfg\\x.cfg")).toBe("de-C");
    expect(report.collisions).toEqual([
      { relativePath: "cfg/x.cfg", contributors: ["A", "B", "C"], winner: "C" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Normalización de la clave de colisión (DECISIÓN 2): separadores y casing.
// ---------------------------------------------------------------------------

describe("CollisionResolver: normalización de relativePath para colisiones", () => {
  test("distinto casing y separadores cuentan como el MISMO path (colisión)", async () => {
    const fs = new MockFs();
    // A usa `\` y minúsculas; B usa `/` y mayúsculas: mismo path lógico en NTFS.
    fs.roots.set("C:\\ex\\A", [wf("materials\\a.vmt")]);
    fs.roots.set("C:\\ex\\B", [wf("Materials/A.VMT")]);
    fs.sourceContent.set("C:\\ex\\A\\materials\\a.vmt", "de-A");
    fs.sourceContent.set("C:\\ex\\B\\Materials\\A.VMT", "de-B");
    const roots: ExtractedRoot[] = [
      { addonId: "A", rootDir: "C:\\ex\\A" },
      { addonId: "B", rootDir: "C:\\ex\\B" },
    ];
    const resolver = new CollisionResolver(fs);

    const report = await resolver.mergeInto(DEST, roots);

    // Se detectó UNA colisión (misma clave normalizada) y ganó B.
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0]).toEqual({
      relativePath: "materials/a.vmt",
      contributors: ["A", "B"],
      winner: "B",
    });
    // Ambas copias fueron al MISMO destino canónico (clave normalizada).
    expect(fs.disk.get("C:\\work\\pak01_dir\\materials\\a.vmt")).toBe("de-B");
  });
});

// ---------------------------------------------------------------------------
// Casos borde: sin colisiones parciales, roots vacíos, archivo en raíz.
// ---------------------------------------------------------------------------

describe("CollisionResolver: casos borde", () => {
  test("paths distintos entre addons NO generan colisión", async () => {
    const fs = new MockFs();
    fs.roots.set("C:\\ex\\A", [wf("materials\\a.vmt")]);
    fs.roots.set("C:\\ex\\B", [wf("materials\\b.vmt")]);
    const resolver = new CollisionResolver(fs);

    const report = await resolver.mergeInto(DEST, [
      { addonId: "A", rootDir: "C:\\ex\\A" },
      { addonId: "B", rootDir: "C:\\ex\\B" },
    ]);

    expect(report.collisions).toEqual([]);
  });

  test("root vacío no aporta nada; lista de roots vacía → report vacío", async () => {
    const fs = new MockFs();
    fs.roots.set("C:\\ex\\A", []);
    const resolver = new CollisionResolver(fs);

    const emptyRoots = await resolver.mergeInto(DEST, []);
    expect(emptyRoots.collisions).toEqual([]);
    expect(fs.disk.size).toBe(0);

    const oneEmpty = await resolver.mergeInto(DEST, [{ addonId: "A", rootDir: "C:\\ex\\A" }]);
    expect(oneEmpty.collisions).toEqual([]);
    expect(fs.disk.size).toBe(0);
  });

  test("archivo en la raíz del addon (sin subdir) se copia sin crear subdirectorio", async () => {
    const fs = new MockFs();
    fs.roots.set("C:\\ex\\A", [wf("root.txt")]);
    const resolver = new CollisionResolver(fs);

    await resolver.mergeInto(DEST, [{ addonId: "A", rootDir: "C:\\ex\\A" }]);

    expect(fs.disk.has("C:\\work\\pak01_dir\\root.txt")).toBe(true);
    // El único directorio asegurado, de haberlo, no sería el destDir en sí para
    // un archivo en raíz: parentDirOf devuelve destDir, así que se asegura destDir.
    expect(fs.ensuredDirs).toContain("C:\\work\\pak01_dir");
  });

  test("dos archivos distintos del MISMO addon no colisionan entre sí", async () => {
    const fs = new MockFs();
    fs.roots.set("C:\\ex\\A", [wf("a.txt"), wf("b.txt")]);
    const resolver = new CollisionResolver(fs);

    const report = await resolver.mergeInto(DEST, [{ addonId: "A", rootDir: "C:\\ex\\A" }]);

    expect(report.collisions).toEqual([]);
  });
});
