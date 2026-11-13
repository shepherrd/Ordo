import { beforeEach, afterEach, expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import { CatalogService } from "../src/application/catalog-service";
import { CatalogWorkspace } from "../src/application/catalog-workspace";
import { OrdoService } from "../src/application/service";
import { WorkspaceService } from "../src/application/workspace-service";
import { SymbologyService } from "../src/application/symbology-service";
import { armyConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { instantiateProduct } from "../src/domain/authoring";
import {
  syncDoctrineIndex,
  type DoctrineVersion,
} from "../src/domain/doctrine-builder";
import { newModuleDefinition } from "../src/domain/modules";
import { addOperationModule } from "../src/domain/module-authoring";
import { hashBytes } from "../src/persistence/modular-store";
import { canonical } from "../src/export/projections/v1";

const rt = {
  id,
  now: () => "2026-10-20T12:00:00.000Z",
  actor: "Doctrine update test",
};
let repo: SqliteRepository, catalog: CatalogService, app: CatalogWorkspace;
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(armyConfig);
  const service = new OrdoService(repo, rt, (_name, c) =>
    demoOperation(c, id, rt.now()),
  );
  catalog = new CatalogService(repo, repo.catalog, rt, repo);
  catalog.importLegacy();
  app = new CatalogWorkspace(
    catalog,
    repo,
    service,
    new WorkspaceService(repo, rt),
    new SymbologyService(repo, rt),
  );
});
afterEach(() => repo.close());
function fixture() {
  const item = catalog.execute({
    type: "create",
    kind: "DOCTRINE",
    sourceId: armyConfig.doctrine.id,
    name: "Test doctrine",
  }).entry!.item;
  const state = app.execute({
    type: "create",
    name: "Existing draft",
    demo: false,
    configuration: { id: item.id, version: 1 },
  });
  return { doctrineId: item.id, op: state.operation!, config: state.config };
}
function edit(doctrineId: string, fn: (v: DoctrineVersion) => void) {
  const v = app.document(doctrineId, "DOCTRINE") as DoctrineVersion;
  fn(v);
  syncDoctrineIndex(v);
  app.execute({
    type: "doctrine-save",
    doctrine: v,
    expectedContentVersion: v.contentVersion,
  });
}
it("updates a compatible existing draft on open, preserving authored content and exact historical doctrine", () => {
  const { doctrineId, op, config } = fixture();
  op.sections[0].summary = "Keep this authored situation.";
  const annex = config.doctrine.catalog!.nodes.find(
    (n) => n.nodeType === "ANNEX" && n.status === "ACTIVE",
  )!;
  instantiateProduct(op, config, annex.id, id).narrative =
    "Keep the annex narrative.";
  const saved = app.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  const original = canonical(saved),
    originalConfig = canonical(repo.getConfig(saved));
  edit(doctrineId, (v) => {
    v.displayName = "Updated doctrine";
    v.config.doctrine.staff[0].name = "Updated staff label";
    v.config.doctrine.paragraphs[0].title = "Updated situation";
    v.config.doctrine.catalog!.nodes.find(
      (n) => n.id === annex.id,
    )!.canonicalTitle = "Updated annex";
  });
  const state = app.execute({ type: "load", operationId: saved.id });
  expect(state.doctrineUpdate?.state).toBe("updated");
  expect(state.config.doctrine.name).toBe("Updated doctrine");
  expect(state.config.doctrine.staff[0].name).toBe("Updated staff label");
  expect(state.operation!.sections[0].summary).toBe(op.sections[0].summary);
  expect(state.operation!.attachments[0].name).toBe("Updated annex");
  expect(state.operation!.attachments[0].narrative).toBe(
    "Keep the annex narrative.",
  );
  expect(state.operation!.revision).toBe(saved.revision + 1);
  expect(canonical(repo.getOperation(saved.id, saved.revision))).toBe(original);
  expect(canonical(repo.getConfig(saved))).toBe(originalConfig);
  expect(
    app.execute({ type: "load", operationId: saved.id }).operation!.revision,
  ).toBe(state.operation!.revision);
  repo.verifyAll();
});
it("flags incompatible removed fields without altering the draft or leaking snapshots, and retries after correction", () => {
  const { doctrineId, op } = fixture();
  const original = canonical(op),
    snapshots = repo.catalog.catalogSnapshotCount(doctrineId);
  const doctrine = app.document(doctrineId, "DOCTRINE") as DoctrineVersion;
  edit(doctrineId, (v) => {
    v.config.doctrine.catalog!.baseFields = [];
  });
  const state = app.execute({ type: "load", operationId: op.id });
  expect(state.doctrineUpdate?.state).toBe("conflict");
  expect(state.doctrineUpdate?.messages.join(" ")).toMatch(/field.*removed/);
  expect(canonical(repo.getOperation(op.id))).toBe(original);
  expect(repo.catalog.catalogSnapshotCount(doctrineId)).toBe(snapshots);
  edit(doctrineId, (v) => {
    v.config.doctrine.catalog!.baseFields =
      doctrine.config.doctrine.catalog!.baseFields;
    v.displayName = "Corrected doctrine";
  });
  expect(
    app.execute({ type: "load", operationId: op.id }).doctrineUpdate?.state,
  ).toBe("updated");
  repo.verifyAll();
});
it("adds new doctrine modules while preserving operation modules and flags removed used definitions", () => {
  const { doctrineId, op } = fixture();
  const local = addOperationModule(
    op,
    op.orderId,
    newModuleDefinition("NARRATIVE", id()),
    id,
    rt.now(),
  );
  app.execute({ type: "save", operation: op, expectedRevision: op.revision });
  const definition = newModuleDefinition("NARRATIVE", id());
  definition.title = "New instructions";
  edit(doctrineId, (v) => {
    v.config.doctrine.modules ??= {
      schemaVersion: 1,
      doctrineVersionId: v.doctrineVersionId,
      layouts: [],
      assets: [],
    };
    v.config.doctrine.modules!.layouts.push({
      productId: null,
      definitions: [definition],
    });
  });
  const state = app.execute({ type: "load", operationId: op.id });
  expect(state.doctrineUpdate?.state).toBe("updated");
  expect(
    state.operation!.modules!.instances.some(
      (m) => m.moduleDefinitionId === definition.moduleDefinitionId,
    ),
  ).toBe(true);
  expect(
    state.operation!.modules!.instances.find(
      (m) => m.moduleInstanceId === local.moduleInstanceId,
    ),
  ).toEqual(local);
  const saved = canonical(state.operation);
  edit(doctrineId, (v) => {
    v.config.doctrine.modules!.layouts = [];
  });
  expect(
    app.execute({ type: "load", operationId: op.id }).doctrineUpdate?.state,
  ).toBe("conflict");
  expect(canonical(repo.getOperation(op.id))).toBe(saved);
  repo.verifyAll();
});
it("remaps imported doctrine images between snapshots and flags removal of an image still used by the draft", () => {
  const legacy = new OrdoService(repo, rt, (_name, c) =>
    demoOperation(c, id, rt.now()),
  );
  const created = legacy.execute({
    type: "doctrine-create",
    sourceId: armyConfig.doctrine.id,
    name: "Imported doctrine with an image",
    versionLabel: "1.0.0",
    newFamily: true,
  });
  const doctrine = created.doctrines.find(
    (d) => d.doctrineVersionId === created.selectedDoctrineId,
  )!;
  const doctrineId = doctrine.doctrineVersionId;
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    "base64",
  );
  const assetId = id();
  const asset = {
    assetId,
    operationId: null,
    doctrineVersionId: doctrineId,
    originalFilename: "fictional.png",
    mimeType: "image/png" as const,
    sizeBytes: bytes.length,
    sha256: hashBytes(bytes),
    createdAt: rt.now(),
    storageReference: `asset:${assetId}`,
  };
  repo.modular.insertAsset(asset, bytes);
  const image = newModuleDefinition("IMAGE", id());
  image.configuration.defaultAssetIds = [assetId];
  doctrine.config.doctrine.modules = {
    schemaVersion: 1,
    doctrineVersionId: doctrineId,
    layouts: [{ productId: null, definitions: [image] }],
    assets: [asset],
  };
  legacy.execute({
    type: "doctrine-save",
    doctrine,
    expectedContentVersion: doctrine.contentVersion,
  });
  catalog.importLegacy();
  const op = app.execute({
    type: "create",
    name: "Draft with doctrine image",
    demo: false,
    configuration: { id: doctrineId, version: 1 },
  }).operation!;
  edit(doctrineId, (v) => {
    v.displayName = "Updated image doctrine";
  });
  const withImage = app.execute({ type: "load", operationId: op.id });
  expect(withImage.doctrineUpdate?.state).toBe("updated");
  const original = canonical(withImage.operation);
  const oldAsset = withImage.config.doctrine.modules!.assets[0].assetId;
  edit(doctrineId, (v) => {
    v.displayName = "Renamed image doctrine";
  });
  const renamed = app.execute({ type: "load", operationId: op.id });
  expect(renamed.doctrineUpdate?.state).toBe("updated");
  const newAsset = renamed.config.doctrine.modules!.assets[0].assetId;
  expect(newAsset).not.toBe(oldAsset);
  expect(repo.assetData(newAsset)).toBe(repo.assetData(oldAsset));
  expect(renamed.operation!.modules!.instances[0].content).toMatchObject({
    type: "IMAGE",
    image: { assetId: newAsset },
  });
  expect(
    canonical(repo.getOperation(op.id, withImage.operation!.revision)),
  ).toBe(original);
  edit(doctrineId, (v) => {
    v.config.doctrine.modules!.assets = [];
    v.config.doctrine.modules!.layouts[0].definitions[0].configuration.defaultAssetIds =
      [];
  });
  const removed = app.execute({ type: "load", operationId: op.id });
  expect(removed.doctrineUpdate?.state).toBe("conflict");
  expect(removed.doctrineUpdate?.messages.join(" ")).toMatch(/image.*removed/);
  expect(removed.operation).toEqual(renamed.operation);
  repo.verifyAll();
});
it("leaves approved revisions pinned and adopts after the next planning save returns them to draft", () => {
  const { doctrineId, op, config } = fixture();
  op.metadata.statusId = config.doctrine.publicationRequiredStatus;
  op.revision++;
  repo.saveOperation(op, op.revision - 1, rt.actor);
  app.execute({
    type: "approve",
    operationId: op.id,
    expectedRevision: op.revision,
    note: "Fictional approved order",
  });
  const published = app.execute({
    type: "publish",
    operationId: op.id,
    expectedRevision: op.revision,
  });
  const publication = canonical(published.publications);
  const profile = published.profiles.find((p) => p.product === "opord")!;
  const exported = app.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: profile.id, version: profile.version },
    publicationId: published.publications[0].id,
  });
  const exportRecord = canonical(repo.listExports(op.id));
  expect(exported.exports).toHaveLength(1);
  edit(doctrineId, (v) => {
    v.displayName = "Later doctrine";
  });
  const before = app.execute({ type: "load", operationId: op.id });
  expect(before.doctrineUpdate?.state).toBe("deferred");
  expect(before.operation!.doctrineRef).toEqual(op.doctrineRef);
  const changed = structuredClone(before.operation!);
  changed.sections[0].summary = "New drafting work";
  const after = app.execute({
    type: "save",
    operation: changed,
    expectedRevision: changed.revision,
  });
  expect(after.doctrineUpdate?.state).toBe("updated");
  expect(after.operation!.metadata.statusId).toBe(
    config.doctrine.editingStatus,
  );
  expect(repo.getOperation(op.id, op.revision).doctrineRef).toEqual(
    op.doctrineRef,
  );
  expect(canonical(repo.listPublications(op.id))).toBe(publication);
  expect(canonical(repo.listExports(op.id))).toBe(exportRecord);
  repo.verifyAll();
});
it("preserves recovery copies and rejects stale edits after another reader updates the saved draft", () => {
  const { doctrineId, op } = fixture();
  const draft = structuredClone(op);
  draft.sections[0].summary = "Unfinished local writing";
  const key = { kind: "operation" as const, id: op.id, scope: op.id };
  repo.putWorkingDraft(
    {
      ...key,
      schemaVersion: 1,
      label: op.name,
      source: canonical(op),
      value: canonical(draft),
      sequence: 1,
      updatedAt: rt.now(),
    },
    0,
  );
  edit(doctrineId, (v) => {
    v.displayName = "Current doctrine";
  });
  expect(
    app.execute({ type: "load", operationId: op.id }).doctrineUpdate?.state,
  ).toBe("deferred");
  expect(repo.getOperation(op.id).revision).toBe(op.revision);
  expect(repo.getWorkingDraft(key)?.value).toBe(canonical(draft));
  repo.removeWorkingDraft(key, 1);
  expect(
    app.execute({ type: "load", operationId: op.id }).doctrineUpdate?.state,
  ).toBe("updated");
  expect(() =>
    app.execute({
      type: "save",
      operation: draft,
      expectedRevision: op.revision,
    }),
  ).toThrow(/changed/);
});
it("adopts after an explicit save without losing the recovered writing", () => {
  const { doctrineId, op } = fixture();
  const draft = structuredClone(op);
  draft.sections[0].summary = "Recovered writing to save.";
  repo.putWorkingDraft(
    {
      kind: "operation",
      id: op.id,
      scope: op.id,
      schemaVersion: 1,
      label: op.name,
      source: canonical(op),
      value: canonical(draft),
      sequence: 1,
      updatedAt: rt.now(),
    },
    0,
  );
  edit(doctrineId, (v) => {
    v.displayName = "Current saved doctrine";
  });
  const saved = app.execute({
    type: "save",
    operation: draft,
    expectedRevision: op.revision,
  });
  expect(saved.doctrineUpdate?.state).toBe("updated");
  expect(saved.operation!.sections[0].summary).toBe(draft.sections[0].summary);
  expect(saved.config.doctrine.name).toBe("Current saved doctrine");
  repo.verifyAll();
});
