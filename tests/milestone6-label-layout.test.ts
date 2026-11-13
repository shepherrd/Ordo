import { it, expect } from "vitest";
import { newSymbolDefinition } from "../src/domain/symbology";
import { renderSymbol } from "../src/rendering/symbol-renderer";
import { renderOrbat } from "../src/rendering/orbat-renderer";
import { diagramRequestSchema } from "../src/domain/diagram";
import fixtures from "./fixtures/milestone6-composition-inputs.json";
import { createHash } from "node:crypto";
import { verifyDiagramManifests } from "../src/application/order-graphics";

const request = () => ({
  definition: newSymbolDefinition(() => "96000000-0000-4000-8000-000000000001"),
  size: 100,
  context: "ORBAT_NODE" as const,
  labelSide: "RIGHT" as "RIGHT" | "LEFT",
});
const textX = (svg: string, text: string) => {
  const tag = [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].find(
    (m) => m[2] === text,
  );
  if (!tag) throw Error("Missing text " + text);
  return Number(tag[1].match(/\bx="([^"]+)"/)![1]);
};

it("retains each ordinary unit's explicit profile in mixed whole compositions", () => {
  for (const fixture of fixtures.cases) {
    const input = diagramRequestSchema.parse(fixture.input);
    input.nodes.forEach((node, i) => {
      if (node.symbol) node.symbol.renderProfile.version = i % 2 === 0 ? 2 : 1;
    });
    const source = structuredClone(input);
    const result = renderOrbat(input);
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(() =>
      verifyDiagramManifests(input, result.renderManifests, hash),
    ).not.toThrow();
    expect(
      new Set(result.renderManifests.map((m) => m.renderProfile.version)),
    ).toEqual(new Set([1, 2]));
    expect(input).toEqual(source);
    const tampered = structuredClone(result.renderManifests);
    tampered.find((m) => m.renderProfile.version === 2)!.renderProfile.version =
      1;
    expect(() => verifyDiagramManifests(input, tampered, hash)).toThrow(
      /consumed render input/,
    );
    expect(renderOrbat(diagramRequestSchema.parse(fixture.input)).svgHash).toBe(
      fixture.profile1SvgHash,
    );
  }
});

it("retains all six reviewed profile-1 compositions byte-for-byte before and after profile-2 rendering", () => {
  for (const fixture of fixtures.cases) {
    const input = diagramRequestSchema.parse(fixture.input);
    const before = renderOrbat(input);
    expect(before.svgHash, fixture.id).toBe(fixture.profile1SvgHash);
    const next = structuredClone(input);
    for (const node of next.nodes)
      if (node.symbol) node.symbol.renderProfile.version = 2;
    const separated = renderOrbat(next);
    expect(separated.layout.algorithm).toBe("ordo-layout-v1");
    expect(separated.layout.nodes.map((n) => [n.id, n.synthetic])).toEqual(
      before.layout.nodes.map((n) => [n.id, n.synthetic]),
    );
    expect(renderOrbat(input)).toEqual(before);
  }
});

it("reserves an aligned right text column beyond small flags and signature marks without moving the marks", () => {
  for (const signature of ["", "!"] as const) {
    const r = request();
    r.definition.amplifiers = {
      uniqueDesignation: "FICTIONAL / LABEL",
      additionalInformation: "Annotation",
    };
    Object.assign(r.definition.compatibility, {
      flagId: "NATO",
      stack: 2,
      signature,
    });
    const original = renderSymbol(r);
    r.definition.renderProfile.version = 2;
    const result = renderSymbol(r);
    const flag = result.svg.match(/<svg x="([^"]+)" y="140" width="57.6"/);
    expect(flag).not.toBeNull();
    const column = textX(result.svg, "Annotation");
    expect(column).toBeGreaterThanOrEqual(Number(flag![1]) + 57.6 + 12);
    expect(textX(result.svg, "FICTIONAL")).toBe(column);
    expect(textX(result.svg, "/ LABEL")).toBe(column);
    expect(
      original.svg.match(/<svg x="([^"]+)" y="140" width="57.6"/)?.[1],
    ).toBe(flag![1]);
    if (signature)
      expect(textX(result.svg, "!")).toBe(textX(original.svg, "!"));
    expect(result.manifest.renderProfile.version).toBe(2);
    expect(result.manifest.compatibilityLayer).toBe(
      "ordo-symbol-layout-v1+orbat-labels-v2",
    );
  }
});

it("preserves left-side placement and uses the small-flag fallback for nonfriendly full-frame requests", () => {
  const r = request();
  r.definition.amplifiers.uniqueDesignation = "FICTIONAL";
  r.definition.compatibility.flagId = "US";
  r.definition.compatibility.flagMode = "FULL_FRAME";
  r.definition.renderProfile.version = 2;
  const friendly = renderSymbol(r);
  r.definition.code.sidc = "130610000012110000000000000000";
  const hostile = renderSymbol(r);
  expect(hostile.diagnostics.join(" ")).toContain("small-flag fallback");
  expect(textX(hostile.svg, "FICTIONAL")).toBeGreaterThan(
    textX(friendly.svg, "FICTIONAL"),
  );
  r.labelSide = "LEFT";
  const separated = renderSymbol(r);
  r.definition.renderProfile.version = 1;
  const original = renderSymbol(r);
  expect(textX(separated.svg, "FICTIONAL")).toBe(
    textX(original.svg, "FICTIONAL"),
  );
});

it("verifies mixed exact profiles without allowing inconsistent resources or per-profile adapters", () => {
  const input = diagramRequestSchema.parse(fixtures.cases[0].input);
  for (const n of input.nodes) if (n.symbol) n.symbol.renderProfile.version = 2;
  const rendered = renderOrbat(input);
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  expect(
    new Set(rendered.renderManifests.map((m) => m.renderProfile.version)),
  ).toEqual(new Set([1, 2]));
  expect(() =>
    verifyDiagramManifests(input, rendered.renderManifests, hash),
  ).not.toThrow();
  const altered = structuredClone(rendered.renderManifests);
  const firstV2 = altered.find((m) => m.renderProfile.version === 2)!;
  firstV2.compatibilityLayer = "unexpected-adapter";
  expect(() => verifyDiagramManifests(input, altered, hash)).toThrow(
    /compatibility/,
  );
  const changedResources = structuredClone(rendered.renderManifests);
  changedResources[0].resources.hash = "0".repeat(64);
  expect(() => verifyDiagramManifests(input, changedResources, hash)).toThrow(
    /resources/,
  );
});
