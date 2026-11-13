import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import { ReviewService } from "../src/application/review-service";
import { GraphicExportService } from "../src/application/graphic-export-service";
import { starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { addOperationModule } from "../src/domain/module-authoring";
import { newModuleDefinition } from "../src/domain/modules";
import { newSymbolDefinition } from "../src/domain/symbology";
import { newOrbatLayout } from "../src/domain/orbat";
import { createExportProfile } from "../src/domain/factories";
import { renderOrbat } from "../src/rendering/orbat-renderer";
import { endpointSelector } from "../src/persistence/review-store";
import { comparisonSchema } from "../src/domain/diff/model";
import { reviewHeaderSchema, reviewState } from "../src/domain/reviews";
import { renderReviewReport } from "../src/export/review-report";
import { canonical } from "../src/export/projection";
import type { Operation } from "../src/domain/model";
let repo: SqliteRepository,
  service: OrdoService,
  reviews: ReviewService,
  op: Operation;
let tick = 0;
const rt = {
  id: uid,
  now: () => new Date(Date.UTC(2026, 9, 3, 12, 0, tick++)).toISOString(),
  actor: "Fictional review planner",
};
const save = () =>
  (op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!);
const latest = () => repo.revisionHistory(op.id)[0].endpoint;
beforeEach(() => {
  tick = 0;
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  service = new OrdoService(repo, rt, (_n, c) =>
    demoOperation(c, uid, rt.now()),
  );
  reviews = new ReviewService(repo, rt);
  op = service.execute({
    type: "create",
    name: "FICTIONAL V3 REVIEW",
    demo: true,
  }).operation!;
  addOperationModule(
    op,
    op.orderId,
    newModuleDefinition("TASK_ORGANIZATION", uid()),
    uid,
    rt.now(),
  );
  op.modules!.instances[0].content = {
    type: "TASK_ORGANIZATION",
    presentation: {
      schemaVersion: 1,
      mode: "DIAGRAM",
      ancestorPolicy: "BOUNDARY",
      foldPolicy: "AS_SHOWN",
      symbolSize: 30,
    },
  };
  op.units[0].symbol = {
    schemaVersion: 1,
    base: { definition: newSymbolDefinition(uid), source: null },
    override: null,
    labels: {
      uniqueDesignation: { kind: "UNIT_NAME" },
      higherFormation: { kind: "DEFINITION" },
    },
  };
  op.orbatLayout = newOrbatLayout(uid);
  save();
});
afterEach(() => repo.close());
const compare = (baseline: ReturnType<typeof latest>) =>
  reviews.execute({
    type: "compare",
    baseline: endpointSelector(baseline),
    target: endpointSelector(latest()),
    engineVersion: "diff-engine-v3",
  }).comparison!;
it("emits a canonical reparent once and keeps ORBAT layout separate", () => {
  const before = latest();
  op.units[1].parentUnitId = op.units[0].id;
  op.orbatLayout!.mode = "SIMPLE";
  save();
  const c = compare(before);
  expect(c.schemaVersion).toBe(2);
  expect(c.impactEngineVersion).toBe("impact-v3");
  expect(
    c.changes.filter((x) => x.fieldPath.endsWith("parentUnitId")),
  ).toHaveLength(1);
  expect(
    c.changes.find((x) => x.fieldPath.endsWith("parentUnitId"))?.category,
  ).toBe("TASK_ORGANIZATION");
  expect(
    c.changes.find((x) => x.fieldPath === "orbatLayout/mode"),
  ).toMatchObject({ category: "PRESENTATION", m6Kind: "ORBAT_LAYOUT" });
  expect(() =>
    reviews.execute({
      type: "compare",
      baseline: endpointSelector(before),
      target: endpointSelector(latest()),
      engineVersion: "diff-engine-v2",
    }),
  ).toThrow(/require diff-engine-v3/);
});
it("classifies provenance alone and gives it no derived visual impact", () => {
  op.units[0].symbol!.override = structuredClone(op.units[0].symbol!.base);
  save();
  const before = latest();
  op.units[0].symbol!.override!.definition.origin = {
    kind: "IMPORT",
    fileHash: "a".repeat(64),
    importerVersion: "fixture",
    originalCode: "RETAINED ORIGINAL",
  };
  save();
  const c = compare(before);
  expect(c.changes).toHaveLength(1);
  expect(c.changes[0]).toMatchObject({
    category: "PROVENANCE",
    m6Kind: "SYMBOL_PROVENANCE",
  });
  expect(c.impacts).toEqual([]);
});
it("reviews explicit label-profile adoption as a symbol change with graphical impact and no canonical reorganization", () => {
  op.units[0].symbol!.override = structuredClone(op.units[0].symbol!.base);
  save();
  const before = latest();
  op.units[0].symbol!.override!.definition.renderProfile.version = 2;
  save();
  const c = compare(before);
  expect(c.changes).toHaveLength(1);
  expect(c.changes[0].category).toBe("SYMBOL");
  expect(
    c.changes.some((change) => change.category === "TASK_ORGANIZATION"),
  ).toBe(false);
  const graphical = c.impacts.filter(
    (impact) =>
      impact.kind === "MODULE" &&
      impact.label === "Graphical Task Organization",
  );
  expect(graphical).toHaveLength(1);
  expect(graphical[0].changeIds).toEqual([c.changes[0].changeId]);
});
it("uses actual v5 consumed fields for layout and name impacts, excluding Signal cards", async () => {
  const p = createExportProfile(op, "opord", uid());
  p.inclusion.paragraphIds = [];
  p.inclusion.attachmentIds = [];
  p.inclusion.packageScope = "selected";
  repo.saveExportProfile(p);
  const state = await service.executeWithGraphics(
    {
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: p.id, version: 1 },
      publicationId: null,
    },
    {
      render: async (r) => {
        if (r.kind !== "ORBAT") throw Error("wrong request");
        return { kind: "ORBAT", result: renderOrbat(r.input) };
      },
    },
  );
  const graphic = state.exports[0];
  const card = state.profiles.find((p) => p.product === "communications-card")!;
  service.execute({
    type: "generate",
    operationId: op.id,
    expectedRevision: op.revision,
    profileRef: { id: card.id, version: card.version },
    publicationId: null,
  });
  const before = latest();
  op.units[0].name = "FICTIONAL CANONICAL RENAME";
  op.orbatLayout!.mode = "SIMPLE";
  save();
  const c = compare(before),
    impacts = c.impacts.filter((i) => i.kind === "EXPORT");
  const diagramImpact = impacts.find((i) => i.targetId === graphic.id)!;
  expect(diagramImpact.changeIds).toHaveLength(2);
  expect(
    diagramImpact.dependencyPaths.some((p) =>
      p.endsWith(`/units/${op.units[0].id}/name`),
    ),
  ).toBe(true);
  // The card consumes the renamed net-owner name, but never the ORBAT layout.
  const cardImpact = impacts.find((i) => i.targetId !== graphic.id)!;
  expect(cardImpact.changeIds).toEqual(
    c.changes
      .filter((c) => c.fieldPath.endsWith("/name"))
      .map((c) => c.changeId),
  );
  expect(c.changes.filter((c) => c.fieldPath.endsWith("/name"))).toHaveLength(
    1,
  );
  expect(c.changes.some((c) => c.m6Kind === "SYMBOL_BINDING")).toBe(false);
});
it("attributes visual changes only to consumed symbol fields and active snapshots", () => {
  op.units[0].symbol!.override = structuredClone(op.units[0].symbol!.base);
  save();
  const before = latest();
  op.units[0].symbol!.override!.definition.amplifiers.staffComments =
    "NOT RENDERED";
  op.units[0].symbol!.labels.higherFormation = { kind: "UNIT_NAME" };
  op.units[0].name = "VISIBLE RENAME";
  save();
  const c = compare(before);
  const graphical = c.impacts.filter(
    (i) => i.kind === "MODULE" && i.label === "Graphical Task Organization",
  );
  expect(graphical).toHaveLength(1);
  expect(graphical[0].changeIds).toEqual(
    c.changes
      .filter((c) => c.fieldPath.endsWith("/name"))
      .map((c) => c.changeId),
  );
  expect(c.changes.filter((c) => c.category === "SYMBOL")).toHaveLength(2);
});
it("records fallback sibling order as presentation and preserves canonical hierarchy", () => {
  op.units.forEach((u) => {
    u.inTaskOrganization = true;
  });
  save();
  const before = latest();
  op.units.reverse();
  save();
  const c = compare(before);
  expect(c.changes).toHaveLength(1);
  expect(c.changes[0]).toMatchObject({
    category: "PRESENTATION",
    fieldPath: "units/presentationOrder",
  });
  expect(
    c.impacts.some(
      (i) => i.kind === "MODULE" && i.changeIds.includes(c.changes[0].changeId),
    ),
  ).toBe(true);
});
it.each([false, true])(
  "retains standalone graphic impacts with exact analyzed identities (legacy endpoints: %s)",
  async (legacy) => {
    if (legacy) {
      op = service.execute({
        type: "create",
        name: "Fictional legacy endpoint",
        demo: true,
      }).operation!;
      expect(
        reviews.execute({ type: "history", operationId: op.id })
          .requiresGraphicalReview,
      ).toBe(false);
    }
    const graphics = new GraphicExportService(
      repo,
      rt,
      {
        render: async (r) => {
          if (r.kind !== "ORBAT") throw Error("fixture");
          return { kind: "ORBAT", result: renderOrbat(r.input) };
        },
      },
      {
        rasterize: async () => {
          throw Error("unused");
        },
      },
    );
    const graphic = await graphics.generate({
      source: {
        kind: "OPERATION",
        operationId: op.id,
        revision: op.revision,
        publicationId: null,
      },
      profile: {
        schemaVersion: 1,
        id: uid(),
        version: 1,
        name: "Standalone operation diagram",
        product: "ORBAT",
        format: "SVG",
        size: 30,
        scale: 1,
        background: "TRANSPARENT",
        selectedUnitIds: null,
        ancestorPolicy: "BOUNDARY",
        foldPolicy: "AS_SHOWN",
        renderProfile: { id: "ordo-symbol", version: 1 },
      },
    });
    expect(
      reviews.execute({ type: "history", operationId: op.id })
        .requiresGraphicalReview,
    ).toBe(true);
    const before = latest();
    op.units[0].name = "CANONICAL RENAME";
    if (!legacy) op.orbatLayout!.mode = "SIMPLE";
    save();
    const review = reviews.execute({
      type: "create-review",
      baseline: endpointSelector(before),
      target: endpointSelector(latest()),
      engineVersion: "diff-engine-v3",
      title: "Standalone impacts",
      description: "",
      expectedRevision: op.revision,
      parentReviewId: null,
      supersedesReviewId: null,
    }).review!;
    expect(review.comparison.analyzedExportIds).toContain(graphic.id);
    const impact = review.comparison.impacts.find(
      (i) => i.targetId === graphic.id,
    )!;
    expect(impact).toMatchObject({
      kind: "EXPORT",
      baselineOutdated: false,
      targetOutdated: true,
      compatibility: "supported",
    });
    expect(impact.changeIds).toHaveLength(legacy ? 1 : 2);
    expect(repo.getReview(review.id)).toEqual(review);
    repo.verifyAll();
  },
);
it("requires presentation dispositions and retains a v3 review/report through reload", () => {
  const before = latest();
  op.orbatLayout!.mode = "SIMPLE";
  save();
  let review = reviews.execute({
    type: "create-review",
    baseline: endpointSelector(before),
    target: endpointSelector(latest()),
    engineVersion: "diff-engine-v3",
    title: "Fictional presentation review",
    description: "",
    expectedRevision: op.revision,
    parentReviewId: null,
    supersedesReviewId: null,
  }).review!;
  const original = canonical(op);
  expect(review.reportRendererVersion).toBe("review-html-v3");
  expect(() =>
    reviews.execute({
      type: "review-actions",
      id: review.id,
      expectedSequence: 0,
      actions: [{ type: "COMPLETE" }],
      confirmedBulk: false,
    }),
  ).toThrow(/every change/);
  review = reviews.execute({
    type: "review-actions",
    id: review.id,
    expectedSequence: 0,
    actions: [
      {
        type: "DECISION",
        changeId: review.comparison.changes[0].changeId,
        disposition: "NOTED",
        note: "Presentation only",
      },
      { type: "COMPLETE" },
    ],
    confirmedBulk: true,
  }).review!;
  expect(reviewState(review).status).toBe("COMPLETED");
  expect(renderReviewReport(review)).toContain(
    "Presentation changes require disposition",
  );
  expect(repo.getReview(review.id)).toEqual(review);
  repo.verifyAll();
  expect(canonical(repo.getOperation(op.id))).toBe(original);
  expect(() =>
    reviewHeaderSchema.parse({
      ...review,
      events: undefined,
      reportRendererVersion: "review-html-v2",
    }),
  ).toThrow();
  expect(() =>
    comparisonSchema.parse({
      ...review.comparison,
      impactEngineVersion: "impact-v2",
    }),
  ).toThrow();
});
