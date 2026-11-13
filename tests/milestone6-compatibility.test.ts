import { visualTestOutput } from "./visual-test-output";
import { it, expect } from "vitest";
import { randomUUID as uid, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { restoreCorePathsV1 } from "../src/rendering/symbol-path-corrections-v1";
import { renderSymbol } from "../src/rendering/symbol-renderer";
import { newSymbolDefinition } from "../src/domain/symbology";
import {
  editLegacySegment,
  editNumericSegment,
  numericSegment,
} from "../src/domain/symbol-codes";
import { symbolCatalog } from "../src/rendering/symbol-catalog";
import { legacyCatalogSchema } from "../src/application/symbol-catalog";
import legacy from "../src/rendering/resources/legacy-catalog-v1.json";
import deltas from "./fixtures/milestone6-core-svg-deltas.json";
import { foldedGroupDefinitionV1 } from "../src/rendering/folded-group-v1";
import foldFixture from "./fixtures/milestone6-fold-placeholder.json";
import { renderOrbat } from "../src/rendering/orbat-renderer";
import { newOrbatLayout } from "../src/domain/orbat";
import resourceSymbols from "./fixtures/render-resource-symbols.json";
import { militarySymbolDefinitionSchema } from "../src/domain/symbology";
import ms from "milsymbol";
import rawMetadata from "../src/rendering/resources/metadata-0.2.14.json";
import { metadataSelectorsV1 } from "../src/rendering/metadata-selector-v1";
import {
  legacyCrosswalkV1,
  previewLegacyCrosswalk,
} from "../src/application/legacy-crosswalk";
import corpus from "./fixtures/milestone6-core-corpus.json";
it("replays the retained architecture-study core corpus and explicitly identifies unsupported framing options", () => {
  const differences: unknown[] = [],
    skipped: string[] = [];
  for (const f of corpus.fixtures) {
    if (f.unsupported) {
      skipped.push(f.id);
      continue;
    }
    const d = newSymbolDefinition(uid),
      options = f.options as Record<string, unknown>;
    d.code = f.sidc.startsWith("S")
      ? {
          dialect: "LETTER",
          sidc: f.sidc,
          assertedStandard: "UNVERIFIED",
          sourceConvention: "LETTER_CODE",
        }
      : {
          ...d.code,
          dialect: "NUMERIC",
          sidc: f.sidc,
          assertedStandard: "UNVERIFIED",
          sourceConvention: "NUMERIC_13",
        };
    for (const [key, v] of Object.entries(options)) {
      if (key === "size") continue;
      if (key === "standard") {
        d.appearance.convention = v as "2525" | "APP6";
        continue;
      }
      if (key === "stack") {
        d.compatibility.stack = v as number;
        continue;
      }
      if (["outlineWidth", "fill", "monoColor"].includes(key))
        Object.assign(d.appearance, { [key]: v });
      else Object.assign(d.amplifiers, { [key]: v });
    }
    const r = renderSymbol({
      definition: d,
      size: Number(options.size ?? 100),
      context: "SYMBOL",
      labelSide: "RIGHT",
    });
    const svgHash = createHash("sha256").update(r.svg).digest("hex");
    if (
      svgHash !== f.expected.svgHash ||
      JSON.stringify(r.geometry) !== JSON.stringify(f.expected.geometry)
    )
      differences.push({
        id: f.id,
        expected: f.expected,
        actual: { svgHash, geometry: r.geometry },
      });
  }
  mkdirSync(visualTestOutput, { recursive: true });
  writeFileSync(
    `${visualTestOutput}/core-corpus-result.json`,
    JSON.stringify(
      {
        total: corpus.fixtures.length,
        supported: corpus.fixtures.length - skipped.length,
        skipped,
        differences,
      },
      null,
      2,
    ),
  );
  expect(skipped).toHaveLength(5);
  expect(differences).toEqual([]);
});
it("keeps exact crosswalk inspection explicit, reports suffix loss and refuses ambiguous or unverified conversions", () => {
  const code = {
      dialect: "LETTER",
      sidc: "SFGPUCI---AHUSG",
      assertedStandard: "MIL_STD_2525C",
      sourceConvention: "LETTER_CODE",
    } as const,
    before = JSON.stringify(code),
    p = previewLegacyCrosswalk(code);
  expect(p.status).toBe("MATCHED");
  expect(p.candidateCode).toBe("13031002181211000000");
  expect(
    p.fields.filter((f) => f.action === "OMITTED").map((f) => f.field),
  ).toEqual(["country suffix", "order-of-battle suffix"]);
  expect(JSON.stringify(code)).toBe(before);
  for (const state of ["DISCREPANT", "UNVERIFIED"] as const) {
    const row = legacyCrosswalkV1.entries.find((r) => r.status === state);
    if (!row) throw Error(`Missing ${state} crosswalk fixture`);
    const s = row.key[0] + "F" + row.key[2] + "P" + row.key.slice(4) + "--",
      r = previewLegacyCrosswalk({ ...code, sidc: s });
    expect(r.status).toBe(state);
    expect(r.candidateCode).toBeNull();
    expect(r.sourceRowHash).toBe(row.sourceRowHash);
  }
  for (const sidc of [
    "SFGPZZZZZZ--",
    "SFGPUCI---QZ",
    "SDGPUCI-----",
    "SFFPUCI-----",
    "WAS-WSVE----",
  ])
    expect(previewLegacyCrosswalk({ ...code, sidc }).candidateCode).toBeNull();
  expect(
    legacyCrosswalkV1.entries.filter((r) => r.status === "MATCHED"),
  ).toHaveLength(619);
  expect(
    legacyCrosswalkV1.entries.filter((r) => r.status === "DISCREPANT"),
  ).toHaveLength(108);
  expect(
    legacyCrosswalkV1.entries.filter((r) => r.status === "AMBIGUOUS"),
  ).toHaveLength(0);
  expect(
    legacyCrosswalkV1.entries.filter((r) => r.status === "UNVERIFIED"),
  ).toHaveLength(3);
});
it("withholds all unresolved rows in the supported selector without changing their source codes", () => {
  const unresolved = legacyCrosswalkV1.entries.filter(
    (r) => r.status !== "MATCHED",
  );
  expect(unresolved).toHaveLength(111);
  for (const row of unresolved) {
    const retainedRow = structuredClone(row);
    // Some rows retain inspected targets as diagnostic evidence; those targets
    // must never become usable conversions while the row is unresolved.
    expect(row.sourceRowHash).toMatch(/^[a-f0-9]{64}$/);
    const code = {
      dialect: "LETTER" as const,
      sidc: row.key[0] + "F" + row.key[2] + "P" + row.key.slice(4) + "--",
      assertedStandard: "UNVERIFIED" as const,
      sourceConvention: "LETTER_CODE" as const,
    };
    const before = structuredClone(code);
    const preview = previewLegacyCrosswalk(code);
    expect(preview.candidateCode, row.key).toBeNull();
    expect(preview.sourceCode).toBe(code.sidc);
    expect(preview.diagnostics.length).toBeGreaterThan(0);
    expect(code).toEqual(before);
    expect(row).toEqual(retainedRow);
  }
});

it("uses the upstream split extended-modifier positions without corrupting the frame or country suffix", () => {
  const code = newSymbolDefinition(uid).code;
  code.sidc = "130310000012110012340030000840";
  const a = editNumericSegment(code, "commonModifier1", "107"),
    b = editNumericSegment(a, "commonModifier2", "103");
  expect(numericSegment(b, "commonModifier1")).toBe("107");
  expect(numericSegment(b, "commonModifier2")).toBe("103");
  expect(b.sidc.slice(22)).toBe(code.sidc.slice(22));
  const metadata = new ms.Symbol(b.sidc).getMetadata() as unknown as {
    _modifier1: string;
    _modifier2: string;
  };
  expect(metadata._modifier1).toBe("107");
  expect(metadata._modifier2).toBe("103");
  const c = editNumericSegment(b, "modifier1", "98");
  expect(numericSegment(c, "commonModifier1")).toBe("098");
  expect(numericSegment(c, "commonModifier2")).toBe("103");
  expect(c.sidc.slice(22)).toBe(code.sidc.slice(22));
  const short = { ...code, sidc: code.sidc.slice(0, 20) };
  expect(numericSegment(short, "commonModifier1")).toBeNull();
  expect(() => editNumericSegment(short, "commonModifier1", "107")).toThrow(
    /no conversion/,
  );
  expect(editNumericSegment(short, "modifier1", "98").sidc).toHaveLength(20);
});
it("retains inspected reference metadata exceptions separately from the unchanged upstream tables and FM dictionary", () => {
  const before = JSON.stringify(rawMetadata),
    data = metadataSelectorsV1();
  expect(JSON.stringify(rawMetadata)).toBe(before);
  const rows = data["10"].mainIcon,
    index = rows.findIndex((r) => r.Code === "130300");
  expect(rows[index + 1]).toMatchObject({
    Code: "130301",
    Remarks: "Removed from 2525E",
  });
  expect(data["25"].modifier1).toEqual([]);
  expect(data["25"].modifier2).toEqual([]);
  expect(data["10"].mainIcon[0].Code).toBe("000000");
  expect(data["10"].modifier1[0].Code).toBe("00");
  expect(data["10"].modifier1[1]["First Modifier"]).toBe(
    "Headquarters or Headquarters Staff Element",
  );
  expect(
    Object.values(data)
      .flatMap((s) => s.mainIcon)
      .some(
        (r) => r["Geometric Rendering"] && r["Geometric Rendering"] !== "Point",
      ),
  ).toBe(false);
  expect(
    symbolCatalog({
      type: "metadata",
      set: "10",
      field: "MAIN",
      search: "Removed from 2525E",
      offset: 0,
      limit: 20,
    }).choices?.some((c) => c.id === "130301"),
  ).toBe(true);
  expect(
    symbolCatalog({
      type: "metadata",
      set: "10",
      field: "COMMON_1",
      search: "Armored",
      offset: 0,
      limit: 20,
    }).choices?.some((c) => c.id === "107"),
  ).toBe(true);
});
it("captures current renderings for the replacement-resource fidelity matrix", () => {
  const outputs = resourceSymbols.map((f) => {
    const result = renderSymbol({
      definition: militarySymbolDefinitionSchema.parse(f.definition),
      size: f.size,
      context: f.context === "ORBAT_NODE" ? "ORBAT_NODE" : "SYMBOL",
      labelSide: f.labelSide === "LEFT" ? "LEFT" : "RIGHT",
    });
    expect(Number.isFinite(result.geometry.size.width), f.id).toBe(true);
    return { id: f.id, ...result };
  });
  mkdirSync(visualTestOutput, { recursive: true });
  writeFileSync(
    `${visualTestOutput}/ordo-resource-results.json`,
    JSON.stringify(outputs),
  );
});
it("restores all captured core SVG variants exactly while retaining upstream geometry", () => {
  const outputs = [];
  for (const f of deltas.fixtures) {
    expect(restoreCorePathsV1(f.upstream.svg), f.id).toBe(f.reference.svg);
    const definition = newSymbolDefinition(uid),
      { size, standard, ...appearance } = f.options as {
        size: number;
        standard?: "2525" | "APP6";
      };
    definition.code.sidc = f.sidc;
    Object.assign(definition.appearance, appearance);
    if (standard) definition.appearance.convention = standard;
    const result = renderSymbol({
      definition,
      size,
      context: "SYMBOL",
      labelSide: "RIGHT",
    });
    expect(result.svg, f.id).toBe(f.reference.svg);
    expect(result.geometry, f.id).toEqual({
      size: f.reference.size,
      anchor: f.reference.anchor,
      octagon: f.reference.octagon,
    });
    outputs.push({ id: f.id, svg: result.svg });
  }
  mkdirSync(visualTestOutput, { recursive: true });
  writeFileSync(
    `${visualTestOutput}/ordo-core-results.json`,
    JSON.stringify(outputs),
  );
});
it("ships only seven licensed legacy groups and preserves the inspected omitted parent", () => {
  const data = legacyCatalogSchema.parse(legacy);
  expect(data.groups).toHaveLength(7);
  expect(data.groups.flatMap((g) => g.entries)).toHaveLength(833);
  expect(data.groups.some((g) => g.id === "SOFUNT")).toBe(false);
  expect(
    data.groups
      .find((g) => g.id === "GRDTRK_UNT")!
      .entries.some((e) => e.id === "GRDTRK_UNT:GRDTRK"),
  ).toBe(false);
  expect(
    symbolCatalog({
      type: "legacy-metadata",
      set: "GRDTRK_UNT",
      search: "infantry",
      offset: 0,
      limit: 2,
    }).choices,
  ).toHaveLength(2);
  expect(() =>
    symbolCatalog({
      type: "legacy-metadata",
      set: "SOFUNT",
      search: "",
      offset: 0,
      limit: 30,
    }),
  ).toThrow(/Unavailable/);
});
it("renders a reference stacked folded placeholder with exact measured geometry and no canonical synthetic units", () => {
  const folded = renderSymbol({
    definition: foldedGroupDefinitionV1(),
    size: 20,
    context: "FOLDED_GROUP",
    labelSide: "RIGHT",
  });
  expect(folded.svg).toBe(foldFixture.expected.svg);
  expect(folded.geometry).toEqual({
    size: foldFixture.expected.size,
    anchor: foldFixture.expected.anchor,
    octagon: foldFixture.expected.octagon,
  });
  const root = uid(),
    child = uid(),
    layout = newOrbatLayout(uid);
  layout.hints = [{ nodeId: root, folded: true, hqStaff: false, offset: null }];
  const request = {
    nodes: [
      {
        id: root,
        parentId: null,
        name: "HQ",
        annotation: "",
        symbol: newSymbolDefinition(uid),
        boundary: false,
      },
      {
        id: child,
        parentId: root,
        name: "Hidden child",
        annotation: "",
        symbol: newSymbolDefinition(uid),
        boundary: false,
      },
    ],
    layout,
    symbolSize: 30,
  };
  const before = JSON.stringify(request),
    r = renderOrbat(request),
    synthetic = r.layout.nodes.find((n) => n.synthetic === "FOLD")!;
  expect(synthetic.box.right - synthetic.box.left).toBe(
    folded.geometry.size.width,
  );
  expect(r.svg).not.toContain('data-unit-id="fold-');
  expect(r.svg).toContain('data-unit-id="' + root + '"');
  expect(r.svg).not.toContain('data-unit-id="' + child + '"');
  expect(JSON.stringify(request)).toBe(before);
  expect(r.renderManifests).toHaveLength(2);
  expect(() => renderOrbat({ ...request, symbolSize: 10 })).not.toThrow();
});
it("edits legacy components without discarding suffixes or converting the code dialect", () => {
  const definition = newSymbolDefinition(uid);
  definition.code = {
    dialect: "LETTER",
    sidc: "SFGPUCI---KAUSG",
    assertedStandard: "UNVERIFIED",
    sourceConvention: "IMPORTED",
  };
  // Fourteen-character legacy inputs retain every suffix character.
  const edited = editLegacySegment(definition.code, "status", "A");
  expect(edited.sidc).toBe("SFGAUCI---KAUSG");
  expect(edited.dialect).toBe("LETTER");
  expect(() =>
    editLegacySegment(
      { ...definition.code, sidc: "SFGPUCI-----" },
      "country",
      "US",
    ),
  ).toThrow(/does not contain/);
  const entry = legacy.groups
    .find((g) => g.id === "GRDTRK_UNT")!
    .entries.find((e) => e.functionId === "UCA---")!;
  const result = symbolCatalog({
    type: "legacy-apply",
    entryId: entry.id,
    action: "APPLY_COMPONENT",
    definition,
  }).definition!;
  expect(result.code.sidc.slice(10)).toBe(definition.code.sidc.slice(10));
  expect(result.origin.kind).toBe("CATALOG");
  expect(definition.code.sidc).toBe("SFGPUCI---KAUSG");
  const air = legacy.groups.find((g) => g.id === "AIRTRK")!.entries[0];
  expect(() =>
    symbolCatalog({
      type: "legacy-apply",
      entryId: air.id,
      action: "APPLY_COMPONENT",
      definition,
    }),
  ).toThrow(/Different/);
  expect(
    symbolCatalog({
      type: "legacy-apply",
      entryId: air.id,
      action: "OPEN_EXAMPLE",
      definition,
    }).definition!.code.sidc[2],
  ).toBe("A");
});
