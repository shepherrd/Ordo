import { describe, expect, it } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { readFileSync } from "node:fs";
import { armyConfig, starterConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import type {
  Operation,
  ResolvedConfig,
  ExportRecord,
} from "../src/domain/model";
import {
  endpointSchema,
  endpointSelectorSchema,
  canonicalValue,
  type ResolvedEndpoint,
} from "../src/domain/diff/model";
import { semanticDiff } from "../src/domain/diff";
import { richDiff } from "../src/domain/diff/rich";
import { movedIds } from "../src/domain/diff/sequence";
import { textDifference } from "../src/domain/diff/text";
import { reviewHash as hash } from "../src/persistence/review-store";
import { hashBytes } from "../src/persistence/modular-store";
import {
  newModuleDefinition,
  type ModuleContent,
  type RichNode,
  type FieldDefinition,
} from "../src/domain/modules";
import { addOperationModule } from "../src/domain/module-authoring";
import { instantiateProduct } from "../src/domain/authoring";
import { reviewImpacts } from "../src/application/review-impact";
import { createExportProfile } from "../src/domain/factories";
import { projectVersion, projectionVersionFor } from "../src/export/projection";
const now = "2026-10-03T12:00:00.000Z";
const make = (config = armyConfig) => demoOperation(config, uid, now);
export function endpoint(
  op: Operation,
  config: ResolvedConfig = armyConfig,
): ResolvedEndpoint {
  return {
    operation: op,
    config,
    endpoint: endpointSchema.parse({
      kind: "REVISION",
      operationId: op.id,
      revisionId: uid(),
      revisionNumber: op.revision,
      publicationId: null,
      doctrineRef: op.doctrineRef,
      organizationRef: op.organizationRef,
      echelonRef: op.echelonRef,
      stateHash: hash(canonicalValue(op)),
      configHash: hash(canonicalValue(config)),
      timestamp: now,
      operationName: op.name,
      label: `Revision ${op.revision}`,
    }),
  };
}
function diff(a: Operation, b: Operation, config = armyConfig) {
  return semanticDiff(
    "diff-engine-v1",
    endpoint(a, config),
    endpoint(b, config),
    hash,
  );
}
function changed(edit: (b: Operation) => void, config = armyConfig) {
  const a = make(config),
    b = structuredClone(a);
  edit(b);
  return { a, b, changes: diff(a, b, config) };
}
function mod(a: Operation, type: string) {
  return addOperationModule(
    a,
    a.orderId,
    newModuleDefinition(type, uid()),
    uid,
    now,
  );
}
function contentDiff(
  type: string,
  before: ModuleContent,
  after: ModuleContent,
) {
  const a = make(),
    m = mod(a, type);
  m.content = before;
  const b = structuredClone(a);
  b.modules!.instances[0].content = after;
  return diff(a, b);
}
const field = (
  label = "Quantity",
  type: FieldDefinition["type"] = "INTEGER",
): FieldDefinition => ({
  id: uid(),
  stableKey: uid(),
  label,
  type,
  required: false,
  help: "",
  options: [],
});
const rich = (text: string): RichNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
function impacts(
  a: Operation,
  b: Operation,
  config = armyConfig,
  exports: ExportRecord[] = [],
) {
  return reviewImpacts(
    endpoint(a, config),
    endpoint(b, config),
    diff(a, b, config),
    exports,
    hash,
  );
}
function exportRecord(
  op: Operation,
  config = armyConfig,
  fields = ["channel"],
): ExportRecord {
  const profile = createExportProfile(op, "communications-card", uid());
  profile.inclusion.netFields = fields as typeof profile.inclusion.netFields;
  profile.inclusion.includePace = false;
  profile.inclusion.includeLostCommunications = false;
  return {
    id: uid(),
    operationId: op.id,
    sourceRevision: op.revision,
    profile,
    config,
    dependencies: projectVersion(projectionVersionFor(op), op, profile, config)
      .dependencies,
    projectionVersion: projectionVersionFor(op),
    generatedAt: now,
  } as ExportRecord;
}
describe("M4 semantic endpoint and deterministic engine", () => {
  it("preserves all historical migrations, projections, renderers and doctrine byte-for-byte", () => {
    const hashes = JSON.parse(
      readFileSync("tests/fixtures/milestone4-frozen-hashes.json", "utf8"),
    );
    for (const [path, value] of Object.entries(hashes))
      expect(hashBytes(readFileSync(path))).toBe(value);
  });
  it("requires explicit immutable endpoint identities", () => {
    expect(() =>
      endpointSelectorSchema.parse({ kind: "CURRENT", operationId: uid() }),
    ).toThrow();
    expect(() =>
      endpointSelectorSchema.parse({
        kind: "REVISION",
        operationId: uid(),
        revisionId: uid(),
        snapshot: {},
      }),
    ).toThrow();
  });
  it("rejects inconsistent publication endpoints", () => {
    const e = endpoint(make()).endpoint;
    expect(() => endpointSchema.parse({ ...e, kind: "PUBLICATION" })).toThrow();
  });
  it("rejects cross-operation and reversed comparisons", () => {
    const a = endpoint(make()),
      b = endpoint(make());
    expect(() => semanticDiff("diff-engine-v1", a, b, hash)).toThrow();
    b.operation = a.operation;
    b.endpoint = { ...a.endpoint, revisionNumber: 0 };
    expect(() => semanticDiff("diff-engine-v1", a, b, hash)).toThrow();
  });
  it("rejects unknown engines", () => {
    const a = endpoint(make());
    expect(() => semanticDiff("diff-engine-v999", a, a, hash)).toThrow(
      /Unsupported/,
    );
  });
  it("is deterministic including fingerprints across endpoint labels and revisions", () => {
    const { a, b, changes } = changed((b) => (b.name = "Renamed"));
    expect(diff(a, b)).toEqual(changes);
    b.revision++;
    b.updatedAt = "2026-10-04T00:00:00.000Z";
    expect(diff(a, b)).toEqual(changes);
    expect(changes[0].changeType).toBe("MODIFIED");
    expect(changes[0].entityId).toBe(a.id);
  });
  it("ignores serialization and save metadata", () => {
    const a = make(),
      b = JSON.parse(
        JSON.stringify(a, (_key, v) =>
          v && typeof v === "object" && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).reverse())
            : v,
        ),
      );
    b.revision++;
    b.updatedAt = "2026-10-04T00:00:00.000Z";
    expect(diff(a, b)).toEqual([]);
  });
  it("does not classify automatic approved-to-draft invalidation as an authored edit", () => {
    const a = make();
    a.metadata.statusId = armyConfig.doctrine.publicationRequiredStatus;
    const b = structuredClone(a);
    b.metadata.statusId = armyConfig.doctrine.editingStatus;
    b.name = "Edit";
    expect(diff(a, b)).toHaveLength(1);
  });
  it.each([starterConfig, armyConfig])(
    "retains legacy base narrative with pinned configuration",
    (config) => {
      const { changes } = changed(
        (b) => (b.sections[0].summary += " Amended narrative."),
        config,
      );
      expect(changes).toHaveLength(1);
      expect(changes[0].category).toBe("BASE_ORDER");
      expect(changes[0].afterDisplay).toContain("Amended narrative");
    },
  );
  it("compares structured base fields by stable field ID", () => {
    const { changes } = changed(
      (b) => (b.authoring!.fields[0].text = "Commander purpose updated"),
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].fieldPath).toContain("base/fields/");
  });
});
describe("M4 canonical operational semantics", () => {
  it.each([
    [
      "task organization parent",
      "TASK_ORGANIZATION",
      (b: Operation): void => {
        b.units[1].parentUnitId = null;
      },
    ],
    [
      "task organization membership",
      "TASK_ORGANIZATION",
      (b: Operation): void => {
        b.units[1].inTaskOrganization = !b.units[1].inTaskOrganization;
      },
    ],
    [
      "unit rename",
      "TASK_ORGANIZATION",
      (b: Operation): void => {
        b.units[1].name = "Renamed unit";
      },
    ],
    [
      "task purpose",
      "TASK",
      (b: Operation): void => {
        b.tasks[0].purpose = "Changed purpose";
      },
    ],
    [
      "task assignment",
      "TASK",
      (b: Operation): void => {
        b.tasks[0].unitId = null;
      },
    ],
    [
      "objective",
      "OBJECTIVE",
      (b: Operation): void => {
        b.objectives[0].name = "Changed objective";
      },
    ],
    [
      "phase",
      "PHASE",
      (b: Operation): void => {
        b.phases[0].name = "Changed phase";
      },
    ],
    [
      "H-Hour",
      "EVENT",
      (b: Operation): void => {
        b.events.find((e) => !!e.at)!.at = "2026-10-05T00:00:00.000Z";
      },
    ],
    [
      "event offset",
      "EVENT",
      (b: Operation): void => {
        b.events.find((e) => !!e.relativeToEventId)!.offsetMinutes -= 15;
      },
    ],
    [
      "net channel",
      "SIGNAL",
      (b: Operation): void => {
        b.signal.nets[0].channel = "DEMO CHANNEL 09";
      },
    ],
    [
      "PACE",
      "SIGNAL",
      (b: Operation): void => {
        b.signal.pacePlans[0].alternate = "Changed alternate";
      },
    ],
  ] as const)("reports %s once", (_name, category, edit) => {
    const { changes } = changed(edit);
    expect(changes).toHaveLength(1);
    expect(changes[0].category).toBe(category);
  });
  it("treats participant arrays as sets", () => {
    const { changes } = changed((b) =>
      b.signal.nets[0].participantUnitIds.reverse(),
    );
    expect(changes).toEqual([]);
  });
  it("reports applicability as operation state and leaves doctrine intact", () => {
    const a = make(),
      h = canonicalValue(armyConfig);
    const b = structuredClone(a);
    b.attachments[0].applicability = "OMITTED";
    const changes = diff(a, b);
    expect(changes.some((c) => c.category === "PRODUCT_APPLICABILITY")).toBe(
      true,
    );
    expect(canonicalValue(armyConfig)).toBe(h);
  });
  it("reports explicit staff overrides and restoration", () => {
    const a = make();
    a.attachments[0].metadata.ownerId = null;
    const b = structuredClone(a);
    b.attachments[0].metadata.ownerId = armyConfig.doctrine.staff[0].id;
    const c = diff(a, b).find((c) => c.category === "RESPONSIBLE_STAFF")!;
    expect(c.humanSummary).toContain("Operational override");
    expect(
      diff(b, a).find((c) => c.category === "RESPONSIBLE_STAFF")!.afterDisplay,
    ).toBe("Not set");
  });
  it("records phase reorder without false index edits", () => {
    const a = make(),
      b = structuredClone(a);
    [b.phases[0].sequence, b.phases[1].sequence] = [
      b.phases[1].sequence,
      b.phases[0].sequence,
    ];
    expect(diff(a, b)).toHaveLength(1);
    expect(diff(a, b)[0].changeType).toBe("MOVED");
  });
});
describe("M4 module identity, layout and cells", () => {
  it("reports module add and removal by instance identity", () => {
    const a = make(),
      b = structuredClone(a),
      m = mod(b, "PLAIN_TEXT");
    expect(diff(a, b)).toMatchObject([
      { changeType: "ADDED", moduleInstanceId: m.moduleInstanceId },
    ]);
    const c = structuredClone(b);
    c.modules!.instances[0].layoutState = "REMOVED_BY_OPERATION_OVERRIDE";
    expect(diff(b, c)).toMatchObject([{ changeType: "REMOVED" }]);
  });
  it("insertion and positional renumbering produce no moves", () => {
    expect(movedIds(["a", "b", "c"], ["x", "a", "b", "c"])).toEqual([]);
  });
  it("minimal stable-ID move detection", () => {
    expect(movedIds(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c"]);
  });
  it("reports only one module move", () => {
    const a = make();
    for (let i = 0; i < 3; i++) mod(a, "PLAIN_TEXT");
    const b = structuredClone(a);
    b.modules!.instances[2].position = 0;
    b.modules!.instances[0].position = 1;
    b.modules!.instances[1].position = 2;
    expect(diff(a, b)).toMatchObject([{ changeType: "MOVED" }]);
  });
  it("records operational overrides explicitly", () => {
    const a = make(),
      m = mod(a, "TABLE"),
      b = structuredClone(a);
    b.modules!.instances[0].configurationOverride = structuredClone(
      m.localDefinition!.configuration,
    );
    expect(diff(a, b)).toMatchObject([{ changeType: "CONFIGURATION_CHANGED" }]);
  });
  it("plain text is readable", () => {
    const c = contentDiff(
      "PLAIN_TEXT",
      { type: "PLAIN_TEXT", text: "Before" },
      { type: "PLAIN_TEXT", text: "After" },
    );
    expect(c).toMatchObject([
      { beforeDisplay: "Before", afterDisplay: "After", detailKind: "text" },
    ]);
  });
  it("key/value compares typed values by field ID", () => {
    const id = uid(),
      c = contentDiff(
        "KEY_VALUE",
        { type: "KEY_VALUE", values: { [id]: false } },
        { type: "KEY_VALUE", values: { [id]: true } },
      );
    expect(c).toMatchObject([{ beforeValue: false, afterValue: true }]);
  });
  it.each(["TABLE", "MATRIX"] as const)(
    "%s isolates one typed row/column cell",
    (type) => {
      const a = make(),
        m = mod(a, type),
        f = field();
      m.localDefinition!.configuration.columns = [f];
      m.content = { type, rows: [{ id: uid(), cells: { [f.id]: 12 } }] };
      const b = structuredClone(a);
      (
        b.modules!.instances[0].content as Extract<
          ModuleContent,
          { type: "TABLE" | "MATRIX" }
        >
      ).rows[0].cells[f.id] = 17;
      const c = diff(a, b);
      expect(c).toHaveLength(1);
      expect(c[0]).toMatchObject({
        beforeValue: 12,
        afterValue: 17,
        detailKind: "cell",
      });
      expect(c[0].humanSummary).toContain("Quantity");
      expect(c[0].fieldPath).toContain(
        (m.content as Extract<ModuleContent, { type: "TABLE" | "MATRIX" }>)
          .rows[0].id,
      );
    },
  );
  it("column rename is one modification, with its stable identity retained", () => {
    const a = make(),
      m = mod(a, "TABLE"),
      f = field();
    m.localDefinition!.configuration.columns = [f];
    const b = structuredClone(a);
    b.modules!.instances[0].localDefinition!.configuration.columns![0].label =
      "Available";
    const c = diff(a, b);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      changeType: "MODIFIED",
      beforeDisplay: "Quantity",
      afterDisplay: "Available",
    });
    expect(c[0].fieldPath).toContain(f.id);
  });
  it("column addition and deletion retain distinct identities", () => {
    const a = make(),
      m = mod(a, "TABLE"),
      f = field();
    m.localDefinition!.configuration.columns = [f];
    const b = structuredClone(a);
    b.modules!.instances[0].localDefinition!.configuration.columns = [
      field("New"),
    ];
    expect(
      diff(a, b)
        .map((c) => c.changeType)
        .sort(),
    ).toEqual(["ADDED", "REMOVED"]);
  });
  it("row add/remove/move uses stable IDs", () => {
    const rows = [
      { id: uid(), cells: {} },
      { id: uid(), cells: {} },
      { id: uid(), cells: {} },
    ];
    expect(
      contentDiff(
        "TABLE",
        { type: "TABLE", rows },
        { type: "TABLE", rows: [rows[2], rows[0], rows[1]] },
      ),
    ).toMatchObject([{ changeType: "MOVED" }]);
    expect(
      contentDiff(
        "TABLE",
        { type: "TABLE", rows },
        { type: "TABLE", rows: [rows[1], rows[2], { id: uid(), cells: {} }] },
      )
        .map((c) => c.changeType)
        .sort(),
    ).toEqual(["ADDED", "REMOVED"]);
  });
  it("checklist state changes remain on the same item", () => {
    const item = {
      id: uid(),
      text: "Verify",
      checked: false,
      notes: "",
      unitId: null,
      staffId: null,
      eventId: null,
    };
    expect(
      contentDiff(
        "CHECKLIST",
        { type: "CHECKLIST", items: [item] },
        { type: "CHECKLIST", items: [{ ...item, checked: true }] },
      ),
    ).toMatchObject([{ beforeValue: false, afterValue: true }]);
  });
  it.each(["at", "referenceEventId", "offsetMinutes"])(
    "timeline compares structural %s",
    (kind) => {
      const item = {
        id: uid(),
        title: "H-30",
        description: "",
        phaseId: null,
        timing:
          kind === "at"
            ? { mode: "ABSOLUTE" as const, at: now }
            : {
                mode: "RELATIVE" as const,
                referenceEventId: uid(),
                offsetMinutes: -30,
              },
      };
      const next = structuredClone(item);
      if (kind === "at" && next.timing.mode === "ABSOLUTE")
        next.timing.at = "2026-10-04T00:00:00.000Z";
      if (kind === "referenceEventId" && next.timing.mode === "RELATIVE")
        next.timing.referenceEventId = uid();
      if (kind === "offsetMinutes" && next.timing.mode === "RELATIVE")
        next.timing.offsetMinutes = -45;
      const c = contentDiff(
        "TIMELINE",
        { type: "TIMELINE", items: [item] },
        { type: "TIMELINE", items: [next] },
      );
      expect(c).toHaveLength(1);
      expect(c[0].fieldPath).toContain(kind);
    },
  );
  it("chart direct point value is primary", () => {
    const p = { id: uid(), label: "Day", x: 1, value: 5 };
    expect(
      contentDiff(
        "CHART",
        {
          type: "CHART",
          chartType: "BAR",
          source: { mode: "DIRECT", points: [p] },
        },
        {
          type: "CHART",
          chartType: "BAR",
          source: { mode: "DIRECT", points: [{ ...p, value: 6 }] },
        },
      ),
    ).toMatchObject([{ beforeValue: 5, afterValue: 6 }]);
  });
  it("chart binding is primary and source table IDs are compared", () => {
    const source = {
      mode: "TABLE" as const,
      moduleInstanceId: uid(),
      categoryColumnId: uid(),
      valueColumnIds: [uid()],
    };
    const c = contentDiff(
      "CHART",
      { type: "CHART", chartType: "BAR", source },
      {
        type: "CHART",
        chartType: "BAR",
        source: { ...source, moduleInstanceId: uid() },
      },
    );
    expect(c).toMatchObject([{ changeType: "RELINKED" }]);
    expect(c[0].humanSummary).toContain("Source table");
  });
  it("image replacement uses ID/hash labels without bytes", () => {
    const a = make(),
      m = mod(a, "IMAGE");
    const assets = [uid(), uid()].map((assetId, i) => ({
      assetId,
      operationId: a.id,
      doctrineVersionId: null,
      originalFilename: `fictional-${i}.png`,
      mimeType: "image/png" as const,
      sizeBytes: 12,
      sha256: String(i).repeat(64),
      createdAt: now,
      storageReference: `asset:${assetId}`,
    }));
    a.modules!.assets = assets;
    m.content = {
      type: "IMAGE",
      image: {
        id: uid(),
        assetId: assets[0].assetId,
        title: "",
        caption: "",
        alt: "",
        width: "full",
        alignment: "center",
      },
    };
    const b = structuredClone(a);
    (b.modules!.instances[0].content as typeof m.content).image!.assetId =
      assets[1].assetId;
    const c = diff(a, b);
    expect(c).toHaveLength(1);
    expect(c[0].category).toBe("ASSET");
    expect(c[0].afterDisplay).toContain(assets[1].sha256);
  });
  it("gallery reorder is a move without asset replacement", () => {
    const images = [uid(), uid()].map((id) => ({
      id,
      assetId: uid(),
      title: "",
      caption: "",
      alt: "",
      width: "full" as const,
      alignment: "center" as const,
    }));
    expect(
      contentDiff(
        "IMAGE_GALLERY",
        { type: "IMAGE_GALLERY", images },
        { type: "IMAGE_GALLERY", images: [...images].reverse() },
      ),
    ).toMatchObject([{ changeType: "MOVED" }]);
  });
  it("file attachment replacement uses managed references", () => {
    expect(
      contentDiff(
        "FILE_ATTACHMENT",
        {
          type: "FILE_ATTACHMENT",
          assetId: uid(),
          displayName: "File",
          description: "",
        },
        {
          type: "FILE_ATTACHMENT",
          assetId: uid(),
          displayName: "File",
          description: "",
        },
      ),
    ).toMatchObject([{ category: "ASSET", detailKind: "asset" }]);
  });
  it("canonical references are relinked by kind and ID", () => {
    const a = { kind: "unit" as const, id: uid() },
      b = { kind: "task" as const, id: uid() };
    expect(
      contentDiff(
        "CANONICAL_REFERENCES",
        { type: "CANONICAL_REFERENCES", references: [a] },
        { type: "CANONICAL_REFERENCES", references: [b] },
      )
        .map((c) => c.changeType)
        .sort(),
    ).toEqual(["ADDED", "REMOVED"]);
  });
  it("report catalog keeps report ID through a rename", () => {
    const report = {
      id: uid(),
      name: "Report",
      format: "Text",
      submission: "Daily",
      recipientUnitId: null,
      eventId: null,
    };
    const c = contentDiff(
      "REPORT_CATALOG",
      {
        type: "REPORT_CATALOG",
        data: { kind: "reports", references: [], reports: [report] },
      },
      {
        type: "REPORT_CATALOG",
        data: {
          kind: "reports",
          references: [],
          reports: [{ ...report, name: "Renamed report" }],
        },
      },
    );
    expect(c).toHaveLength(1);
    expect(c[0].fieldPath).toContain(report.id);
  });
  it("distribution record retains stable recipient identity", () => {
    const r = {
      id: uid(),
      recipient: "Cell",
      dutyPosition: "Lead",
      unitId: null,
      location: "HQ",
      distributionPurpose: "Info",
      copyNumber: "1",
      method: "Local",
      acknowledgmentRequired: false,
    };
    expect(
      contentDiff(
        "DISTRIBUTION_LIST",
        {
          type: "DISTRIBUTION_LIST",
          data: { kind: "distribution", references: [], recipients: [r] },
        },
        {
          type: "DISTRIBUTION_LIST",
          data: {
            kind: "distribution",
            references: [],
            recipients: [{ ...r, acknowledgmentRequired: true }],
          },
        },
      ),
    ).toMatchObject([{ beforeValue: false, afterValue: true }]);
  });
});
describe("M4 rich content and narrative alignment", () => {
  it("highlights changed words without parsing markup", () => {
    const d = textDifference("One old sentence", "One new sentence");
    expect(
      d.before
        .filter((p) => p.changed)
        .map((p) => p.text)
        .join(""),
    ).toBe("old");
    expect(
      d.after
        .filter((p) => p.changed)
        .map((p) => p.text)
        .join(""),
    ).toBe("new");
  });
  it("bounds very large narrative alignment", () => {
    const d = textDifference("a ".repeat(20000), "b ".repeat(20000));
    expect(d.before.map((p) => p.text).join("")).toHaveLength(40000);
  });
  it("rich sentence edit is one text change", () => {
    expect(
      richDiff(rich("One old sentence"), rich("One new sentence"), hash),
    ).toMatchObject([{ summary: "Paragraph text modified" }]);
  });
  it("rich segmentation noise is suppressed", () => {
    const b = rich("Same text");
    b.content![0].content = [
      { type: "text", text: "Same " },
      { type: "text", text: "text" },
    ];
    expect(richDiff(rich("Same text"), b, hash)).toEqual([]);
  });
  it("formatting is separate from text changes", () => {
    const a = rich("Bold"),
      b = structuredClone(a);
    b.content![0].content![0].marks = [{ type: "bold" }];
    expect(richDiff(a, b, hash)).toMatchObject([
      { summary: "Text formatting changed" },
    ]);
  });
  it("link change uses URL values", () => {
    const a = rich("Link"),
      b = structuredClone(a);
    b.content![0].content![0].marks = [
      { type: "link", attrs: { href: "https://example.com" } },
    ];
    expect(richDiff(a, b, hash)).toMatchObject([
      {
        summary: "Link changed",
        after: [{ href: "https://example.com", start: 0, end: 4 }],
      },
    ]);
  });
  it("tracks hyperlink range movement even when text and URL stay the same", () => {
    const a = rich("Link other");
    a.content![0].content = [
      {
        type: "text",
        text: "Link",
        marks: [{ type: "link", attrs: { href: "https://example.com" } }],
      },
      { type: "text", text: " other" },
    ];
    const b = rich("Link other");
    b.content![0].content = [
      { type: "text", text: "Link " },
      {
        type: "text",
        text: "other",
        marks: [{ type: "link", attrs: { href: "https://example.com" } }],
      },
    ];
    expect(richDiff(a, b, hash)).toMatchObject([{ summary: "Link changed" }]);
  });
  it("normalizes adjacent linked text fragments", () => {
    const a = rich("Link");
    a.content![0].content![0].marks = [
      { type: "link", attrs: { href: "https://example.com" } },
    ];
    const b = structuredClone(a);
    b.content![0].content = [
      { ...b.content![0].content![0], text: "Li" },
      { ...b.content![0].content![0], text: "nk" },
    ];
    expect(richDiff(a, b, hash)).toEqual([]);
  });
  it("list insertion keeps later blocks anchored", () => {
    const a = rich("Keep"),
      b = structuredClone(a);
    b.content!.unshift({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "New item" }],
            },
          ],
        },
      ],
    });
    expect(richDiff(a, b, hash)).toMatchObject([
      { summary: "Bullet list item added", kind: "ADDED" },
    ]);
  });
  it("ordered list start is a meaningful style change", () => {
    const a: RichNode = {
        type: "doc",
        content: [
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              { type: "listItem", content: [rich("Item").content![0]] },
            ],
          },
        ],
      },
      b = structuredClone(a);
    b.content![0].attrs!.start = 3;
    expect(richDiff(a, b, hash)).toMatchObject([
      { summary: "Block style changed" },
    ]);
  });
  it("image insertion is structured rather than rendered HTML", () => {
    const a = rich("Keep"),
      b = structuredClone(a);
    b.content!.push({
      type: "image",
      attrs: { assetId: uid(), alt: "Fictional" },
    });
    expect(richDiff(a, b, hash)).toMatchObject([
      { summary: "Image added", kind: "ADDED" },
    ]);
  });
});
describe("M4 exact source versus derived impacts", () => {
  it("does not attribute a simultaneous Signal edit to unrelated unit metadata", () => {
    const a = make(),
      b = structuredClone(a);
    b.units[0].metadata.ownerId = "ops";
    b.signal.nets[0].channel = "Changed";
    const cs = diff(a, b),
      metadata = cs.find((c) => c.fieldPath.includes("/metadata/"))!;
    expect(metadata).toBeDefined();
    expect(
      impacts(a, b).filter((i) => i.changeIds.includes(metadata.changeId)),
    ).toEqual([]);
  });
  it("does not attribute selected chart data changes to a simultaneous unselected cell edit", () => {
    const a = make(),
      t = mod(a, "TABLE"),
      x = field("Period", "SHORT_TEXT"),
      y = field("Selected"),
      z = field("Unselected");
    t.localDefinition!.configuration.columns = [x, y, z];
    t.content = {
      type: "TABLE",
      rows: [{ id: uid(), cells: { [x.id]: "One", [y.id]: 1, [z.id]: 2 } }],
    };
    const chart = mod(a, "CHART");
    chart.content = {
      type: "CHART",
      chartType: "BAR",
      source: {
        mode: "TABLE",
        moduleInstanceId: t.moduleInstanceId,
        categoryColumnId: x.id,
        valueColumnIds: [y.id],
      },
    };
    const b = structuredClone(a),
      row = (
        b.modules!.instances[0].content as Extract<
          ModuleContent,
          { type: "TABLE" }
        >
      ).rows[0];
    row.cells[y.id] = 5;
    row.cells[z.id] = 9;
    const cs = diff(a, b),
      selected = cs.find((c) => c.fieldPath.endsWith(y.id))!;
    expect(
      impacts(a, b)
        .filter((i) => i.targetId === chart.moduleInstanceId)
        .map((i) => i.changeIds),
    ).toEqual([[selected.changeId]]);
  });
  it("inherited ownership is an impact of the parent override", () => {
    const a = make(),
      parentNode = armyConfig.doctrine.catalog!.nodes.find(
        (n) => n.stableKey === "H",
      )!,
      childNode = armyConfig.doctrine.catalog!.nodes.find(
        (n) =>
          n.parentStableKey === "H" && n.ownerBehavior === "INHERIT_PARENT",
      )!;
    expect(childNode).toBeDefined();
    const parent = instantiateProduct(a, armyConfig, parentNode.id, uid),
      child = instantiateProduct(a, armyConfig, childNode.id, uid);
    const b = structuredClone(a);
    b.attachments.find((p) => p.id === parent.id)!.metadata.ownerId = "ops";
    expect(diff(a, b)).toHaveLength(1);
    expect(
      impacts(a, b).some(
        (i) => i.kind === "EFFECTIVE_OWNER" && i.targetId === child.id,
      ),
    ).toBe(true);
  });
  it("compares 2000 typed rows without positional noise or binary data", () => {
    const a = make(),
      t = mod(a, "TABLE"),
      f = field();
    t.localDefinition!.configuration.columns = [f];
    t.content = {
      type: "TABLE",
      rows: Array.from({ length: 2000 }, (_, i) => ({
        id: uid(),
        cells: { [f.id]: i },
      })),
    };
    const b = structuredClone(a);
    (
      b.modules!.instances[0].content as Extract<
        ModuleContent,
        { type: "TABLE" }
      >
    ).rows[1500].cells[f.id] = 9000;
    const start = performance.now(),
      c = diff(a, b);
    expect(c).toHaveLength(1);
    expect(performance.now() - start).toBeLessThan(3000);
  });
  it("H-Hour changes canonical time once and affects a linked timeline", () => {
    const a = make(),
      m = mod(a, "TIMELINE"),
      event = a.events.find((e) => !!e.at)!;
    m.content = {
      type: "TIMELINE",
      items: [
        {
          id: uid(),
          title: "Relative",
          description: "",
          phaseId: null,
          timing: {
            mode: "RELATIVE",
            referenceEventId: event.id,
            offsetMinutes: -30,
          },
        },
      ],
    };
    const b = structuredClone(a);
    b.events.find((e) => e.id === event.id)!.at = "2026-10-05T00:00:00.000Z";
    expect(diff(a, b)).toHaveLength(1);
    expect(
      impacts(a, b).some(
        (i) => i.targetId === m.moduleInstanceId && i.chain.length >= 2,
      ),
    ).toBe(true);
  });
  it("linked chart data is an impact and only table cell is a primary change", () => {
    const a = make(),
      table = mod(a, "TABLE"),
      x = field("Day", "SHORT_TEXT"),
      y = field();
    table.localDefinition!.configuration.columns = [x, y];
    table.content = {
      type: "TABLE",
      rows: [{ id: uid(), cells: { [x.id]: "Day one", [y.id]: 4 } }],
    };
    const chart = mod(a, "CHART");
    chart.content = {
      type: "CHART",
      chartType: "BAR",
      source: {
        mode: "TABLE",
        moduleInstanceId: table.moduleInstanceId,
        categoryColumnId: x.id,
        valueColumnIds: [y.id],
      },
    };
    const b = structuredClone(a);
    (b.modules!.instances[0].content as typeof table.content).rows[0].cells[
      y.id
    ] = 8;
    expect(diff(a, b)).toHaveLength(1);
    expect(
      impacts(a, b).find((i) => i.targetId === chart.moduleInstanceId)?.reason,
    ).toContain("Chart binds");
  });
  it("canonical unit rename affects references without creating local edits", () => {
    const a = make(),
      m = mod(a, "CANONICAL_REFERENCES");
    m.content = {
      type: "CANONICAL_REFERENCES",
      references: [{ kind: "unit", id: a.units[0].id }],
    };
    const b = structuredClone(a);
    b.units[0].name = "Updated HQ";
    expect(diff(a, b)).toHaveLength(1);
    expect(impacts(a, b).some((i) => i.targetId === m.moduleInstanceId)).toBe(
      true,
    );
  });
  it.each(["TASK_ORGANIZATION", "SIGNAL_NET_MATRIX", "PACE"])(
    "%s remains a derived module",
    (type) => {
      const a = make(),
        m = mod(a, type),
        b = structuredClone(a);
      if (type === "TASK_ORGANIZATION") b.units[0].name = "New HQ";
      else if (type === "PACE") b.signal.pacePlans[0].primary = "New primary";
      else b.signal.nets[0].channel = "New channel";
      expect(diff(a, b)).toHaveLength(1);
      expect(impacts(a, b).some((i) => i.targetId === m.moduleInstanceId)).toBe(
        true,
      );
    },
  );
  it("Annex A and Annex H are affected dependents of canonical data", () => {
    for (const code of ["A", "H"]) {
      const a = make(),
        n = armyConfig.doctrine.catalog!.nodes.find(
          (n) => n.stableKey === code,
        )!,
        p = instantiateProduct(a, armyConfig, n.id, uid);
      p.applicability = "INCLUDED";
      const b = structuredClone(a);
      if (code === "A") b.units[0].name = "New HQ";
      else b.signal.nets[0].channel = "New channel";
      expect(
        impacts(a, b).some((i) => i.kind === "PRODUCT" && i.targetId === p.id),
      ).toBe(true);
    }
  });
  it("selective exports exclude channel changes when channel was excluded", () => {
    const a = make(),
      b = structuredClone(a);
    b.signal.nets[0].channel = "New channel";
    const included = exportRecord(a),
      excluded = exportRecord(a, armyConfig, ["callsign"]);
    const result = impacts(a, b, armyConfig, [included, excluded]);
    expect(
      result.filter((i) => i.kind === "EXPORT").map((i) => i.targetId),
    ).toEqual([included.id]);
    expect(result.find((i) => i.targetId === included.id)).toMatchObject({
      baselineOutdated: false,
      targetOutdated: true,
    });
  });
  it("selective exports distinguish already-outdated baseline", () => {
    const a = make(),
      record = exportRecord(a);
    a.signal.nets[0].channel = "Prior change";
    const b = structuredClone(a);
    b.signal.nets[0].channel = "Additional change";
    expect(
      impacts(a, b, armyConfig, [record]).find((i) => i.targetId === record.id),
    ).toMatchObject({ baselineOutdated: true, targetOutdated: true });
  });
  it("unrelated later revision alone never affects an export", () => {
    const a = make(),
      b = structuredClone(a);
    b.revision++;
    b.sections[0].summary = "Unrelated order text";
    expect(
      impacts(a, b, armyConfig, [exportRecord(a)]).filter(
        (i) => i.kind === "EXPORT",
      ),
    ).toEqual([]);
  });
  it("export field attribution excludes a simultaneous unselected field", () => {
    const a = make(),
      b = structuredClone(a);
    b.signal.nets[0].channel = "Channel";
    b.signal.nets[0].callsign = "Call sign";
    const cs = diff(a, b),
      result = impacts(a, b, armyConfig, [exportRecord(a)]).find(
        (i) => i.kind === "EXPORT",
      )!;
    expect(result.changeIds).toEqual([
      cs.find((c) => c.fieldPath.endsWith("/channel"))!.changeId,
    ]);
  });
});
