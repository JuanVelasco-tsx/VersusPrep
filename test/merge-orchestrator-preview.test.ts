import { describe, expect, test } from "vitest";

import {
  MergeEngine,
  MergeOrchestrator,
  VpkToolError,
} from "../src/main/domain/index.js";
import type {
  AddonManifestEntry,
  CollisionResolver,
  MergeFileSystem,
  VpkTool,
} from "../src/main/domain/index.js";
import { buildOrchestrator } from "./helpers/orchestrator-doubles.js";

/**
 * Unit tests de `MergeOrchestrator.previewActiveSet` (Sección 21.2, capacidad
 * agregada fuera del scope original — ver `Context/04-historial-decisiones.md`
 * y DECISIÓN 7 de `merge-orchestrator.ts`/`merge-engine.ts`).
 *
 * ---------------------------------------------------------------------------
 * DECISIÓN DE MOCKEO — MergeEngine REAL (no `FakeMergeEngine`), con `VpkTool`
 * doble estructural y un `MergeFileSystem`/`CollisionResolver` QUE LANZAN.
 *
 * A diferencia de `merge-orchestrator.test.ts` (que usa el `FakeMergeEngine` de
 * `orchestrator-doubles.ts`, un doble que NO ejecuta ninguna lógica real), estos
 * tests conectan un `MergeEngine` REAL para ejercitar de verdad `preview()`
 * (list → `resolveMerge`). El `MergeFileSystem.ensureDir` y el
 * `CollisionResolver.mergeInto` inyectados LANZAN si se invocan: como
 * `preview()` no debe usarlos jamás (ver DECISIÓN 7 de `merge-engine.ts`), esto
 * convierte "previewActiveSet no debe crear directorios ni invocar
 * CollisionResolver" en una aserción que falla RUIDOSAMENTE si algún día deja de
 * cumplirse, en vez de un comentario que nadie vuelve a verificar.
 *
 * El resto de las dependencias del orquestador (`ProcessGuard`,
 * `ElevationService`, `BackupManager`, `GameInfoEditor`, `LocalStore`, el `fs`
 * propio del orquestador) siguen siendo los dobles compartidos de
 * `orchestrator-doubles.ts`: `previewActiveSet` NO debería tocar ninguno, y el
 * `log` cronológico compartido lo prueba (se espera vacío tras cada llamada).
 * ---------------------------------------------------------------------------
 */

/** Doble estructural de VpkTool: devuelve un listado fijo por addonId, o lanza VpkToolError para los addonIds marcados como "rotos". */
class FakeVpkTool {
  readonly #listings: Record<string, string[]>;
  readonly #failing: ReadonlySet<string>;

  constructor(listings: Record<string, string[]>, failing: readonly string[] = []) {
    this.#listings = listings;
    this.#failing = new Set(failing);
  }

  list(_vpkPath: string, addonId: string): Promise<string[]> {
    if (this.#failing.has(addonId)) {
      return Promise.reject(
        new VpkToolError({
          addonId,
          operation: "list",
          exitCode: -1,
          stderr: "VPK corrupto (simulado)",
        }),
      );
    }
    return Promise.resolve(this.#listings[addonId] ?? []);
  }

  extract(): Promise<void> {
    throw new Error("previewActiveSet no debe extraer nada (llamó VpkTool.extract)");
  }

  pack(): Promise<string> {
    throw new Error("previewActiveSet no debe empaquetar nada (llamó VpkTool.pack)");
  }
}

/** Lanza si `previewActiveSet` alguna vez intenta crear un directorio. */
const THROWING_FS: MergeFileSystem = {
  ensureDir(): Promise<void> {
    throw new Error(
      "previewActiveSet no debe crear directorios (llamó MergeFileSystem.ensureDir)",
    );
  },
};

/** Lanza si `previewActiveSet` alguna vez intenta fusionar/copiar archivos. */
const THROWING_COLLISION_RESOLVER = {
  mergeInto(): Promise<never> {
    throw new Error(
      "previewActiveSet no debe invocar CollisionResolver.mergeInto",
    );
  },
} as unknown as CollisionResolver;

/** Construye un MergeOrchestrator con un MergeEngine REAL conectado a un VpkTool fake. */
function buildPreviewHarness(opts: {
  scannedIds: string[];
  listings: Record<string, string[]>;
  failing?: string[];
  gameRunning?: boolean;
}) {
  const h = buildOrchestrator(
    opts.gameRunning === undefined
      ? { scannedIds: opts.scannedIds }
      : { scannedIds: opts.scannedIds, gameRunning: opts.gameRunning },
  );
  const vpkTool = new FakeVpkTool(opts.listings, opts.failing ?? []) as unknown as VpkTool;
  const mergeEngine = new MergeEngine(vpkTool, THROWING_FS, THROWING_COLLISION_RESOLVER);
  const orch = new MergeOrchestrator({ ...h.deps, mergeEngine });
  return { orch, h };
}

describe("MergeOrchestrator.previewActiveSet — cálculo de solo lectura", () => {
  test("calcula colisiones y fileCount sin escribir nada, aunque el juego esté corriendo", async () => {
    const entries: AddonManifestEntry[] = [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ];
    // gameRunning: true prueba que previewActiveSet NO chequea ProcessGuard: si
    // lo hiciera, este escenario abortaría igual que aborta applyActiveSet.
    const { orch, h } = buildPreviewHarness({
      scannedIds: ["111", "222"],
      listings: {
        "111": ["materials/a.vmt"],
        "222": ["materials/a.vmt", "models/b.mdl"],
      },
      gameRunning: true,
    });
    const result = await orch.previewActiveSet(entries);

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.report.collisions).toEqual([
      { relativePath: "materials/a.vmt", contributors: ["111", "222"], winner: "222" },
    ]);
    expect(result.fileCount).toBe(2); // materials/a.vmt + models/b.mdl, sin duplicar la colisión
    expect(result.unavailable).toEqual([]);
    // Ni ElevationService, ni BackupManager, ni GameInfoEditor, ni el fs de
    // instalación, ni LocalStore.saveManifest se invocaron.
    expect(h.log).toEqual([]);
  });

  test("Active_Set vacío -> preview vacío, sin colisiones ni addons no disponibles", async () => {
    const { orch } = buildPreviewHarness({ scannedIds: [], listings: {} });
    const result = await orch.previewActiveSet([]);
    expect(result).toEqual({ kind: "ready", report: { collisions: [] }, fileCount: 0, unavailable: [] });
  });

  test("addon con .vpk inexistente (desuscrito/borrado) -> unavailable, NO aborta el preview (BUG-001)", async () => {
    // BUG-001: previewActiveSet ya NO escanea la Workshop para detectar el
    // faltante con un `addon-missing` previo — deriva el vpkPath directo
    // (`<workshopFolder>\<id>.vpk`) y deja que el `VpkTool.list()` de un .vpk
    // inexistente falle, cayendo en la rama `unavailable` (mismo criterio
    // best-effort que un VPK corrupto). El addon sano se calcula igual.
    const { orch } = buildPreviewHarness({
      scannedIds: ["111"], // ya irrelevante: el preview no usa el scanner
      listings: { "111": ["materials/a.vmt"] },
      failing: ["999"], // su .vpk derivado no existe -> list() falla
    });
    const result = await orch.previewActiveSet([
      { addonId: "111", priorityOrder: 0 },
      { addonId: "999", priorityOrder: 1 }, // desuscrito/borrado
    ]);
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.unavailable).toEqual([
      { addonId: "999", reason: expect.stringContaining("999") },
    ]);
    // El addon sano (111) se calculó igual, sin abortar por el faltante.
    expect(result.fileCount).toBe(1);
    expect(result.report.collisions).toEqual([]);
  });

  test("VpkTool.list() falla para UN addon -> se excluye best-effort, el resto se calcula igual", async () => {
    const entries: AddonManifestEntry[] = [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 }, // VPK "corrupto"
      { addonId: "333", priorityOrder: 2 },
    ];
    const { orch } = buildPreviewHarness({
      scannedIds: ["111", "222", "333"],
      listings: {
        "111": ["materials/a.vmt"],
        "333": ["materials/a.vmt"], // colisiona con 111, NO con 222 (excluido)
      },
      failing: ["222"],
    });
    const result = await orch.previewActiveSet(entries);

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.unavailable).toEqual([
      { addonId: "222", reason: expect.stringContaining("222") },
    ]);
    // La colisión entre 111 y 333 se calculó IGUAL, pese al addon roto entre medio.
    expect(result.report.collisions).toEqual([
      { relativePath: "materials/a.vmt", contributors: ["111", "333"], winner: "333" },
    ]);
    expect(result.fileCount).toBe(1);
  });

  test("VpkTool.list() falla para TODOS los addons -> preview vacío con todos en unavailable", async () => {
    const entries: AddonManifestEntry[] = [
      { addonId: "111", priorityOrder: 0 },
      { addonId: "222", priorityOrder: 1 },
    ];
    const { orch } = buildPreviewHarness({
      scannedIds: ["111", "222"],
      listings: {},
      failing: ["111", "222"],
    });
    const result = await orch.previewActiveSet(entries);

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.report.collisions).toEqual([]);
    expect(result.fileCount).toBe(0);
    expect(result.unavailable.map((u) => u.addonId).sort()).toEqual(["111", "222"]);
  });
});
