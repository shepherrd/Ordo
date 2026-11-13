import { expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import { armyConfig, starterConfig } from "../src/config/profiles";
import { createOperation } from "../src/domain/factories";
import { metadata } from "../src/domain/model";
import { narrativePrefix, writeNarrative } from "../src/domain/narrative";
import { orderProgress } from "../src/renderer/src/order-progress";

const fresh = (config = armyConfig) =>
  createOperation(
    "Fictional progress check",
    config,
    id,
    "2026-10-09T12:00:00.000Z",
  );
const definitions = armyConfig.doctrine.catalog!.baseFields;

it("counts all five structured paragraphs even when legacy summaries are empty", () => {
  const op = fresh();
  expect(orderProgress(op, armyConfig)).toEqual({ started: 0, total: 5 });
  for (const paragraph of armyConfig.doctrine.paragraphs) {
    const field = definitions.find(
      (f) => f.paragraphId === paragraph.id && f.contentKind === "narrative",
    )!;
    op.authoring!.fields.push({
      fieldId: field.id,
      text: "Fictional content",
      references: [],
    });
  }
  expect(op.sections.every((s) => s.summary === "")).toBe(true);
  const before = JSON.stringify(op);
  expect(orderProgress(op, armyConfig)).toEqual({ started: 5, total: 5 });
  expect(JSON.stringify(op)).toBe(before);
  op.authoring!.fields.pop();
  expect(orderProgress(op, armyConfig).started).toBe(4);
});

it("preserves legacy counts and counts a mixed paragraph only once", () => {
  const legacy = fresh(starterConfig);
  legacy.sections[0].summary = "Existing situation";
  expect(orderProgress(legacy, starterConfig)).toEqual({
    started: 1,
    total: 5,
  });
  const op = fresh();
  const field = definitions.find((f) => f.contentKind === "narrative")!;
  op.sections.find((s) => s.id === field.paragraphId)!.summary =
    "Existing content";
  op.authoring!.fields.push({
    fieldId: field.id,
    text: "Additional content",
    references: [],
  });
  expect(orderProgress(op, armyConfig).started).toBe(1);
});

it("uses visible rich text and ignores whitespace and empty formatting", () => {
  const op = fresh();
  const field = {
    fieldId: definitions.find((f) => f.contentKind === "narrative")!.id,
    text: " \n\t",
    references: [],
  };
  op.authoring!.fields.push(field);
  expect(orderProgress(op, armyConfig).started).toBe(0);
  field.text =
    narrativePrefix +
    Buffer.from(
      JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [] }],
      }),
    ).toString("base64url") +
    "]]";
  expect(orderProgress(op, armyConfig).started).toBe(0);
  field.text = writeNarrative({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Fictional formatted content",
            marks: [{ type: "bold" }],
          },
        ],
      },
    ],
  });
  expect(orderProgress(op, armyConfig).started).toBe(1);
});

it("counts end-state values but not an empty entry's default label", () => {
  const op = fresh();
  const entry = {
    id: id(),
    label: "Desired condition",
    value: "",
    references: [],
  };
  op.authoring!.fields.push({
    fieldId: definitions.find((f) => f.contentKind === "structured-fields")!.id,
    text: "",
    references: [],
    entries: [entry],
  });
  expect(orderProgress(op, armyConfig).started).toBe(0);
  entry.value = "All fictional reception centres supplied.";
  expect(orderProgress(op, armyConfig).started).toBe(1);
});

it("counts canonical task content in its configured paragraph", () => {
  const op = fresh();
  op.tasks.push({
    id: id(),
    name: "Deliver fictional supplies",
    purpose: "Support the exercise",
    metadata: metadata(armyConfig.doctrine.editingStatus),
    unitId: null,
    objectiveId: null,
    phaseId: null,
  });
  expect(orderProgress(op, armyConfig).started).toBe(1);
  const config = structuredClone(armyConfig);
  config.doctrine.catalog!.baseFields = definitions.filter(
    (f) => f.contentKind !== "canonical-tasks",
  );
  expect(orderProgress(op, config).started).toBe(0);
  op.authoring!.fields.push({
    fieldId: definitions.find((f) => f.contentKind === "task-collection")!.id,
    text: "",
    references: [{ kind: "task", id: op.tasks[0].id }],
  });
  expect(orderProgress(op, config).started).toBe(1);
  op.tasks = [];
  expect(orderProgress(op, config).started).toBe(0);
});

it("counts valid selected references, ignoring dangling references and unknown fields", () => {
  const op = fresh();
  const definition = definitions.find(
    (f) => f.contentKind === "narrative" && f.bindings.includes("unit"),
  )!;
  const unit = {
    id: id(),
    name: "Fictional reception team",
    metadata: metadata(armyConfig.doctrine.editingStatus),
    parentUnitId: null,
    inTaskOrganization: true,
  };
  op.authoring!.fields.push(
    {
      fieldId: definition.id,
      text: "",
      references: [{ kind: "unit", id: unit.id }],
    },
    { fieldId: id(), text: "Unmapped content", references: [] },
  );
  expect(orderProgress(op, armyConfig).started).toBe(0);
  op.units.push(unit);
  expect(orderProgress(op, armyConfig).started).toBe(1);
});

it("does not count unrelated Signal content or paragraph headings as writing", () => {
  const op = fresh();
  op.signal.concept = "Fictional annex content";
  op.authoring!.fields.push({
    fieldId: definitions.find((f) => f.contentKind === "group")!.id,
    text: "",
    references: [],
  });
  expect(orderProgress(op, armyConfig)).toEqual({ started: 0, total: 5 });
});

it("uses configured paragraph identities rather than hard-coded labels or a fixed denominator", () => {
  const config = structuredClone(armyConfig);
  config.doctrine.paragraphs = [config.doctrine.paragraphs[0]];
  config.doctrine.paragraphs[0].title = "Custom situation title";
  const op = fresh(config);
  op.authoring!.fields.push({
    fieldId: definitions.find(
      (f) =>
        f.paragraphId === config.doctrine.paragraphs[0].id &&
        f.contentKind === "narrative",
    )!.id,
    text: "Fictional content",
    references: [],
  });
  expect(orderProgress(op, config)).toEqual({ started: 1, total: 1 });
});
