import { expect, it } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import { SymbologyService } from "../src/application/symbology-service";
import { GraphicExportService } from "../src/application/graphic-export-service";
import { type GraphicExportProfile } from "../src/domain/graphic-exports";
import { starterConfig } from "../src/config/profiles";
import { projectArchivedGraphic } from "../src/application/archived-graphic-v1";
import { demoOperation } from "../src/demo/operation";
const rt = {
  id: uid,
  now: () => "2026-10-05T20:00:00.000Z",
  actor: "Fictional fidelity tester",
};
const profile = (product: "SYMBOL" | "ORBAT"): GraphicExportProfile => ({
  schemaVersion: 1,
  id: uid(),
  version: 1,
  name: "reference compatibility",
  product,
  format: "JSON",
  jsonMode: "retired-format",
  scale: 1,
  size: 30,
  background: "TRANSPARENT",
  foldPolicy: "AS_SHOWN",
  ancestorPolicy: "BOUNDARY",
  selectedUnitIds: null,
  renderProfile: { id: "ordo-symbol", version: 1 },
});
function setup() {
  const repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  const lib = new SymbologyService(repo, rt),
    graphics = new GraphicExportService(
      repo,
      rt,
      {
        render: async () => {
          throw Error("JSON writer must not render");
        },
      },
      {
        rasterize: async () => {
          throw Error("JSON writer must not rasterize");
        },
      },
    );
  return { repo, lib, graphics };
}
it("refuses new exports using a retired profile before writing a record", async () => {
  const { repo, lib, graphics } = setup();
  try {
    const item = lib.execute({
      type: "new",
      kind: "SYMBOL",
      name: "Exercise",
    }).symbol!;
    const command = {
      source: {
        kind: "SAVED_SYMBOL",
        versionId: item.versionId,
        expectedContentVersion: item.contentVersion,
      },
      profile: profile("SYMBOL"),
    };
    await expect(graphics.generate(command)).rejects.toThrow();
    expect(repo.listGraphicExports()).toHaveLength(0);
  } finally {
    repo.close();
  }
});
it("reference subtree export excludes a name-bound parent outside the selection", () => {
  const op = demoOperation(starterConfig, uid, rt.now());
  const definition = setup();
  try {
    const symbol = definition.lib.execute({
      type: "new",
      kind: "SYMBOL",
      name: "FICTIONAL",
    }).symbol!;
    const [parent, child] = op.units;
    op.units = [parent, child];
    parent.parentUnitId = null;
    parent.name = "EXCLUDED PARENT";
    child.parentUnitId = parent.id;
    child.symbol = {
      schemaVersion: 1,
      base: { definition: symbol.definition, source: null },
      override: null,
      labels: {
        uniqueDesignation: { kind: "UNIT_NAME" },
        higherFormation: { kind: "PARENT_UNIT_NAME" },
      },
    };
    const p = { ...profile("ORBAT"), selectedUnitIds: [child.id] },
      source = {
        kind: "OPERATION" as const,
        operationId: op.id,
        revision: 1,
        publicationId: null,
        contentHash: "0".repeat(64),
      };
    const result = projectArchivedGraphic(source, p, op);
    expect(result.text).not.toContain("EXCLUDED PARENT");
    expect(result.text).toContain(child.name);
    expect(JSON.parse(result.text).options.infoFields).toBe(false);
    expect(
      result.fields.some(
        (f) => f.path.endsWith("orbatRendering") && f.action === "OMITTED",
      ),
    ).toBe(true);
  } finally {
    definition.repo.close();
  }
});
