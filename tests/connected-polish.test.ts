import { describe, it, expect } from "vitest";
import { randomUUID as id } from "node:crypto";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { seedLegacyAlternative } from "./fixtures/legacy-alternative";
import { OfficeService } from "../src/application/office-service";
import { independentCard } from "../src/domain/planning-card-resolution";
import { planningReferences } from "../src/domain/planning-usage";
import {
  setProductProgress,
  refreshPlanningReadiness,
} from "../src/domain/planning-progress";
import { addOperationModule } from "../src/domain/module-authoring";
import { newModuleDefinition } from "../src/domain/modules";
import { newBriefingSlide } from "../src/domain/briefings";
import type { PlanningCard } from "../src/domain/planning-cards";
const now = "2026-10-19T12:00:00.000Z",
  rt = { id, now: () => now, actor: "Fictional drafter" };
function setup() {
  const repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  const app = new OrdoService(repo, rt, () =>
    demoOperation(starterConfig, id, now),
  );
  const op = app.execute({
    type: "create",
    name: "Fictional baseline",
    demo: true,
  }).operation!;
  const save = (o: typeof op) =>
    app.execute({ type: "save", operation: o, expectedRevision: o.revision })
      .operation!;
  const branch = (o: typeof op) =>
    seedLegacyAlternative(repo, rt, o.id, o.revision, "Alternative");
  return { repo, app, op, save, branch };
}
function card(op: ReturnType<typeof demoOperation>): PlanningCard {
  return {
    id: id(),
    title: "Task purpose",
    mode: "linked",
    fields: ["purpose"],
    source: { kind: "entity", entityKind: "task", entityId: op.tasks[0].id },
  };
}
describe("connected delivery integration", () => {
  it("resolves legacy copy origins through alternatives and preserves immutable first revisions", () => {
    const { repo, op, save, branch, app } = setup();
    try {
      const linked = card(op);
      const copy = independentCard(op, starterConfig, linked, id(), {
        target: linked.mode === "linked" ? linked.source : linked.origin.target,
        contentHash: "0".repeat(64),
        state: { kind: "saved", revision: op.revision },
      });
      if (copy.mode !== "independent") throw Error("Fixture");
      delete copy.origin.operationId; // A card saved before this fix.
      op.planningCards = { schemaVersion: 1, definitions: [copy] };
      const original = save(op),
        a = repo.getOperation(branch(original)),
        b = repo.getOperation(branch(a));
      const first = JSON.stringify(repo.getOperation(a.id, 1));
      for (const alt of [a, b]) {
        const refs = planningReferences(
          alt,
          starterConfig,
          repo.cardOrigins(alt),
        );
        expect(
          refs.find((r) => r.kind === "Independent copy")?.to,
        ).toMatchObject({
          operationId: original.id,
          target: { entityId: original.tasks[0].id },
        });
        expect(
          app.load(alt.id).cardOrigins[alt.planningCards!.definitions[0].id],
        ).toBe(original.id);
      }
      expect(
        repo.search
          .usage({
            target: {
              area: "operation",
              operationId: original.id,
              target: {
                kind: "entity",
                entityKind: "task",
                entityId: original.tasks[0].id,
              },
            },
            excludedOwners: [],
            offset: 0,
          })
          .references.filter((r) => r.kind === "Independent copy"),
      ).toHaveLength(3);
      repo.alternatives.verifyAll();
      expect(JSON.stringify(repo.getOperation(a.id, 1))).toBe(first);
      const deletion = repo.prepareDeletion({
        kind: "operation",
        id: original.id,
      });
      expect(deletion.blockers).toEqual([]);
      repo.permanentlyDelete(
        { kind: "operation", id: original.id },
        deletion.fingerprint,
      );
      expect(repo.cardOrigins(b)[b.planningCards!.definitions[0].id]).toBe(
        original.id,
      );
      repo.verifyAll();
    } finally {
      repo.close();
    }
  });
  it("reopens only products with changed writing or displayed linked values and records the reason", () => {
    const op = demoOperation(starterConfig, id, now),
      c = card(op);
    const first = op.attachments[0],
      second = op.attachments[1];
    op.planningCards = { schemaVersion: 1, definitions: [c] };
    const block = addOperationModule(
      op,
      first.id,
      newModuleDefinition("PLANNING_CARDS", id()),
      id,
      now,
    );
    if (block.content.type !== "PLANNING_CARDS") throw Error("Fixture");
    block.content.placements = [{ id: id(), cardId: c.id, layout: "compact" }];
    setProductProgress(op, first.id, { readyAt: now });
    setProductProgress(op, second.id, { readyAt: now });
    let after = structuredClone(op);
    after.tasks[0].name = "Undisplayed name";
    expect(
      refreshPlanningReadiness(
        op,
        after,
        starterConfig,
      ).planningProgress?.products.every((p) => p.readyAt === now),
    ).toBe(true);
    after = structuredClone(op);
    after.tasks[0].unitId = op.units.find(
      (u) => u.id !== op.tasks[0].unitId,
    )!.id;
    expect(
      refreshPlanningReadiness(
        op,
        after,
        starterConfig,
      ).planningProgress?.products.find((p) => p.productId === first.id)
        ?.reopenedReason,
    ).toBe("Linked information changed");
    after = structuredClone(op);
    after.tasks[0].purpose = "Changed displayed purpose";
    const result = refreshPlanningReadiness(op, after, starterConfig);
    expect(
      result.planningProgress?.products.find((p) => p.productId === first.id),
    ).toMatchObject({
      readyAt: null,
      reopenedReason: "Linked information changed",
    });
    expect(
      result.planningProgress?.products.find((p) => p.productId === second.id)
        ?.readyAt,
    ).toBe(now);
    setProductProgress(result, first.id, { readyAt: now });
    expect(
      result.planningProgress?.products.find((p) => p.productId === first.id)
        ?.reopenedReason,
    ).toBeUndefined();
    after = structuredClone(op);
    after.attachments[1].narrative = "New writing";
    expect(
      refreshPlanningReadiness(
        op,
        after,
        starterConfig,
      ).planningProgress?.products.find((p) => p.productId === second.id)
        ?.reopenedReason,
    ).toBe("Writing changed");
  });
  it("reports PPTX freshness including speaker notes, keeps retained bytes, and previews the frozen source", async () => {
    const { repo, op, save } = setup();
    try {
      const deck = {
        id: id(),
        name: "Fictional briefing",
        footer: "",
        slides: [
          {
            ...newBriefingSlide(id(), "text"),
            title: "Saved slide",
            body: "Original text",
            notes: "Private notes",
          },
        ],
      };
      op.briefings = { schemaVersion: 1, decks: [deck] };
      let current = save(op);
      const office = new OfficeService(repo, repo.office, rt, {
        appVersion: "test",
        render: async () => new Uint8Array([0x50, 0x4b, 1, 2]),
      });
      const record = await office.generate({
        type: "generate",
        operationId: op.id,
        expectedRevision: current.revision,
        source: {
          kind: "briefing",
          deckId: deck.id,
          revision: current.revision,
          publicationId: null,
        },
      });
      expect(office.list(op.id, 0, "DOCX")).toEqual([]);
      expect(() => office.inspect(record.id, "DOCX")).toThrow(/not available/);
      expect(office.list(op.id)[0].status).toBe("Current");
      current.briefings!.decks[0].slides[0].notes = "Changed notes";
      current = save(current);
      expect(office.list(op.id)[0].status).toBe("Outdated");
      expect(office.inspect(record.id).html).toContain("Original text");
      current.briefings!.decks = [];
      save(current);
      expect(office.list(op.id)[0].status).toBe("Source unavailable");
      expect([...repo.office.get(record.id).bytes]).toEqual([0x50, 0x4b, 1, 2]);
    } finally {
      repo.close();
    }
  });
  it("tracks DOCX freshness and superseded publications without changing retained content", async () => {
    const { repo, app, save } = setup();
    try {
      const op = app.execute({
        type: "create",
        name: "Fictional retained order",
        demo: false,
      }).operation!;
      op.metadata.statusId = starterConfig.doctrine.publicationRequiredStatus;
      let current = save(op);
      const publish = () => {
        if (
          current.metadata.statusId !==
          starterConfig.doctrine.publicationRequiredStatus
        ) {
          current.metadata.statusId =
            starterConfig.doctrine.publicationRequiredStatus;
          current = save(current);
        }
        app.execute({
          type: "approve",
          operationId: op.id,
          expectedRevision: current.revision,
          note: "Fictional fixture",
        });
        return app.execute({
          type: "publish",
          operationId: op.id,
          expectedRevision: current.revision,
        }).publications[0];
      };
      const publication = publish();
      const loaded = app.load(op.id);
      const profile = loaded.profiles.find((p) => p.product === "opord")!;
      const order = app.execute({
        type: "generate",
        operationId: op.id,
        expectedRevision: current.revision,
        profileRef: { id: profile.id, version: profile.version },
        publicationId: publication.id,
      }).exports[0];
      const office = new OfficeService(repo, repo.office, rt, {
        appVersion: "test",
        render: async () => new Uint8Array([0x50, 0x4b, 1, 2]),
      });
      const record = await office.generate({
        type: "generate",
        operationId: op.id,
        expectedRevision: current.revision,
        source: {
          kind: "order",
          exportId: order.id,
          options: { paper: "Letter", orientation: "portrait" },
        },
      });
      expect(office.list(op.id)[0]).toMatchObject({
        status: "Current",
        superseded: false,
      });
      current = repo.getOperation(op.id);
      current.sections[0].summary = "Changed reception purpose";
      current = save(current);
      expect(office.list(op.id)[0]).toMatchObject({
        status: "Outdated",
        superseded: false,
      });
      publish();
      expect(office.list(op.id)[0].superseded).toBe(true);
      expect(office.inspect(record.id).html).toBe(order.html);
      expect([...repo.office.get(record.id).bytes]).toEqual([0x50, 0x4b, 1, 2]);
    } finally {
      repo.close();
    }
  });
});
