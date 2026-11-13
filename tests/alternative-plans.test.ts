import { describe, expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { SqliteRepository } from "../src/persistence/repository";
import { seedLegacyAlternative } from "./fixtures/legacy-alternative";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
import { canonical } from "../src/export/projection";
import {
  alternativeIdentities,
  remapPlan,
  operationAssets,
} from "../src/domain/alternative-plan";
import {
  newModuleDefinition,
  emptyModuleContent,
  type ModuleInstance,
} from "../src/domain/modules";
import { newWhiteboard } from "../src/domain/whiteboards";
import { newOrbatLayout } from "../src/domain/orbat";
import { assertOperation } from "../src/domain/invariants";
import { newBriefingSlide } from "../src/domain/briefings";
import { planningReferences } from "../src/domain/planning-usage";
import { operationSearchDocuments } from "../src/domain/search-documents";
import { SymbologyService } from "../src/application/symbology-service";
import { WorkspaceService } from "../src/application/workspace-service";
import { unitProfileSchema } from "../src/domain/unit-profiles";
const now = "2026-10-19T12:00:00.000Z",
  rt = { id, now: () => now, actor: "Fictional drafter" };
const pixels = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
  "base64",
);
function setup(config = starterConfig, path = ":memory:") {
  const repo = new SqliteRepository(path);
  repo.seedConfig(config);
  const app = new OrdoService(repo, rt, () => demoOperation(config, id, now));
  const op = app.execute({
    type: "create",
    name: "Fictional baseline",
    demo: true,
  }).operation!;
  const create = (
    name: string,
    revision = repo.getOperation(op.id).revision,
    operationId = op.id,
  ) => seedLegacyAlternative(repo, rt, operationId, revision, name);
  return { repo, app, op, create };
}
function enrich(op: ReturnType<typeof demoOperation>) {
  op.units[1].parentUnitId = op.units[0].id;
  op.events[0].schedule = {
    schemaVersion: 1,
    durationMinutes: 60,
    relativeAnchor: "END",
    unitId: op.units[0].id,
  };
  op.orbatLayout = newOrbatLayout(id);
  op.orbatLayout.hints = [
    { nodeId: op.units[0].id, folded: false, hqStaff: false, offset: null },
  ];
  op.orbatLayout.siblingOrder = op.units.map((u) => u.id);
  op.planningCards = {
    schemaVersion: 1,
    definitions: [
      {
        id: id(),
        title: "Task card",
        mode: "linked",
        source: {
          kind: "entity",
          entityKind: "task",
          entityId: op.tasks[0].id,
        },
        fields: ["name", "purpose", "unit"],
      },
    ],
  };
  op.planningProgress = {
    schemaVersion: 1,
    products: [{ productId: op.orderId, readyAt: now, dueAt: now }],
  };
  const board = newWhiteboard(id()),
    cardId = op.planningCards.definitions[0].id;
  board.items = [
    {
      id: id(),
      kind: "card",
      cardId,
      x: 10,
      y: 10,
      width: 300,
      height: 200,
      locked: false,
    },
    {
      id: id(),
      kind: "note",
      text: "Fictional decision",
      fill: "#ffffff",
      ink: "#000000",
      fontSize: 18,
      x: 400,
      y: 10,
      width: 300,
      height: 200,
      locked: false,
    },
  ];
  board.connectors = [
    {
      id: id(),
      fromId: board.items[0].id,
      toId: board.items[1].id,
      label: "Consider",
      color: "#000000",
      style: "solid",
      arrow: "end",
    },
  ];
  op.whiteboards = { schemaVersion: 1, boards: [board] };
  op.briefings = {
    schemaVersion: 1,
    decks: [
      {
        id: id(),
        name: "Brief",
        footer: "Fictional",
        slides: [{ ...newBriefingSlide(id(), "cards"), cardIds: [cardId] }],
      },
    ],
  };
  op.modules ??= { schemaVersion: 1, instances: [], assets: [] };
  function module(type: string): ModuleInstance {
    const def = newModuleDefinition(type, id());
    const m: ModuleInstance = {
      moduleInstanceId: id(),
      operationId: op.id,
      productInstanceId: op.orderId,
      moduleDefinitionId: null,
      localDefinition: def,
      origin: "OPERATION",
      content: emptyModuleContent(def),
      position: op.modules!.instances.filter(
        (x) => x.productInstanceId === op.orderId,
      ).length,
      layoutState: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    op.modules!.instances.push(m);
    return m;
  }
  const cards = module("PLANNING_CARDS");
  if (cards.content.type === "PLANNING_CARDS")
    cards.content.placements.push({ id: id(), cardId, layout: "detailed" });
  const kv = module("KEY_VALUE"),
    ref = id(),
    prose = id();
  kv.localDefinition!.configuration.fields = [
    {
      id: ref,
      stableKey: "unit",
      label: "Unit",
      help: "",
      type: "UNIT_REFERENCE",
      required: false,
      options: [],
    },
    {
      id: prose,
      stableKey: "prose",
      label: "Literal text",
      help: "",
      type: "SHORT_TEXT",
      required: false,
      options: [],
    },
  ];
  kv.content = {
    type: "KEY_VALUE",
    values: { [ref]: op.units[0].id, [prose]: op.units[0].id },
  };
  return { module, kv, ref, prose };
}
describe("existing alternative operations", () => {
  it("retains organization staff and catalog pins while making imported ORBAT units independently editable", () => {
    const { repo, app, create } = setup();
    try {
      const lib = new SymbologyService(repo, rt),
        workspace = new WorkspaceService(repo, rt);
      let symbol = lib.execute({
        type: "new",
        kind: "SYMBOL",
        name: "Fictional unit",
      }).symbol!;
      symbol = lib.execute({
        type: "publish",
        kind: "SYMBOL",
        id: symbol.versionId,
        expected: symbol.contentVersion,
      }).symbol!;
      let profile = workspace.execute({
        type: "unit-profile-new",
        name: "Fictional organization",
      }).profile!;
      const sectionId = id(),
        positionId = id();
      profile = unitProfileSchema.parse({
        ...profile,
        schemaVersion: 2,
        defaultSymbol: repo.resolveSymbolPin(symbol.versionId),
        staff: {
          sections: [{ sectionId, name: "Operations", description: "" }],
          positions: [
            {
              positionId,
              sectionId,
              title: "Planner",
              shortTitle: "",
              functionalRole: "OPERATIONS",
              defaultForRole: true,
              description: "",
              notes: "",
              rankGrade: "",
              incumbent: null,
            },
          ],
        },
      });
      profile = workspace.execute({
        type: "unit-profile-save",
        profile,
        expectedContentVersion: profile.contentVersion,
      }).profile!;
      profile = workspace.execute({
        type: "unit-profile-publish",
        id: profile.unitProfileVersionId,
        expectedContentVersion: profile.contentVersion,
      }).profile!;
      let orbat = lib.execute({
        type: "orbat-from-profile",
        id: profile.unitProfileVersionId,
        name: "Fictional ORBAT",
      }).orbat!;
      const child = structuredClone(orbat.nodes[0]);
      child.nodeId = id();
      child.parentNodeId = orbat.rootNodeId;
      orbat.nodes.push(child);
      orbat = lib.execute({
        type: "save-orbat",
        value: orbat,
        expected: orbat.contentVersion,
      }).orbat!;
      orbat = lib.execute({
        type: "publish",
        kind: "ORBAT",
        id: orbat.versionId,
        expected: orbat.contentVersion,
      }).orbat!;
      let op = app.execute({
        type: "create",
        name: "ORBAT source",
        demo: false,
        unitProfileVersionId: profile.unitProfileVersionId,
      }).operation!;
      op = lib.execute({
        type: "import-orbat",
        operationId: op.id,
        expectedRevision: op.revision,
        orbatVersionId: orbat.versionId,
        importId: id(),
        parentUnitId: null,
        confirmDuplicate: false,
        replaceLayout: true,
      }).operation!;
      op.staffPositionOverrides = [
        {
          productId: op.orderId,
          unitProfileVersionId: profile.unitProfileVersionId,
          positionId,
          sectionId,
          functionalRole: "OPERATIONS",
        },
      ];
      op = app.execute({
        type: "save",
        operation: op,
        expectedRevision: op.revision,
      }).operation!;
      const copyId = create("ORBAT alternative", op.revision, op.id);
      const copy = repo.getOperation(copyId);
      expect(copy.units.map((u) => u.sourceOrbat)).toEqual(
        op.units.map((u) => u.sourceOrbat),
      );
      expect(copy.units.map((u) => u.symbol)).toEqual(
        op.units.map((u) => u.symbol),
      );
      expect(copy.operationOrganizationBinding).toEqual(
        op.operationOrganizationBinding,
      );
      expect(copy.staffPositionOverrides![0]).toEqual({
        ...op.staffPositionOverrides![0],
        productId: copy.orderId,
      });
      copy.units[0].name = "Independent HQ";
      copy.units[1].parentUnitId = null;
      app.execute({ type: "save", operation: copy, expectedRevision: 1 });
      expect(repo.getOperation(op.id).units[0].name).not.toBe("Independent HQ");
      expect(app.load(copyId).operation?.units[0].name).toBe("Independent HQ");
      repo.verifyAll();
    } finally {
      repo.close();
    }
  });
  it.each([starterConfig, armyConfig])(
    "remaps connected planning identities with $doctrine.name and preserves ordinary text and doctrine keys",
    (config) => {
      const op = demoOperation(config, id, now),
        { kv, ref, prose } = enrich(op),
        original = canonical(op);
      const map = alternativeIdentities(op, config, id),
        copy = remapPlan(op, config, map);
      expect(canonical(op)).toBe(original);
      assertOperation(copy, config);
      expect(copy.units[1].parentUnitId).toBe(copy.units[0].id);
      expect(copy.tasks[0].unitId).toBe(copy.units[0].id);
      expect(copy.events[1].relativeToEventId).toBe(copy.events[0].id);
      expect(copy.planningCards!.definitions[0]).toMatchObject({
        source: { entityId: copy.tasks[0].id },
      });
      expect(copy.whiteboards!.boards[0].connectors[0].fromId).toBe(
        copy.whiteboards!.boards[0].items[0].id,
      );
      expect(copy.briefings!.decks[0].slides[0].cardIds).toEqual([
        copy.planningCards!.definitions[0].id,
      ]);
      const values = copy.modules!.instances.find(
        (m) => m.moduleInstanceId === map.get(kv.moduleInstanceId),
      )!.content;
      expect(values.type).toBe("KEY_VALUE");
      if (values.type === "KEY_VALUE") {
        expect(values.values[map.get(ref)!]).toBe(copy.units[0].id);
        expect(values.values[map.get(prose)!]).toBe(op.units[0].id);
      }
      expect(copy.authoring?.fields.map((f) => f.fieldId)).toEqual(
        op.authoring?.fields.map((f) => f.fieldId),
      );
      expect(
        remapPlan(copy, config, new Map([...map].map(([a, b]) => [b, a]))),
      ).toEqual(op);
      expect(() => alternativeIdentities(op, config, () => op.id)).toThrow(
        /unique/,
      );
    },
  );
  it("lists and edits saved alternatives as ordinary operations while preserving their baseline and history", () => {
    const { repo, app, op, create } = setup();
    try {
      enrich(op);
      const source = app.execute({
        type: "save",
        operation: op,
        expectedRevision: op.revision,
      }).operation!;
      const copyId = create("Saved alternative");
      expect(repo.listOperations().map((o) => o.id)).toEqual(
        expect.arrayContaining([op.id, copyId]),
      );
      const copy = app.load(copyId).operation!;
      copy.tasks[0].purpose = "Revised purpose";
      const edited = app.execute({
        type: "save",
        operation: copy,
        expectedRevision: copy.revision,
      }).operation!;
      expect(edited.revision).toBe(2);
      expect(repo.getOperation(copyId, 1).tasks[0].purpose).toBe(
        source.tasks[0].purpose,
      );
      expect(repo.getOperation(op.id).tasks[0].purpose).toBe(
        source.tasks[0].purpose,
      );
      expect(planningReferences(edited).length).toBeGreaterThan(0);
      expect(
        operationSearchDocuments(edited, starterConfig).some((d) =>
          d.text.includes("Revised purpose"),
        ),
      ).toBe(true);
      expect(() =>
        repo.sqlite.exec("UPDATE alternative_plans SET source_revision=99"),
      ).toThrow(/immutable/);
      expect(() => repo.sqlite.exec("DELETE FROM alternative_plans")).toThrow(
        /immutable/,
      );
      repo.verifyAll();
    } finally {
      repo.close();
    }
  });
  it("copies managed bytes and survives baseline deletion, backup, restart, and alternative deletion", async () => {
    const folder = mkdtempSync(".test-data/alternative-test-"),
      path = join(folder, "workspace.db");
    const { repo, app, op, create } = setup(starterConfig, path);
    let copyId = "";
    try {
      const { module } = enrich(op),
        assetId = id();
      const asset = {
        assetId,
        operationId: op.id,
        doctrineVersionId: null,
        originalFilename: "Fictional.png",
        mimeType: "image/png" as const,
        sizeBytes: pixels.length,
        sha256: repo.hashBinary(pixels),
        createdAt: now,
        storageReference: `asset:${assetId}`,
      };
      repo.modular.insertAsset(asset, pixels);
      op.modules!.assets.push(asset);
      module("IMAGE").content = {
        type: "IMAGE",
        image: {
          id: id(),
          assetId,
          title: "Image",
          caption: "Saved image",
          alt: "Test",
          width: "small",
          alignment: "left",
        },
      };
      app.execute({ type: "save", operation: op, expectedRevision: 1 });
      copyId = create("Alternative with image");
      const copy = repo.getOperation(copyId),
        copiedAsset = operationAssets(copy)[0];
      expect(copiedAsset.assetId).not.toBe(assetId);
      expect(copiedAsset.operationId).toBe(copyId);
      expect(repo.modular.readAsset(copiedAsset.assetId).bytes).toEqual(pixels);
      const deletion = repo.prepareDeletion({ kind: "operation", id: op.id });
      expect(deletion.blockers).toEqual([]);
      repo.permanentlyDelete(
        { kind: "operation", id: op.id },
        deletion.fingerprint,
      );
      expect(repo.listOperations().map((o) => o.id)).toContain(copyId);
      expect(app.load(copyId).operation?.name).toBe("Alternative with image");
      repo.verifyAll();
      await repo.backup(join(folder, "backup.db"));
    } finally {
      repo.close();
    }
    for (const file of [path, join(folder, "backup.db")]) {
      const reopened = new SqliteRepository(file, true);
      try {
        reopened.verifyAll();
        expect(reopened.alternatives.get(copyId)!.sourceRevision).toBe(2);
        const deletion = reopened.prepareDeletion({
          kind: "operation",
          id: copyId,
        });
        expect(deletion.blockers).toEqual([]);
        reopened.permanentlyDelete(
          { kind: "operation", id: copyId },
          deletion.fingerprint,
        );
        expect(reopened.alternatives.get(copyId)).toBeNull();
      } finally {
        reopened.close();
      }
    }
  });
});
