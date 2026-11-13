import { expect, it } from "vitest";
import { randomUUID as id } from "node:crypto";
import ExcelJS from "exceljs";
import { starterConfig } from "../src/config/profiles";
import { createOperation } from "../src/domain/factories";
import { metadata } from "../src/domain/model";
import {
  previewTableImport,
  suggestImportMapping,
  type ImportKind,
} from "../src/domain/table-import";
import {
  readImportFile,
  parseDelimited,
  checkWorkbookArchive,
} from "../src/main/office-import";
import { resolveSchedule } from "../src/domain/planning-schedule";

const base = () =>
  createOperation(
    "Fictional import",
    starterConfig,
    id,
    "2026-10-19T12:00:00Z",
  );
function preview(kind: ImportKind, rows: string[][], op = base(), extra = {}) {
  return previewTableImport(
    op,
    starterConfig,
    {
      kind,
      table: { name: "Test", rows, warnings: [] },
      mapping: suggestImportMapping(kind, rows[0]),
      filename: "fixture.csv",
      sha256: "a".repeat(64),
      skipRows: [],
      clearBlankCells: false,
      ...extra,
    },
    () => id(),
  );
}
it.each(["units", "tasks", "objectives", "phases", "events"] as const)(
  "creates %s records without mutating the source",
  (kind) => {
    const op = base(),
      before = structuredClone(op),
      result = preview(kind, [["Name"], ["First"], ["Second"]], op);
    expect(result.errors).toEqual([]);
    expect(result.operation?.[kind]).toHaveLength(2);
    expect(result.created).toBe(2);
    expect(op).toEqual(before);
    expect(result.operation![kind][0].metadata.source).toMatchObject({
      type: "import",
      note: expect.stringContaining("fixture.csv"),
    });
  },
);
it("creates matching names independently and updates only an explicit matching Ordo ID", () => {
  const op = preview("objectives", [
    ["Name", "Description"],
    ["Same", "Keep"],
  ]).operation!;
  const next = preview(
    "objectives",
    [
      ["Name", "Description", "Ordo ID"],
      ["Same", "New", ""],
      ["Renamed", "", op.objectives[0].id],
    ],
    op,
  );
  expect(next.created).toBe(1);
  expect(next.updated).toBe(1);
  expect(next.operation!.objectives.map((o) => o.description)).toEqual([
    "Keep",
    "New",
  ]);
  expect(
    preview(
      "objectives",
      [
        ["Name", "Ordo ID"],
        ["Same", id()],
      ],
      op,
    ).operation,
  ).toBeNull();
  const clear = preview(
    "objectives",
    [
      ["Name", "Description", "Ordo ID"],
      ["Same", "", op.objectives[0].id],
    ],
    op,
    { clearBlankCells: true },
  );
  expect(clear.operation!.objectives[0].description).toBe("");
});
it("preserves unmapped fields, unchanged records, metadata and unit symbols", () => {
  const op = preview("units", [["Name"], ["Alpha"]]).operation!;
  op.units[0].metadata.source.note = "Preserved";
  const result = preview(
    "units",
    [
      ["Name", "Ordo ID"],
      ["Alpha", op.units[0].id],
    ],
    op,
  );
  expect(result.rows[0].action).toBe("unchanged");
  expect(result.operation).toEqual(op);
});
it("resolves row keys, unique names and existing IDs without guessing ambiguous names", () => {
  const result = preview("units", [
    ["Name", "Row key", "Parent unit"],
    ["HQ", "hq", ""],
    ["Sub", "sub", "@hq"],
  ]);
  const op = result.operation!;
  expect(op.units[1].parentUnitId).toBe(op.units[0].id);
  op.objectives.push({
    id: id(),
    name: "Goal",
    description: "",
    metadata: metadata(starterConfig.doctrine.editingStatus),
  });
  const tasks = preview(
    "tasks",
    [
      ["Name", "Assigned unit", "Objective"],
      ["Task", "Sub", op.objectives[0].id],
    ],
    op,
  );
  expect(tasks.operation!.tasks[0]).toMatchObject({
    unitId: op.units[1].id,
    objectiveId: op.objectives[0].id,
  });
  op.units.push({ ...op.units[1], id: id() });
  expect(
    preview(
      "tasks",
      [
        ["Name", "Assigned unit"],
        ["Task", "Sub"],
      ],
      op,
    ).rows[0].errors.join(),
  ).toMatch(/More than one/);
});
it("rejects duplicate IDs, duplicate keys, missing references and cycles atomically", () => {
  const op = preview("units", [["Name"], ["HQ"]]).operation!;
  expect(
    preview(
      "units",
      [
        ["Name", "Ordo ID"],
        ["A", op.units[0].id],
        ["B", op.units[0].id],
      ],
      op,
    ).errors.join(),
  ).toMatch(/duplicate Ordo ID/);
  expect(
    preview("units", [
      ["Name", "Row key"],
      ["A", "a"],
      ["B", "a"],
    ]).errors.join(),
  ).toMatch(/duplicate row key/);
  expect(
    preview("units", [
      ["Name", "Parent unit"],
      ["A", "Missing"],
    ]).operation,
  ).toBeNull();
  const cycle = preview("units", [
    ["Name", "Row key", "Parent unit"],
    ["A", "a", "@b"],
    ["B", "b", "@a"],
  ]);
  expect(cycle.operation).toBeNull();
  expect(cycle.errors.join()).toMatch(/cycle/i);
});
it("keeps invalid rows reviewable and allows explicit exclusion", () => {
  const rows = [
    ["Name", "Parent unit"],
    ["Valid", ""],
    ["Invalid", "Missing"],
  ];
  expect(preview("units", rows).operation).toBeNull();
  const result = preview("units", rows, base(), { skipRows: [3] });
  expect(result.operation!.units).toHaveLength(1);
  expect(result.rows[1].action).toBe("skip");
});
it.each([
  "2026-02-30T12:00:00Z",
  "2026-10-19T12:00:00",
  "2026-10-19T25:00:00Z",
  "not a date",
])("rejects invalid or timezone-less date %s", (value) => {
  expect(
    preview("events", [
      ["Name", "Start time"],
      ["Event", value],
    ]).operation,
  ).toBeNull();
});
it("imports duration, explicit timezone and automatic finish-relative scheduling", () => {
  const result = preview("events", [
    [
      "Name",
      "Row key",
      "Start time",
      "Follow event",
      "Duration in minutes",
      "Offset in minutes",
      "Follow start or finish",
    ],
    ["Start", "start", "2026-10-19T14:00:00-07:00", "", "60", "0", "start"],
    ["Follow", "follow", "", "@start", "30", "15", "finish"],
  ]);
  expect(result.errors).toEqual([]);
  const op = result.operation!,
    times = resolveSchedule(op);
  expect(op.events[0].at).toBe("2026-10-19T21:00:00.000Z");
  expect(new Date(times.get(op.events[1].id)!.start!).toISOString()).toBe(
    "2026-10-19T22:15:00.000Z",
  );
});
it("rejects invalid numeric, boolean, staff and mapped-column values", () => {
  expect(
    preview("phases", [
      ["Name", "Sequence"],
      ["P", "1.2"],
    ]).operation,
  ).toBeNull();
  expect(
    preview("units", [
      ["Name", "Include in task organization"],
      ["U", "maybe"],
    ]).operation,
  ).toBeNull();
  expect(
    preview("units", [
      ["Name", "Responsible staff"],
      ["U", "Missing"],
    ]).operation,
  ).toBeNull();
  expect(
    preview("units", [["Name"], ["U"]], base(), {
      mapping: { name: 0, parentUnitId: 0 },
    }).operation,
  ).toBeNull();
  expect(
    preview("units", [["Name"], ["U"]], base(), { mapping: { metadata: 0 } })
      .operation,
  ).toBeNull();
});
it("reads quoted UTF-8 CSV and TSV literally without executing formulas or markup", async () => {
  const file = await readImportFile(
    "test.csv",
    Buffer.from(
      '\uFEFFName,Description\r\n"A, B","line 1\nline ""2"""\r\n=CMD(),<script>literal</script>',
    ),
  );
  expect(file.tables[0].rows).toEqual([
    ["Name", "Description"],
    ["A, B", 'line 1\nline "2"'],
    ["=CMD()", "<script>literal</script>"],
  ]);
  expect(
    (
      await readImportFile(
        "test.tsv",
        Buffer.from("Name\tDescription\nÜnit\tText"),
      )
    ).tables[0].rows[1],
  ).toEqual(["Ünit", "Text"]);
  expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
});
it("rejects malformed, oversized, non-UTF8 and unsupported inputs", async () => {
  expect(() => parseDelimited('"unfinished', ",")).toThrow(/not closed/);
  expect(() => parseDelimited('"ok"bad', ",")).toThrow(/Unexpected/);
  expect(() => parseDelimited("x,".repeat(65), ",")).toThrow(/64/);
  expect(() => parseDelimited("x".repeat(40001), ",")).toThrow(/40,000/);
  expect(() => parseDelimited("x\n".repeat(1002), ",")).toThrow(/1,000/);
  await expect(readImportFile("x.csv", Buffer.from([0xff]))).rejects.toThrow(
    /UTF-8/,
  );
  await expect(readImportFile("x.xls", Buffer.from("x"))).rejects.toThrow(
    /XLSX/,
  );
  await expect(
    readImportFile("x.csv", Buffer.alloc(10 * 1024 * 1024 + 1)),
  ).rejects.toThrow(/10 MiB/);
  await expect(checkWorkbookArchive(Buffer.from("invalid"))).rejects.toThrow();
});
async function workbook(setup: (sheet: ExcelJS.Worksheet) => void) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Records");
  setup(sheet);
  return Buffer.from(await book.xlsx.writeBuffer());
}
it("reads real XLSX dates, rich text and hyperlink display text without following links", async () => {
  const file = await readImportFile(
    "test.xlsx",
    await workbook((s) => {
      s.addRow(["Name", "Start time"]);
      s.addRow([
        { richText: [{ text: "Alpha" }, { text: " unit" }] },
        new Date("2026-10-19T12:00:00Z"),
      ]);
      s.addRow([
        { text: "Link label", hyperlink: "https://example.invalid/" },
        null,
      ]);
      s.state = "hidden";
    }),
  );
  expect(file.tables[0].rows[1]).toEqual([
    "Alpha unit",
    "2026-10-19T12:00:00.000Z",
  ]);
  expect(file.tables[0].rows[2][0]).toBe("Link label");
  expect(file.tables[0].warnings).toHaveLength(1);
});
it.each(["formula", "merged", "error", "large"])(
  "rejects XLSX %s cells before producing an import",
  async (kind) => {
    const bytes = await workbook((s) => {
      s.addRow(["Name"]);
      if (kind === "formula")
        s.getCell("A2").value = { formula: "1+1", result: 2 };
      if (kind === "merged") s.mergeCells("A2:B2");
      if (kind === "error") s.getCell("A2").value = { error: "#VALUE!" };
      if (kind === "large") s.getCell("A1002").value = "Too far";
    });
    await expect(readImportFile("test.xlsx", bytes)).rejects.toThrow();
  },
);
