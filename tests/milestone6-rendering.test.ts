import { visualTestOutput } from "./visual-test-output";
import { describe, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { newSymbolDefinition } from "../src/domain/symbology";
import { renderSymbol } from "../src/rendering/symbol-renderer";
import { assertGeneratedSvg } from "../src/rendering/svg-safety";
import {
  layoutOrbatV1,
  type LayoutNode,
} from "../src/rendering/orbat-layout/v1";
import { newOrbatLayout } from "../src/domain/orbat";
import { symbolDictionaryDatasetSchema as fmDictionarySchema } from "../src/domain/symbol-dictionary";
import dictionary from "../src/rendering/resources/fm-dictionary-v1.json";
import { flagResources as flags } from "../src/rendering/flag-resources";
import metrics from "../src/rendering/resources/arial-metrics-v1.json";
import { textWidth, splitDesignation } from "../src/rendering/text-metrics";
import layoutFixtures from "./fixtures/milestone6-diagram-layout.json";
import { orbatLayoutSchema } from "../src/domain/orbat";
const req = () => ({
  definition: newSymbolDefinition(randomUUID),
  size: 50,
  context: "SYMBOL" as const,
  labelSide: "RIGHT" as const,
});
describe("M6 deterministic rendering and source fidelity", () => {
  it("matches captured reference smart/simple measured layout fixtures", () => {
    const outputs = [];
    for (const f of layoutFixtures.fixtures) {
      const r = layoutOrbatV1(f.nodes, orbatLayoutSchema.parse(f.settings));
      outputs.push({ id: f.id, ...r });
      expect(r.slot, f.id).toEqual(f.expected.slot);
      expect(
        [...r.nodes].sort((a, b) => a.id.localeCompare(b.id)),
        f.id + " all visible nodes",
      ).toEqual(
        [...f.expected.visible].sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(
        [...r.connectors].sort((a, b) => a.to.localeCompare(b.to)),
        f.id + " connectors",
      ).toEqual(
        [...f.expected.connectors].sort((a, b) => a.to.localeCompare(b.to)),
      );
      // Deliberate viewport correction: retain all measured glyph bounds, including
      // synthetic fold cards. reference's source bounds traverse only canonical nodes.
      for (const n of r.nodes) {
        expect(n.box.left, f.id).toBeGreaterThanOrEqual(r.bounds.x);
        expect(n.box.top, f.id).toBeGreaterThanOrEqual(r.bounds.y);
        expect(n.box.right, f.id).toBeLessThanOrEqual(
          r.bounds.x + r.bounds.width,
        );
        expect(n.box.bottom, f.id).toBeLessThanOrEqual(
          r.bounds.y + r.bounds.height,
        );
      }
      expect(
        r.nodes
          .filter((n) => !n.synthetic)
          .map(({ id, x, y, labelSide }) => ({ id, x, y, labelSide }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        f.id,
      ).toEqual(
        [...f.expected.positions].sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
    mkdirSync(visualTestOutput, { recursive: true });
    writeFileSync(
      `${visualTestOutput}/ordo-layout-results.json`,
      JSON.stringify(outputs),
    );
  });
  it("rejects invalid measured fold geometry before layout", () => {
    const g = {
      size: { width: 10, height: 10 },
      anchor: { x: 5, y: 5 },
      octagon: { x: 5, y: 5 },
    };
    expect(() =>
      layoutOrbatV1(
        [
          {
            id: randomUUID(),
            parentId: null,
            geometry: g,
            hq: false,
            planned: false,
          },
        ],
        newOrbatLayout(randomUUID),
        { ...g, size: { width: NaN, height: 10 } },
      ),
    ).toThrow(/geometry/);
  });
  it("validates all supplied dictionary rows while retaining unavailable and discrepant mappings", () => {
    const d = fmDictionarySchema.parse(dictionary);
    expect(d.entries).toHaveLength(453);
    expect(
      d.entries.filter((e) => e.availability === "UNAVAILABLE"),
    ).toHaveLength(23);
    expect(
      d.entries
        .filter((e) => e.availability === "DISCREPANT")
        .map((e) => e.term),
    ).toEqual(["fixed wing", "communications satellite"]);
    expect(
      d.entries.filter((e) => e.availability === "SUBSTITUTION"),
    ).toHaveLength(2);
  });
  it("renders every available source mapping with unchanged upstream 3.0.4", () => {
    for (const e of dictionary.entries.filter((e) => e.sidc)) {
      const r = req();
      r.definition.code.sidc = e.sidc!;
      const result = renderSymbol(r);
      expect(result.geometry.size.width, e.term).toBeGreaterThan(0);
      expect(result.manifest.upstream.version).toBe("3.0.4");
    }
  });
  it("replays exact SVG, manifest, geometry and byte hash without mutating input", () => {
    const r = req(),
      before = JSON.stringify(r),
      a = renderSymbol(r),
      b = renderSymbol(r);
    expect(a).toEqual(b);
    expect(JSON.stringify(r)).toBe(before);
    expect(a.svgHash).toBe(createHash("sha256").update(a.svg).digest("hex"));
    expect(a.manifest.textMetrics.id).toBe(metrics.id);
  });
  it("adds stars, reinforcement, signature and headquarters as bounded typed extensions", () => {
    const r = req();
    Object.assign(r.definition.compatibility, {
      generalStars: 5,
      reinforced: "±",
      signature: "!",
      specialHeadquarters: "STAFF",
    });
    const a = renderSymbol(r);
    expect(a.svg).toContain("STAFF");
    expect(a.svg).toContain("yellow");
    expect(a.svg).toContain(">!</text>");
    expect(a.geometry.size.height).toBeGreaterThan(
      renderSymbol(req()).geometry.size.height,
    );
  });
  it("renders and namespaces every licensed flag without external or active SVG", () => {
    for (const id of Object.keys(flags)) {
      const r = req();
      r.definition.compatibility.flagId = id;
      expect(() => assertGeneratedSvg(renderSymbol(r).svg), id).not.toThrow();
    }
  });
  it("clips a full flag to a supported frame and reports the nonfriend small-flag fallback", () => {
    const r = req();
    r.definition.compatibility.flagId = "US";
    r.definition.compatibility.flagMode = "FULL_FRAME";
    expect(renderSymbol(r).svg).toContain("clipPath");
    r.definition.code.sidc = "130610000012110000000000000000";
    expect(renderSymbol(r).diagnostics.join(" ")).toContain(
      "small-flag fallback",
    );
  });
  it("escapes narrative text and rejects active or external SVG at the generated-output boundary", () => {
    const r = req();
    r.definition.amplifiers.uniqueDesignation =
      '<script>alert("&")</script> \\ path';
    expect(renderSymbol(r).svg).toContain("&lt;script&gt;");
    for (const body of [
      "<script/>",
      '<image href="https://example.com/a"/>',
      '<path onclick="x"/>',
      '<path fill="url(https://example.com/a)"/>',
      '<path style="fill:red"/>',
    ])
      expect(() =>
        assertGeneratedSvg(
          `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
        ),
      ).toThrow();
  });
  it("rejects unavailable profiles, unknown resources and malformed codes without guessing", () => {
    const r = req();
    r.definition.renderProfile.version = 999;
    expect(() => renderSymbol(r)).toThrow(/profile/);
    r.definition.renderProfile.version = 1;
    r.definition.compatibility.flagId = "MISSING";
    expect(() => renderSymbol(r)).toThrow(/unavailable/);
    r.definition.compatibility.flagId = null;
    r.definition.code.sidc = "nonsense";
    expect(() => renderSymbol(r)).toThrow();
  });
  it("uses fixed metrics for both label sides, wrapping and explicit non-Latin fallback", () => {
    const r = req();
    r.definition.amplifiers.uniqueDesignation = "Example Long Unit Designation";
    r.definition.amplifiers.additionalInformation = "Second line";
    const a = renderSymbol({ ...r, context: "ORBAT_NODE" }),
      b = renderSymbol({ ...r, context: "ORBAT_NODE", labelSide: "LEFT" });
    expect(a.svg).toContain('text-anchor="start"');
    expect(b.svg).toContain('text-anchor="end"');
    expect(b.geometry.octagon.x).toBeGreaterThan(a.geometry.octagon.x);
    expect(
      splitDesignation(r.definition.amplifiers.uniqueDesignation)[1],
    ).not.toBe("");
    expect(textWidth("字", 40)).toBe(40);
    expect(textWidth("", 40, 20)).toBe(0);
  });
  it("retains legacy codes and records their distinct convention", () => {
    const r = req();
    r.definition.code = {
      dialect: "LETTER",
      sidc: "SFGPUCI-----",
      assertedStandard: "MIL_STD_2525C",
      sourceConvention: "LETTER_CODE",
    };
    expect(renderSymbol(r).diagnostics.join(" ")).toContain(
      "Legacy letter code retained",
    );
  });
  it("keeps layout deterministic and presentation-only with folding and independent manual offsets", () => {
    const geometry = renderSymbol(req()).geometry,
      root = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    const nodes: LayoutNode[] = [
      { id: root, parentId: null, geometry, hq: false, planned: false },
      { id: a, parentId: root, geometry, hq: false, planned: true },
      { id: b, parentId: a, geometry, hq: false, planned: false },
    ];
    const settings = newOrbatLayout(randomUUID),
      before = JSON.stringify(nodes);
    const auto = layoutOrbatV1(nodes, settings);
    expect(layoutOrbatV1(nodes, settings)).toEqual(auto);
    expect(JSON.stringify(nodes)).toBe(before);
    settings.hints = [
      { nodeId: a, folded: true, hqStaff: false, offset: { x: 20, y: -5 } },
    ];
    const folded = layoutOrbatV1(nodes, settings);
    expect(folded.nodes.some((n) => n.id === b)).toBe(false);
    expect(folded.nodes.some((n) => n.synthetic === "FOLD")).toBe(true);
    expect(nodes).toHaveLength(3);
    expect(folded.connectors.some((c) => c.dashed)).toBe(true);
  });
});
