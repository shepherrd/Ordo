import { it, expect } from "vitest";
import { randomUUID as id } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
import {
  readNarrative,
  writeNarrative,
  narrativePlainText,
  validateNarratives,
} from "../src/domain/narrative";
import { expandNarratives } from "../src/export/narrative-html";
import { exportStaleness } from "../src/export/projection";
import type { RichNode } from "../src/domain/modules";
import { NarrativeReviewService as ReviewService } from "../src/application/narrative-review-service";
import { endpointSelector } from "../src/persistence/review-store";
import { renderReviewReport } from "../src/export/narrative-review-report";
const rich: RichNode = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Fictional relief <script>alert(1)</script> — café",
          marks: [{ type: "bold" }],
        },
      ],
    },
  ],
};
it("keeps existing plain text unchanged and round-trips formatted Unicode", () => {
  expect(writeNarrative(readNarrative("One\n\nTwo"))).toBe("One\n\nTwo");
  expect(writeNarrative(readNarrative(""))).toBe("");
  expect(readNarrative(writeNarrative(rich))).toEqual(rich);
  expect(narrativePlainText(writeNarrative(rich))).toContain("café");
});
it("validates rich documents and expands only generated HTML text nodes", () => {
  const encoded = writeNarrative(rich),
    html = expandNarratives(
      `<div title="${encoded}">${encoded}</div><svg><text>${encoded}</text></svg>`,
    );
  expect(html).toContain(`<div title="${encoded}">`);
  expect(html).toContain("<strong>Fictional relief &lt;script&gt;");
  expect(html).toContain(`<svg><text>${encoded}</text></svg>`);
  expect(html).not.toContain("<script>alert");
  expect(() =>
    validateNarratives({ text: "[[ORDO_RICH_TEXT_V1:invalid]]" }),
  ).toThrow();
  expect(() =>
    writeNarrative({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "bad",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    }),
  ).toThrow();
  expect(expandNarratives(`<p class="body">${encoded}</p>`)).toContain(
    '<div class="body"><div><p><strong>',
  );
  expect(
    writeNarrative({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: " ", marks: [{ type: "bold" }] }],
        },
      ],
    }).trim(),
  ).toBe("");
});
it("retains formatted exports with exact dependencies, saves again and verifies historical integrity", async () => {
  const repo = new SqliteRepository(":memory:");
  try {
    repo.seedConfig(starterConfig);
    repo.seedConfig(armyConfig);
    const rt = {
      id,
      now: () => "2026-10-08T23:00:00.000Z",
      actor: "Narrative test",
    };
    const service = new OrdoService(repo, rt, (_n, c) =>
      demoOperation(c, id, rt.now()),
    );
    let state = service.execute({
      type: "create",
      name: "Narrative example",
      demo: false,
    });
    const original = repo.getOperation(state.operation!.id);
    const op = structuredClone(original);
    op.sections[0].summary = writeNarrative(rich);
    state = service.execute({
      type: "save",
      operation: op,
      expectedRevision: original.revision,
    });
    const profile = state.profiles.find((p) => p.product === "opord")!;
    state = await service.executeWithGraphics(
      {
        type: "generate",
        operationId: op.id,
        expectedRevision: state.operation!.revision,
        profileRef: { id: profile.id, version: profile.version },
        publicationId: null,
      },
      {
        render: async () => {
          throw Error("Unexpected graphical request");
        },
      },
    );
    const record = state.exports[0];
    expect(record.schemaVersion).toBe(4);
    expect(record.rendererVersion).toBe("html-v4");
    expect(record.html).toContain("<strong>Fictional relief");
    expect(record.html).not.toContain("[[ORDO_RICH_TEXT");
    expect(exportStaleness(record, state.operation!).outdated).toBe(false);
    const next = structuredClone(state.operation!);
    next.sections[0].summary = "Updated relief narrative";
    expect(exportStaleness(record, next).outdated).toBe(true);
    expect(repo.getOperation(op.id, 1)).toEqual(original);
    repo.verifyAll();
    const reviews = new ReviewService(repo, rt);
    const history = repo.revisionHistory(op.id);
    const review = reviews.execute({
      type: "create-review",
      baseline: endpointSelector(history.at(-1)!.endpoint),
      target: endpointSelector(history[0].endpoint),
      engineVersion: "diff-engine-v3",
      title: "Narrative review",
      description: writeNarrative(rich),
      formattedText: true,
      expectedRevision: state.operation!.revision,
      parentReviewId: null,
      supersedesReviewId: null,
    }).review!;
    const report = renderReviewReport(review);
    expect(report).toContain("review-html-v4");
    expect(report).toContain("<strong>Fictional relief");
    expect(report).not.toContain("[[ORDO_RICH_TEXT");
    expect(
      review.comparison.changes.some((c) =>
        c.afterDisplay.includes("[[ORDO_RICH_TEXT"),
      ),
    ).toBe(true);
    repo.verifyAll();
  } finally {
    repo.close();
  }
});
