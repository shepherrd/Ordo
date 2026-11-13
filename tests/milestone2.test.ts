import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { armyConfig, starterConfig } from "../src/config/profiles";
import { doctrineSchema, type Operation } from "../src/domain/model";
import { createOperation, createExportProfile } from "../src/domain/factories";
import { assertOperation } from "../src/domain/invariants";
import {
  catalogNodes,
  instantiateProduct,
  setApplicability,
  productFor,
  packageRows,
  authoringFindings,
  emptyContent,
} from "../src/domain/authoring";
import { resolveEditor, sourceClasses } from "../src/domain/doctrine";
import { demoOperation } from "../src/demo/operation";
import { SqliteRepository } from "../src/persistence/repository";
import { OrdoService } from "../src/application/service";
import {
  project,
  canonical,
  exportStaleness,
  projectVersion,
  projectionVersionFor,
} from "../src/export/projection";
import {
  registeredEditor,
  editorRegistry,
} from "../src/renderer/src/editorRegistry";
const nodes = catalogNodes(armyConfig),
  node = (key: string) => nodes.find((n) => n.stableKey === key)!;
const now = "2026-10-01T14:00:00.000Z";
let repo: SqliteRepository, service: OrdoService, op: Operation;
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  repo.seedConfig(armyConfig);
  service = new OrdoService(
    repo,
    { id: randomUUID, now: () => now, actor: "Test planner" },
    (_name, config) => demoOperation(config, randomUUID, now),
  );
  op = service.execute({
    type: "create",
    name: "FICTIONAL BRIGADE",
    demo: true,
    configuration: { id: armyConfig.organization.id, version: 1 },
  }).operation!;
});
afterEach(() => repo.close());
const save = () => {
  op = service.execute({
    type: "save",
    operation: op,
    expectedRevision: op.revision,
  }).operation!;
  return op;
};
const choose = (
  key: string,
  value: "INCLUDED" | "OMITTED" | "UNDECIDED" = "INCLUDED",
) => setApplicability(op, armyConfig, node(key).id, value, randomUUID);
describe("Milestone 2 catalog", () => {
  it("loads all A-Z roots and all 185 supplied identities with structured citations", () => {
    expect(
      nodes
        .filter((n) => n.nodeType === "ANNEX")
        .map((n) => n.code)
        .join(""),
    ).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(nodes).toHaveLength(185);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    for (const n of nodes) {
      expect(sourceClasses).toContain(n.sourceClass);
      expect(n.editorSourceClass).toBe("ORDO_DEFAULT");
      expect(n.sourceReferences[0]).toMatchObject({
        publicationIdentifier: "FM 5-0",
        editionDate: "2024-11-04",
        changeNumber: 1,
        changeDate: "2025-08-08",
      });
    }
  });
  it.each([
    ["B", 7],
    ["B.1", 4],
    ["C", 16],
    ["C.3", 3],
    ["D", 7],
    ["E", 13],
    ["F", 4],
    ["F.1", 8],
    ["F.1.C", 4],
    ["F.2", 5],
    ["G", 5],
    ["H", 5],
    ["H.1", 1],
    ["H.2", 5],
    ["H.3", 11],
    ["H.4", 5],
    ["H.5", 3],
    ["I", 7],
    ["J", 2],
    ["K", 3],
    ["L", 2],
    ["M", 3],
    ["Q", 5],
    ["S", 3],
  ])("has the supplied children under %s", (key, count) => {
    expect(nodes.filter((n) => n.parentStableKey === key)).toHaveLength(
      count as number,
    );
  });
  it("retains canonical, sample, alias, and spare distinctions", () => {
    expect(
      nodes
        .filter((n) => n.parentStableKey === "D" && n.canonicalTableD2)
        .map((n) => n.code),
    ).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(node("D.7")).toMatchObject({
      sourceClass: "FM5_SAMPLE_FORMAT",
      defaultApplicability: "DEFAULT_OMITTED",
      canonicalTableD2: false,
    });
    expect(node("J.1-sample").alternativeToStableKey).toBe("J.1");
    expect(node("Q.3").sourceVariants[0].sourceClass).toBe("FM5_SAMPLE_FORMAT");
    expect(node("Q.3").aliases).toContain(
      "Command and Control Information Systems Integration Matrix",
    );
    expect(
      nodes.filter((n) => n.status === "SPARE").map((n) => n.code),
    ).toEqual(["O", "T", "X", "Y"]);
    expect(node("F.2").sourceNotes).toContain("repeats");
    expect(node("F.1.C.1").nodeType).toBe("EXHIBIT");
    expect(["A", "R", "Z"].map((k) => node(k).formatType)).toEqual([
      "TASK_ORGANIZATION",
      "REPORT_CATALOG",
      "DISTRIBUTION_LIST",
    ]);
    for (const k of ["A", "N", "P", "R", "U", "V", "W", "Z"])
      expect(nodes.filter((n) => n.parentStableKey === k)).toHaveLength(0);
  });
  it.each([
    "duplicate-key",
    "duplicate-code",
    "missing-parent",
    "bad-type",
    "unknown-source",
    "unknown-reference",
    "spare-repurpose",
    "extra-json",
    "wrong-root-index",
    "unknown-owner",
  ])("rejects invalid doctrine: %s", (issue) => {
    const d = structuredClone(armyConfig.doctrine),
      n = d.catalog!.nodes.find((n) => n.stableKey === "B.1")!;
    if (issue === "duplicate-key") n.stableKey = "B.2";
    if (issue === "duplicate-code") n.code = "2";
    if (issue === "missing-parent") n.parentStableKey = "missing";
    if (issue === "bad-type") n.nodeType = "EXHIBIT";
    if (issue === "unknown-source") (n as any).sourceClass = "UNVERIFIED";
    if (issue === "unknown-reference") n.crossReferences = ["missing"];
    if (issue === "spare-repurpose")
      d.catalog!.nodes.find((n) => n.code === "O")!.status = "ACTIVE";
    if (issue === "extra-json") (n as any).arbitrary = {};
    if (issue === "wrong-root-index") d.annexCatalog[0].title = "Drift";
    if (issue === "unknown-owner") n.responsibleStaff = ["missing"];
    expect(() => doctrineSchema.parse(d)).toThrow();
  });
  it("preserves stable identity when display fields are revised in a new version", () => {
    const d = structuredClone(armyConfig.doctrine);
    d.version = 2;
    d.catalog!.contentVersion = "1.0.1";
    const n = d.catalog!.nodes.find((n) => n.stableKey === "B.1")!;
    n.canonicalTitle = "Organization title";
    n.code = "21";
    expect(
      doctrineSchema
        .parse(d)
        .catalog!.nodes.find((x) => x.id === node("B.1").id)?.stableKey,
    ).toBe("B.1");
  });
  it("resolves capabilities independently from renderer code with a generic fallback", () => {
    expect(resolveEditor("MATRIX")).toEqual({
      capability: "MATRIX",
      fallback: false,
    });
    expect(resolveEditor("FUTURE_SPECIALIST")).toEqual({
      capability: "GENERIC_STRUCTURED_PRODUCT",
      fallback: true,
    });
    const cfg = structuredClone(armyConfig);
    cfg.doctrine.catalog!.nodes[0].editorHint = "FUTURE_SPECIALIST";
    expect(doctrineSchema.safeParse(cfg.doctrine).success).toBe(true);
    expect(
      authoringFindings(op, cfg).some(
        (f) => f.field === "editorHint" && f.severity === "warning",
      ),
    ).toBe(true);
  });
});
describe("Milestone 2 operational authoring", () => {
  it("inherits current parent ownership without mutating doctrine and permits explicit child ownership", () => {
    choose("C");
    choose("C.3");
    productFor(op, node("C"))!.metadata.ownerId = "intel";
    expect(
      packageRows(op, armyConfig).find((r) => r.node.stableKey === "C.3.A")!
        .ownerId,
    ).toBe("intel");
    productFor(op, node("C.3"))!.metadata.ownerId = "signal";
    expect(
      packageRows(op, armyConfig).find((r) => r.node.stableKey === "C.3.A")!
        .ownerId,
    ).toBe("signal");
    expect(node("C").responsibleStaff).toEqual(["ops"]);
  });
  it("registers every requested editor and preserves unsupported product content via fallback", () => {
    expect(Object.keys(editorRegistry)).toHaveLength(11);
    expect(registeredEditor("UNKNOWN_SPECIALIST")).toMatchObject({
      implementation: "generic",
      fallback: true,
    });
    const cfg = structuredClone(armyConfig);
    cfg.doctrine.catalog!.nodes.find((n) => n.stableKey === "B.1")!.editorHint =
      "UNKNOWN_SPECIALIST";
    const a = instantiateProduct(op, cfg, node("B.1").id, randomUUID);
    a.content = {
      kind: "generic",
      references: [],
      fields: [
        {
          id: randomUUID(),
          label: "Authored detail",
          value: "Retain this content",
        },
      ],
    };
    expect(
      assertOperation(op, cfg).attachments.find((p) => p.id === a.id)?.content,
    ).toEqual(a.content);
  });
  it("rejects duplicate active alternative instances even before inclusion", () => {
    instantiateProduct(op, armyConfig, node("J.1").id, randomUUID);
    instantiateProduct(op, armyConfig, node("J.1-sample").id, randomUUID);
    expect(() => assertOperation(op, armyConfig)).toThrow(/alternatives/);
    productFor(op, node("J.1"))!.applicability = "OMITTED";
    expect(() => assertOperation(op, armyConfig)).not.toThrow();
  });
  it("rejects invalid canonical references and matrix columns with explainable findings", () => {
    const a = instantiateProduct(op, armyConfig, node("C.3.A").id, randomUUID);
    a.content = {
      kind: "matrix",
      references: [{ kind: "task", id: randomUUID() }],
      columns: [],
      rows: [{ id: randomUUID(), cells: { [randomUUID()]: "Invalid column" } }],
    };
    const findings = authoringFindings(op, armyConfig);
    expect(findings.some((f) => f.message.includes("unknown column"))).toBe(
      true,
    );
    expect(
      findings.some((f) => f.message.includes("Missing authoritative task")),
    ).toBe(true);
    expect(() => assertOperation(op, armyConfig)).toThrow();
  });
  it("validates report/distribution links without mutating references or stored facts", () => {
    const r = instantiateProduct(op, armyConfig, node("R").id, randomUUID);
    r.content = {
      kind: "reports",
      references: [],
      reports: [
        {
          id: randomUUID(),
          name: "Report",
          format: "",
          submission: "",
          recipientUnitId: op.units[0].id,
          eventId: op.events[0].id,
        },
      ],
    };
    const before = canonical(op);
    authoringFindings(op, armyConfig);
    authoringFindings(op, armyConfig);
    expect(canonical(op)).toBe(before);
    r.content.reports[0].recipientUnitId = randomUUID();
    expect(() => assertOperation(op, armyConfig)).toThrow(
      /Missing authoritative unit/,
    );
  });
  it("rejects untyped narrative copies in canonical Execution collections", () => {
    const f = armyConfig.doctrine.catalog!.baseFields.find(
      (f) => f.stableKey === "intent-key-tasks",
    )!;
    op.authoring!.fields.push({
      fieldId: f.id,
      text: "A second editable task",
      references: [],
    });
    expect(() => assertOperation(op, armyConfig)).toThrow(
      /additional free-form narrative/,
    );
  });
  it("does not instantiate documents for catalog browsing", () => {
    expect(op.attachments).toHaveLength(2);
    expect(packageRows(op, armyConfig)).toHaveLength(185);
    expect(op.attachments).toHaveLength(2);
    const fresh = createOperation("Blank", armyConfig, randomUUID, now);
    expect(fresh.attachments).toEqual([]);
    expect(fresh.authoring).toEqual({ fields: [] });
  });
  it("persists applicability in revisions without changing doctrine", () => {
    const original = canonical(armyConfig);
    choose("B");
    save();
    choose("B", "OMITTED");
    save();
    choose("B", "UNDECIDED");
    save();
    expect(
      productFor(repo.getOperation(op.id, 2), node("B"))?.applicability,
    ).toBe("INCLUDED");
    expect(
      productFor(repo.getOperation(op.id, 3), node("B"))?.applicability,
    ).toBe("OMITTED");
    expect(productFor(repo.getOperation(op.id), node("B"))?.applicability).toBe(
      "UNDECIDED",
    );
    expect(canonical(armyConfig)).toBe(original);
    repo.verifyAll();
  });
  it("rejects omitted ancestors and simultaneous J1 variants atomically", () => {
    choose("C");
    choose("C.3");
    choose("C.3.A");
    const before = canonical(op);
    expect(() => choose("C", "OMITTED")).toThrow(/omitted parent/);
    expect(canonical(op)).toBe(before);
    choose("J");
    choose("J.1");
    expect(() => choose("J.1-sample")).toThrow(/alternatives/);
    choose("J.1", "OMITTED");
    choose("J.1-sample");
    expect(assertOperation(op, armyConfig)).toBeTruthy();
  });
  it("rejects invalid applicability, hierarchy, spare authoring and local copies of Signal", () => {
    expect(() =>
      instantiateProduct(op, armyConfig, node("O").id, randomUUID),
    ).toThrow(/spare/);
    choose("B.1");
    productFor(op, node("B.1"))!.parentId = op.orderId;
    expect(() => assertOperation(op, armyConfig)).toThrow(/appendix/);
    op.attachments = op.attachments.filter(
      (a) => a.doctrineNodeId !== node("B.1").id,
    );
    productFor(op, node("H"))!.content = {
      kind: "generic",
      references: [],
      fields: [],
    };
    expect(() => assertOperation(op, armyConfig)).toThrow(/cannot be copied/);
  });
  it("provides owner, status, applicability, spare, content and findings filters", () => {
    choose("B");
    choose("C", "OMITTED");
    const findings = authoringFindings(op, armyConfig);
    expect(
      packageRows(op, armyConfig, findings, "Included").map((r) => r.node.code),
    ).toEqual(["A", "B", "H"]);
    expect(packageRows(op, armyConfig, findings, "Omitted")).toHaveLength(1);
    expect(packageRows(op, armyConfig, findings, "Spare")).toHaveLength(4);
    expect(
      packageRows(op, armyConfig, findings, "By Owner", "intel").every(
        (r) => r.ownerId === "intel",
      ),
    ).toBe(true);
    expect(
      packageRows(op, armyConfig, findings, "Has Issues").some(
        (r) => r.node.stableKey === "B",
      ),
    ).toBe(true);
    expect(
      packageRows(op, armyConfig, findings, "Undecided").every(
        (r) => r.applicability === "UNDECIDED" && r.node.status !== "SPARE",
      ),
    ).toBe(true);
  });
  it("authors typed matrix, checklist, generic, report and distribution content", () => {
    for (const key of ["C.3.A", "C.3.C", "B.1", "R", "Z"]) {
      const a = instantiateProduct(op, armyConfig, node(key).id, randomUUID);
      a.content = emptyContent(node(key), randomUUID);
    }
    expect(
      ["C.3.A", "C.3.C", "B.1", "R", "Z"].map(
        (k) => productFor(op, node(k))!.content!.kind,
      ),
    ).toEqual(["matrix", "checklist", "generic", "reports", "distribution"]);
    save();
    repo.verifyAll();
  });
  it("preserves explicit configuration pins and unchanged legacy base narratives", () => {
    const old = demoOperation(starterConfig, randomUUID, now),
      original = canonical(old.sections);
    repo.saveOperation(old, null, "Test planner");
    const newer = structuredClone(armyConfig);
    newer.doctrine.version = 2;
    newer.doctrine.catalog!.contentVersion = "2.0.0";
    newer.organization.version = 2;
    newer.organization.doctrineRef.version = 2;
    repo.seedConfig(newer);
    expect(repo.getConfig(old).doctrine).toEqual(starterConfig.doctrine);
    expect(repo.getConfig(op).doctrine.version).toBe(1);
    expect(canonical(repo.getOperation(old.id).sections)).toBe(original);
    expect(projectionVersionFor(old)).toBe(2);
    const p = createExportProfile(old, "opord", randomUUID());
    expect(project(old, p, starterConfig)).toEqual(
      projectVersion(2, old, p, starterConfig),
    );
    expect(() =>
      repo.seedConfig({
        ...starterConfig,
        doctrine: { ...starterConfig.doctrine, name: "Changed" },
      }),
    ).toThrow(/overwritten/);
  });
  it("projects only included products and canonical task, unit and Signal facts", () => {
    choose("B", "OMITTED");
    choose("C");
    choose("C.3");
    choose("C.3.A");
    const a = productFor(op, node("C.3.A"))!;
    a.content = emptyContent(node("C.3.A"), randomUUID);
    const p = createExportProfile(op, "opord", randomUUID());
    const view = project(op, p, armyConfig).view;
    expect(view.sections.some((s) => s.title.includes("C.3.A"))).toBe(true);
    expect(view.sections.some((s) => s.title.includes("Intelligence"))).toBe(
      false,
    );
    expect(canonical(view)).toContain(op.tasks[0].purpose);
    expect(canonical(view)).toContain(op.signal.nets[0].channel);
    op.signal.nets[0].channel = "SOURCE UPDATED";
    expect(canonical(project(op, p, armyConfig).view)).toContain(
      "SOURCE UPDATED",
    );
    expect(
      op.attachments.some((a) =>
        a.content?.references.some((r) => r.kind === "net"),
      ),
    ).toBe(false);
  });
  it("keeps card dependencies independent from package selection and follows live Signal", () => {
    const p = service
      .load(op.id)
      .profiles.find((p) => p.product === "communications-card")!;
    const record = service.execute({
      type: "generate",
      operationId: op.id,
      expectedRevision: op.revision,
      profileRef: { id: p.id, version: p.version },
      publicationId: null,
    }).exports[0];
    choose("B");
    save();
    expect(exportStaleness(record, op).outdated).toBe(false);
    op.signal.nets[0].channel = "CHANGED";
    save();
    expect(exportStaleness(record, op).outdated).toBe(true);
    expect(record.projectionVersion).toBe(3);
  });
  it("freezes package applicability and authoring in publications", () => {
    choose("B");
    op.metadata.statusId = "approved";
    save();
    service.execute({
      type: "approve",
      operationId: op.id,
      expectedRevision: op.revision,
      note: "Fictional acceptance",
    });
    const pub = service.execute({
      type: "publish",
      operationId: op.id,
      expectedRevision: op.revision,
    }).publications[0];
    const snapshot = canonical(pub);
    choose("B", "OMITTED");
    save();
    expect(canonical(repo.listPublications(op.id)[0])).toBe(snapshot);
    expect(productFor(pub.snapshot, node("B"))!.applicability).toBe("INCLUDED");
    repo.verifyAll();
  });
});
