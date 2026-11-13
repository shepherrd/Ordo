import { describe, it, expect } from "vitest";
import { randomUUID as id, createHash } from "node:crypto";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { createExportProfile } from "../src/domain/factories";
import { addOperationModule } from "../src/domain/module-authoring";
import { newModuleDefinition } from "../src/domain/modules";
import { operationSchema } from "../src/domain/model";
import {
  resolvePlanningCard,
  independentCard,
} from "../src/domain/planning-card-resolution";
import {
  removedCardSources,
  handleRemovedCardSources,
} from "../src/domain/planning-card-actions";
import { planningCardFindings } from "../src/domain/planning-card-validation";
import { planningReferences } from "../src/domain/planning-usage";
import { projectPlanningCards } from "../src/export/planning-cards";
import { canonical } from "../src/export/projection";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { documentStaleness } from "../src/application/verify-document-layout";
import { newDocumentLayout } from "../src/domain/document-layout";
import { ConfiguredDocumentService } from "../src/application/configured-document-service";
import { DocumentLayoutReviewService } from "../src/application/document-layout-review";
import type { CardOrigin } from "../src/domain/planning-cards";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderReviewReport } from "../src/export/narrative-review-report";
import { validateWorkingDraft } from "../src/application/working-drafts";
const now = "2026-10-15T12:00:00.000Z",
  rt = { id, now: () => now, actor: "Fictional planner" };
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function fixture(config = starterConfig) {
  const op = demoOperation(config, id, now),
    original = structuredClone(op);
  const block = addOperationModule(
    op,
    op.orderId,
    newModuleDefinition("PLANNING_CARDS", id()),
    id,
    now,
  );
  const card = {
    id: id(),
    title: "Reception task",
    mode: "linked" as const,
    source: {
      kind: "entity" as const,
      entityKind: "task" as const,
      entityId: op.tasks[0].id,
    },
    fields: ["name", "purpose"] as ("name" | "purpose")[],
  };
  op.planningCards = { schemaVersion: 1, definitions: [card] };
  if (block.content.type !== "PLANNING_CARDS") throw Error("Fixture");
  block.content.placements.push(
    { id: id(), cardId: card.id, layout: "compact" },
    { id: id(), cardId: card.id, layout: "detailed" },
  );
  const profile = createExportProfile(op, "opord", id());
  profile.inclusion.paragraphIds = [];
  profile.inclusion.attachmentIds = [];
  profile.inclusion.packageScope = "selected";
  return { op, original, block, card, profile };
}
describe("linked planning cards", () => {
  it.each([starterConfig, armyConfig])(
    "adds local cards without replacing doctrine content, and resolves whole-field IDs",
    (config) => {
      const { op, original, card, profile } = fixture(config);
      expect(operationSchema.parse(op)).toEqual(op);
      expect(op.sections).toEqual(original.sections);
      expect(op.authoring).toEqual(original.authoring);
      expect(op.attachments).toEqual(original.attachments);
      expect(op.modules!.instances).toHaveLength(
        (original.modules?.instances.length ?? 0) + 1,
      );
      expect(() =>
        validateWorkingDraft({
          schemaVersion: 1,
          kind: "operation",
          id: op.id,
          scope: null,
          label: op.name,
          source: canonical(original),
          value: canonical(op),
          sequence: 1,
          updatedAt: now,
        }),
      ).not.toThrow();
      const view = projectPlanningCards(op, profile, config).view;
      expect(canonical(view).match(/order-planning-card /g)).toHaveLength(2);
      expect(canonical(view)).not.toContain("ORDO_CARD_BLOCK_");
      const paragraph = {
        ...card,
        source: { kind: "paragraph" as const, paragraphId: op.sections[0].id },
        fields: ["text" as const],
      };
      expect(resolvePlanningCard(op, config, paragraph).values[0].value).toBe(
        op.sections[0].summary,
      );
    },
  );
  it("detaches only one placement and tracks only selected values", () => {
    const { op, card, block, profile } = fixture();
    const values = resolvePlanningCard(op, starterConfig, card).values;
    const origin: CardOrigin = {
      target: card.source,
      contentHash: hash(values),
      state: { kind: "working", baseRevision: op.revision, draftGeneration: 4 },
    };
    const copy = independentCard(op, starterConfig, card, id(), origin);
    op.planningCards!.definitions.push(copy);
    expect(resolvePlanningCard(op, starterConfig, copy).unitIds).toEqual([
      op.tasks[0].unitId,
    ]);
    if (block.content.type !== "PLANNING_CARDS") throw Error("Fixture");
    block.content.placements[1].cardId = copy.id;
    const before = projectPlanningCards(
      op,
      profile,
      starterConfig,
    ).dependencies;
    op.tasks[0].metadata.source.note = "Unselected source field";
    expect(
      projectPlanningCards(op, profile, starterConfig).dependencies,
    ).toEqual(before);
    op.tasks[0].purpose = "New purpose";
    expect(resolvePlanningCard(op, starterConfig, card).values[1].value).toBe(
      "New purpose",
    );
    expect(resolvePlanningCard(op, starterConfig, copy).values).toEqual(values);
    expect(
      projectPlanningCards(op, profile, starterConfig).dependencies,
    ).not.toEqual(before);
    expect(
      planningReferences(op).some((r) => r.kind === "Independent copy"),
    ).toBe(true);
  });
  it("preserves identities on deletion, handles dependent cards in one draft, and bounds content", () => {
    const { op, card, profile } = fixture();
    const next = structuredClone(op);
    next.tasks = next.tasks.filter((t) => t.id !== card.source.entityId);
    expect(removedCardSources(op, next).map((c) => c.id)).toEqual([card.id]);
    expect(planningCardFindings(next, starterConfig)[0].severity).toBe("error");
    expect(() => projectPlanningCards(next, profile, starterConfig)).toThrow(
      "unavailable",
    );
    const removed = handleRemovedCardSources(
      op,
      next,
      starterConfig,
      "remove",
      new Map(),
    );
    expect(removed.planningCards!.definitions).toEqual([]);
    const copied = handleRemovedCardSources(
      op,
      next,
      starterConfig,
      "copy",
      new Map([
        [
          card.id,
          {
            target: card.source,
            contentHash: hash(
              resolvePlanningCard(op, starterConfig, card).values,
            ),
            state: { kind: "saved", revision: op.revision },
          },
        ],
      ]),
    );
    expect(copied.planningCards!.definitions[0].mode).toBe("independent");
    expect(planningCardFindings(copied, starterConfig)).toEqual([]);
    expect(op.tasks).toHaveLength(next.tasks.length + 1);
    op.tasks[0].purpose = "x".repeat(40001);
    expect(() => resolvePlanningCard(op, starterConfig, card)).toThrow(
      "40,000",
    );
  });
  it("applies source audience/phase restrictions and relative event dependencies", () => {
    const { op, card, profile } = fixture();
    profile.inclusion.audienceUnitIds = [
      op.units.find((u) => u.id !== op.tasks[0].unitId)!.id,
    ];
    expect(
      canonical(projectPlanningCards(op, profile, starterConfig).view),
    ).not.toContain("order-planning-card ");
    profile.inclusion.audienceUnitIds = [];
    const event = op.events.find((e) => e.relativeToEventId)!;
    op.planningCards!.definitions[0] = {
      ...card,
      source: { kind: "entity", entityKind: "event", entityId: event.id },
      fields: ["name", "time"],
    };
    const before = projectPlanningCards(
      op,
      profile,
      starterConfig,
    ).dependencies;
    expect(before.some((d) => d.path.includes("/upstream/"))).toBe(true);
    op.events.find((e) => e.id === event.relativeToEventId)!.at =
      "2036-05-24T12:00:00.000Z";
    expect(
      projectPlanningCards(op, profile, starterConfig).dependencies,
    ).not.toEqual(before);
  });
  it("bounds a thousand definitions and two thousand placements without expanding source searches", () => {
    const { op, card, block, profile } = fixture();
    op.planningCards!.definitions = Array.from({ length: 1000 }, (_, i) => ({
      ...card,
      id: id(),
      title: `Card ${i}`,
    }));
    if (block.content.type !== "PLANNING_CARDS") throw Error("Fixture");
    block.content.placements = Array.from({ length: 2000 }, (_, i) => ({
      id: id(),
      cardId: op.planningCards!.definitions[i % 1000].id,
      layout: "compact" as const,
    }));
    expect(operationSchema.safeParse(op).success).toBe(true);
    expect(
      canonical(projectPlanningCards(op, profile, starterConfig).view).match(
        /order-planning-card /g,
      ),
    ).toHaveLength(2000);
    block.content.placements.push({
      id: id(),
      cardId: card.id,
      layout: "compact",
    });
    expect(operationSchema.safeParse(op).success).toBe(false);
  });
  it("retains cards, publication values, configured PDF provenance, and review comparison", async () => {
    const repo = new SqliteRepository(":memory:");
    try {
      repo.seedConfig(starterConfig);
      const service = new OrdoService(repo, rt, (_n, c) =>
        demoOperation(c, id, now),
      );
      let op = service.execute({
        type: "create",
        name: "Fictional connected planning",
        demo: true,
      }).operation!;
      const block = addOperationModule(
        op,
        op.orderId,
        newModuleDefinition("PLANNING_CARDS", id()),
        id,
        now,
      );
      const card = {
        id: id(),
        title: "Retained task",
        mode: "linked" as const,
        source: {
          kind: "entity" as const,
          entityKind: "task" as const,
          entityId: op.tasks[0].id,
        },
        fields: ["purpose" as const],
      };
      op.planningCards = { schemaVersion: 1, definitions: [card] };
      if (block.content.type !== "PLANNING_CARDS") throw Error("Fixture");
      block.content.placements.push({
        id: id(),
        cardId: card.id,
        layout: "detailed",
      });
      op.metadata.documentLayout = newDocumentLayout();
      op.metadata.statusId = starterConfig.doctrine.publicationRequiredStatus;
      op.units.forEach((u) => {
        u.inTaskOrganization = true;
      });
      op = service.execute({
        type: "save",
        operation: op,
        expectedRevision: op.revision,
      }).operation!;
      const revision = op.revision,
        originalPurpose = op.tasks[0].purpose;
      expect(
        service.load(op.id).findings.filter((f) => f.severity === "error"),
      ).toEqual([]);
      service.execute({
        type: "approve",
        operationId: op.id,
        expectedRevision: op.revision,
        note: "Checked",
      });
      const publication = service.execute({
        type: "publish",
        operationId: op.id,
        expectedRevision: op.revision,
      }).publications[0];
      const profile = repo
        .listExportProfiles(op.id)
        .find((p) => p.product === "opord")!;
      service.execute({
        type: "generate",
        operationId: op.id,
        expectedRevision: op.revision,
        profileRef: { id: profile.id, version: profile.version },
        publicationId: publication.id,
      });
      const record = repo.listExports(op.id)[0];
      expect(record.schemaVersion).toBe(7);
      expect(record.html).toContain(originalPurpose);
      expect(record.html).not.toContain("ORDO_CARD_BLOCK_");
      const pdf = await new ConfiguredDocumentService(repo, rt, {
        render: async () => ({
          bytes: new TextEncoder().encode("%PDF-fixture"),
          environment: {
            appVersion: "test",
            electron: "test",
            chromium: "test",
            fontFingerprint: "0".repeat(64),
          },
        }),
      }).generate({
        type: "generate",
        operationId: op.id,
        exportId: record.id,
        options: { paper: "A4", orientation: "portrait" },
      });
      expect(pdf.printVersion).toBe("ordo-print-v3");
      op.tasks[0].purpose = "Changed live source";
      op.planningCards!.definitions[0].title = "Renamed card";
      op = service.execute({
        type: "save",
        operation: op,
        expectedRevision: op.revision,
      }).operation!;
      expect(repo.getOperation(op.id).planningCards).toEqual(op.planningCards);
      expect(repo.listExports(op.id)[0].html).toBe(record.html);
      expect(documentStaleness(record, op).outdated).toBe(true);
      service.execute({
        type: "generate",
        operationId: op.id,
        expectedRevision: op.revision,
        profileRef: { id: profile.id, version: profile.version },
        publicationId: publication.id,
      });
      expect(
        repo.listExports(op.id).find((e) => e.id !== record.id)!.html,
      ).toContain(originalPurpose);
      const history = repo.revisionHistory(op.id).map((h) => h.endpoint);
      const baseline = history.find((h) => h.revisionNumber === revision)!,
        target = history.find((h) => h.revisionNumber === op.revision)!;
      const review = new DocumentLayoutReviewService(repo, rt).execute({
        type: "compare",
        engineVersion: "diff-engine-v3",
        baseline: {
          kind: "REVISION",
          operationId: op.id,
          revisionId: baseline.revisionId,
        },
        target: {
          kind: "REVISION",
          operationId: op.id,
          revisionId: target.revisionId,
        },
      });
      expect(review.comparison!.planningCards!.changes[0].label).toBe(
        "Renamed card",
      );
      const retainedReview = new DocumentLayoutReviewService(repo, rt).execute({
        type: "create-review",
        engineVersion: "diff-engine-v3",
        baseline: {
          kind: "REVISION",
          operationId: op.id,
          revisionId: baseline.revisionId,
        },
        target: {
          kind: "REVISION",
          operationId: op.id,
          revisionId: target.revisionId,
        },
        title: "Card changes",
        description: "",
        expectedRevision: op.revision,
        parentReviewId: null,
        supersedesReviewId: null,
      }).review!;
      expect(retainedReview.reportRendererVersion).toBe("review-html-v6");
      expect(renderReviewReport(retainedReview)).toContain("Renamed card");
      repo.verifyAll();
      const folder = mkdtempSync(resolve(".test-data/card-backup-"));
      try {
        await repo.backup(join(folder, "backup.db"));
        const restored = new SqliteRepository(join(folder, "backup.db"));
        try {
          restored.verifyAll();
          expect(restored.getOperation(op.id)).toEqual(op);
          expect(
            restored.listExports(op.id).find((e) => e.id === record.id)?.html,
          ).toBe(record.html);
          expect(restored.getDocument(pdf.id).record).toEqual(pdf);
          while (!restored.search.rebuildBatch()) {}
        } finally {
          restored.close();
        }
      } finally {
        if (!resolve(folder).startsWith(resolve(".test-data")))
          throw Error("Fixture escaped test directory");
        rmSync(folder, { recursive: true, force: true });
      }
    } finally {
      repo.close();
    }
  });
});
