import { afterEach, beforeEach, it, expect } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import { SymbologyService } from "../src/application/symbology-service";
import { GraphicExportService } from "../src/application/graphic-export-service";
import { graphicStaleness } from "../src/application/graphic-staleness";
import { OrdoService } from "../src/application/service";
import { demoOperation } from "../src/demo/operation";
import { renderSymbol } from "../src/rendering/symbol-renderer";
import { renderOrbat } from "../src/rendering/orbat-renderer";
import { selectDiagram } from "../src/application/orbat-projection";
import { newOrbatLayout } from "../src/domain/orbat";
import { newSymbolDefinition } from "../src/domain/symbology";
import { rasterDimensions } from "../src/rendering/raster-limits";
import type { GraphicExportProfile } from "../src/domain/graphic-exports";
import type { GraphicRenderPort } from "../src/application/render-contracts";
import { canonical } from "../src/export/projection";
import { starterConfig } from "../src/config/profiles";
import { assertGeneratedSvg } from "../src/validation/generated-svg";
let repo: SqliteRepository,
  library: SymbologyService,
  service: GraphicExportService;
const rt = {
  id: uid,
  now: () => "2026-10-03T12:00:00.000Z",
  actor: "Fictional graphics tester",
};
const renderer: GraphicRenderPort = {
  render: async (r) =>
    r.kind === "SYMBOL"
      ? { kind: "SYMBOL", result: renderSymbol(r.input) }
      : { kind: "ORBAT", result: renderOrbat(r.input) },
};
beforeEach(() => {
  repo = new SqliteRepository(":memory:");
  repo.seedConfig(starterConfig);
  library = new SymbologyService(repo, rt);
  service = new GraphicExportService(repo, rt, renderer, {
    rasterize: async () => {
      throw Error("No raster fixture configured");
    },
  });
});
afterEach(() => repo.close());
const profile = (
  product: "SYMBOL" | "ORBAT" = "SYMBOL",
): GraphicExportProfile => ({
  schemaVersion: 1,
  id: uid(),
  version: 1,
  name: "Fictional graphic profile",
  product,
  format: "SVG",
  scale: 1,
  background: "TRANSPARENT",
  size: 50,
  foldPolicy: "AS_SHOWN",
  ancestorPolicy: "BOUNDARY",
  selectedUnitIds: null,
  renderProfile: { id: "ordo-symbol", version: 1 },
});
const make = () =>
  library.execute({ type: "new", kind: "SYMBOL", name: "Fictional symbol" })
    .symbol!;
it("keeps folded source annotations out of selected graphic JSON and consumed dependencies", async () => {
  let orbat = library.execute({
    type: "new",
    kind: "ORBAT",
    name: "Fictional folded source",
  }).orbat!;
  const child = structuredClone(orbat.nodes[0]);
  child.nodeId = uid();
  child.parentNodeId = orbat.rootNodeId;
  child.nameOverride = "PRIVATE FOLDED NAME";
  child.annotation = "PRIVATE FOLDED ANNOTATION";
  orbat.nodes.push(child);
  orbat.layout.hints.push({
    nodeId: orbat.rootNodeId,
    folded: true,
    hqStaff: false,
    offset: null,
  });
  orbat = library.execute({
    type: "save-orbat",
    value: orbat,
    expected: orbat.contentVersion,
  }).orbat!;
  const artifact = await service.generate({
    source: {
      kind: "SAVED_ORBAT",
      versionId: orbat.versionId,
      expectedContentVersion: orbat.contentVersion,
    },
    profile: { ...profile("ORBAT"), format: "JSON" },
  });
  const json = new TextDecoder().decode(
    repo.getGraphicExport(artifact.id).bytes,
  );
  expect(json).not.toContain("PRIVATE FOLDED");
  expect(canonical(artifact.dependencies)).not.toContain("PRIVATE FOLDED");
  expect(canonical(artifact.source)).toContain("PRIVATE FOLDED ANNOTATION");
  orbat.nodes[1].annotation = "CHANGED PRIVATE ANNOTATION";
  library.execute({
    type: "save-orbat",
    value: orbat,
    expected: orbat.contentVersion,
  });
  expect(graphicStaleness(artifact, repo).outdated).toBe(false);
  repo.verifyAll();
});
it("retains exact profile, source and renderer inputs with append-only output bytes", async () => {
  const v = make(),
    p = profile(),
    r = await service.generate({
      source: {
        kind: "SAVED_SYMBOL",
        versionId: v.versionId,
        expectedContentVersion: v.contentVersion,
      },
      profile: p,
    });
  expect(r.source.kind).toBe("SAVED_SYMBOL");
  expect(r.profile).toEqual(p);
  expect(r.renderManifests).toHaveLength(1);
  const stored = repo.getGraphicExport(r.id);
  expect(repo.hashBinary(stored.bytes)).toBe(r.contentHash);
  expect(r.dependencies[0].canonicalValue).toContain(v.definition.definitionId);
  expect(() =>
    repo.sqlite
      .prepare("UPDATE graphic_exports SET bytes=? WHERE id=?")
      .run(Buffer.from("changed"), r.id),
  ).toThrow(/immutable/);
  repo.verifyAll();
});
it("versions profile changes and preserves prior exports after a draft changes", async () => {
  let v = make();
  const p = profile(),
    source = () => ({
      kind: "SAVED_SYMBOL",
      versionId: v.versionId,
      expectedContentVersion: v.contentVersion,
    });
  const r = await service.generate({ source: source(), profile: p }),
    original = repo.getGraphicExport(r.id).bytes;
  v.definition.compatibility.generalStars = 3;
  v = library.execute({
    type: "save-symbol",
    value: v,
    expected: v.contentVersion,
  }).symbol!;
  await expect(
    service.generate({ source: source(), profile: { ...p, scale: 2 } }),
  ).rejects.toThrow(/immutable/);
  const next = await service.generate({
    source: source(),
    profile: { ...p, version: 2, scale: 2 },
  });
  expect(next.profile.version).toBe(2);
  expect(repo.getGraphicExport(r.id).bytes).toEqual(original);
  expect(graphicStaleness(r, repo).outdated).toBe(true);
  expect(graphicStaleness(next, repo).outdated).toBe(false);
  repo.verifyAll();
});
it("does not stale new symbol graphics for library names or provenance alone", async () => {
  let v = make();
  const r = await service.generate({
    source: {
      kind: "SAVED_SYMBOL",
      versionId: v.versionId,
      expectedContentVersion: v.contentVersion,
    },
    profile: profile(),
  });
  v.name = "Library metadata rename";
  v.definition.origin = {
    kind: "IMPORT",
    fileHash: "a".repeat(64),
    importerVersion: "fixture",
    originalCode: "RAW SOURCE",
  };
  v = library.execute({
    type: "save-symbol",
    value: v,
    expected: v.contentVersion,
  }).symbol!;
  expect(graphicStaleness(r, repo)).toMatchObject({
    outdated: false,
    changedPaths: [],
  });
  v.definition.amplifiers.uniqueDesignation = "VISIBLE NEW LABEL";
  library.execute({
    type: "save-symbol",
    value: v,
    expected: v.contentVersion,
  });
  expect(graphicStaleness(r, repo).changedPaths).toEqual(["symbol/amplifiers"]);
  repo.verifyAll();
});
it("uses exact operation fields, redacts inherited boundary labels, and marks removed selections unresolved", async () => {
  const planner = new OrdoService(repo, rt, (_n, c) =>
    demoOperation(c, uid, rt.now()),
  );
  let op = planner.execute({
    type: "create",
    name: "Fictional graphic staleness",
    demo: true,
  }).operation!;
  const parent = op.units[0],
    child = op.units[1];
  child.parentUnitId = parent.id;
  child.symbol = {
    schemaVersion: 1,
    base: { definition: newSymbolDefinition(uid), source: null },
    override: null,
    labels: {
      uniqueDesignation: { kind: "PARENT_UNIT_NAME" },
      higherFormation: { kind: "DEFINITION" },
    },
  };
  const save = () =>
    (op = planner.execute({
      type: "save",
      operation: op,
      expectedRevision: op.revision,
    }).operation!);
  save();
  const p = {
    ...profile("ORBAT"),
    format: "JSON" as const,
    selectedUnitIds: [child.id],
  };
  const r = await service.generate({
    source: {
      kind: "OPERATION",
      operationId: op.id,
      revision: op.revision,
      publicationId: null,
    },
    profile: p,
  });
  const bytes = repo.getGraphicExport(r.id).bytes;
  expect(new TextDecoder().decode(bytes)).not.toContain(parent.name);
  op.units[0].name = "EXCLUDED PARENT RENAME";
  op.units[1].symbol!.override = structuredClone(op.units[1].symbol!.base);
  op.units[1].symbol!.override!.definition.amplifiers.staffComments =
    "UNUSED IN ORBAT";
  save();
  expect(graphicStaleness(r, repo).outdated).toBe(false);
  op.units[1].symbol!.labels.uniqueDesignation = { kind: "UNIT_NAME" };
  save();
  expect(graphicStaleness(r, repo).changedPaths).toContain(
    `orbat/units/${child.id}/name`,
  );
  expect(repo.getGraphicExport(r.id).bytes).toEqual(bytes);
  const missing = structuredClone(r);
  missing.profile.selectedUnitIds = [uid()];
  expect(graphicStaleness(missing, repo)).toMatchObject({
    outdated: null,
    reason: "Export selection references an absent unit",
  });
  repo.verifyAll();
});
it("rejects source, manifest, and retained SVG substitutions even when artifact hashes are recomputed", async () => {
  const v = make(),
    r = await service.generate({
      source: {
        kind: "SAVED_SYMBOL",
        versionId: v.versionId,
        expectedContentVersion: v.contentVersion,
      },
      profile: profile(),
    });
  const { bytes } = repo.getGraphicExport(r.id);
  const corrupted = structuredClone(r);
  corrupted.id = uid();
  corrupted.dependencies[1].canonicalValue = canonical("unrelated");
  expect(() => repo.insertGraphicExport(corrupted, bytes)).toThrow(
    /dependencies mismatch/,
  );
  const manifest = structuredClone(r);
  manifest.id = uid();
  manifest.renderManifests[0].inputHash = "0".repeat(64);
  expect(() => repo.insertGraphicExport(manifest, bytes)).toThrow(
    /consumed input/,
  );
  const substitute = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>',
  );
  const changed = {
    ...r,
    id: uid(),
    byteLength: substitute.length,
    contentHash: repo.hashBinary(substitute),
  };
  expect(() => repo.insertGraphicExport(changed, substitute)).toThrow(
    /differs from retained/,
  );
});
it("keeps original schema-1 request verification and staleness semantics", async () => {
  let v = make();
  const r = await service.generate({
    source: {
      kind: "SAVED_SYMBOL",
      versionId: v.versionId,
      expectedContentVersion: v.contentVersion,
    },
    profile: profile(),
  });
  const request = {
    kind: "SYMBOL" as const,
    input: {
      definition: v.definition,
      size: r.profile.size,
      context: "SYMBOL" as const,
      labelSide: "RIGHT" as const,
    },
  };
  const rendered = renderSymbol(request.input),
    bytes = new TextEncoder().encode(rendered.svg);
  const legacy = {
    ...r,
    id: uid(),
    schemaVersion: 1 as const,
    dependencyVersion: undefined,
    renderedSvg: undefined,
    renderedSvgHash: undefined,
    dependencies: [
      { path: "graphic/request", canonicalValue: canonical(request) },
    ],
    renderManifests: [rendered.manifest],
    byteLength: bytes.length,
    contentHash: repo.hashBinary(bytes),
  };
  repo.insertGraphicExport(legacy, bytes);
  expect(
    graphicStaleness(repo.getGraphicExport(legacy.id).record, repo).outdated,
  ).toBe(false);
  v.definition.origin = {
    kind: "IMPORT",
    fileHash: "a".repeat(64),
    importerVersion: "legacy fixture",
    originalCode: "ORIGINAL",
  };
  v = library.execute({
    type: "save-symbol",
    value: v,
    expected: v.contentVersion,
  }).symbol!;
  expect(graphicStaleness(legacy, repo).changedPaths).toEqual([
    "graphic/request",
  ]);
  expect(graphicStaleness(r, repo).outdated).toBe(false);
  repo.verifyAll();
});
it("exports retired versions through their original published content identity", async () => {
  let v = make();
  v = library.execute({
    type: "publish",
    kind: "SYMBOL",
    id: v.versionId,
    expected: v.contentVersion,
  }).symbol!;
  const originalHash = repo.libraryHash("SYMBOL", v.versionId);
  library.execute({ type: "retire", kind: "SYMBOL", id: v.versionId });
  const r = await service.generate({
    source: {
      kind: "SAVED_SYMBOL",
      versionId: v.versionId,
      expectedContentVersion: v.contentVersion,
    },
    profile: profile(),
  });
  expect(r.source.kind !== "OPERATION" && r.source.ref.contentHash).toBe(
    originalHash,
  );
  repo.verifyAll();
});
it("does not persist a half-finished export when rendering fails or source changes", async () => {
  const v = make(),
    input = {
      source: {
        kind: "SAVED_SYMBOL",
        versionId: v.versionId,
        expectedContentVersion: v.contentVersion,
      },
      profile: profile(),
    };
  const changed = new GraphicExportService(
    repo,
    rt,
    {
      render: async (r) => {
        const old = repo.getSymbol(v.versionId);
        old.name = "Renamed during render";
        library.execute({
          type: "save-symbol",
          value: old,
          expected: old.contentVersion,
        });
        return renderer.render(r);
      },
    },
    {
      rasterize: async () => {
        throw Error("unused");
      },
    },
  );
  await expect(changed.generate(input)).rejects.toThrow(
    /changed while exporting/,
  );
  expect(repo.listGraphicExports()).toHaveLength(0);
  expect(
    repo.sqlite
      .prepare("SELECT count(*) n FROM graphic_export_profile_versions")
      .get(),
  ).toEqual({ n: 0 });
});
it("uses scalar gallery queries without hydrating source snapshots or artifact bytes", async () => {
  const v = make();
  await service.generate({
    source: {
      kind: "SAVED_SYMBOL",
      versionId: v.versionId,
      expectedContentVersion: v.contentVersion,
    },
    profile: profile(),
  });
  const rows = repo.listGraphicExports();
  expect(rows).toHaveLength(1);
  expect(Object.keys(rows[0])).not.toContain("source");
  expect(Object.keys(rows[0])).not.toContain("bytes");
  expect(rows[0].name).toBe(v.name);
});
it("removes excluded ancestor names and symbols before rendering or serializing selection", () => {
  const root = uid(),
    child = uid(),
    symbol = newSymbolDefinition(uid),
    input = {
      nodes: [
        {
          id: root,
          parentId: null,
          name: "Excluded parent text",
          annotation: "Excluded details",
          symbol,
          boundary: false,
        },
        {
          id: child,
          parentId: root,
          name: "Selected child",
          annotation: "",
          symbol: null,
          boundary: false,
        },
      ],
      layout: newOrbatLayout(uid),
    };
  const selected = selectDiagram(input, {
    selectedUnitIds: [child],
    ancestorPolicy: "BOUNDARY",
    foldPolicy: "AS_SHOWN",
  });
  expect(canonical(selected)).not.toContain("Excluded");
  expect(canonical(selected)).not.toContain(symbol.definitionId);
  expect(renderOrbat(selected).svg).toContain("Selected child");
  expect(renderOrbat(selected).svg).not.toContain("Excluded");
  expect(input.nodes[0].name).toBe("Excluded parent text");
  const context = selectDiagram(input, {
    selectedUnitIds: [child],
    ancestorPolicy: "INCLUDE_CONTEXT",
    foldPolicy: "AS_SHOWN",
  });
  expect(context.nodes[0].name).toBe("Excluded parent text");
});
it("applies expanded-fold exports independently of the live presentation", () => {
  const root = uid(),
    child = uid(),
    input = {
      nodes: [
        {
          id: root,
          parentId: null,
          name: "Root",
          annotation: "",
          symbol: null,
          boundary: false,
        },
        {
          id: child,
          parentId: root,
          name: "Child",
          annotation: "",
          symbol: null,
          boundary: false,
        },
      ],
      layout: newOrbatLayout(uid),
    };
  input.layout.hints.push({
    nodeId: root,
    folded: true,
    hqStaff: false,
    offset: null,
  });
  const selected = selectDiagram(input, {
    selectedUnitIds: null,
    ancestorPolicy: "BOUNDARY",
    foldPolicy: "EXPANDED",
  });
  expect(renderOrbat(selected).layout.nodes.some((n) => n.id === child)).toBe(
    true,
  );
  expect(input.layout.hints[0].folded).toBe(true);
});
it("rejects raster bombs and invalid scales before creating a canvas", () => {
  expect(rasterDimensions('<svg width="50" height="40"></svg>', 2)).toEqual({
    width: 100,
    height: 80,
  });
  for (const [width, height, scale] of [
    [16385, 1, 1],
    [8000, 8000, 1],
    [1, 1, Infinity],
    [1, 1, 0],
  ])
    expect(() =>
      rasterDimensions(
        `<svg width="${width}" height="${height}"></svg>`,
        scale,
      ),
    ).toThrow();
});
it("rejects active SVG even when an incoming artifact has matching byte hashes", async () => {
  const v = make(),
    r = await service.generate({
      source: {
        kind: "SAVED_SYMBOL",
        versionId: v.versionId,
        expectedContentVersion: v.contentVersion,
      },
      profile: profile(),
    });
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href=https://example.invalid/x /></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><svg:script xmlns:svg="http://www.w3.org/2000/svg"/></svg>',
  ]) {
    const bytes = new TextEncoder().encode(svg),
      forged = {
        ...r,
        id: uid(),
        byteLength: bytes.length,
        contentHash: repo.hashBinary(bytes),
      };
    expect(() => repo.insertGraphicExport(forged, bytes)).toThrow(/SVG/);
  }
});
it("rejects a graphic JSON payload that disagrees with its retained source or profile", async () => {
  const v = make(),
    p = { ...profile(), format: "JSON" as const };
  const r = await service.generate({
    source: {
      kind: "SAVED_SYMBOL",
      versionId: v.versionId,
      expectedContentVersion: v.contentVersion,
    },
    profile: p,
  });
  const payload = JSON.parse(
    new TextDecoder().decode(repo.getGraphicExport(r.id).bytes),
  );
  payload.profile.name = "Substituted";
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  expect(() =>
    repo.insertGraphicExport(
      {
        ...r,
        id: uid(),
        byteLength: bytes.length,
        contentHash: repo.hashBinary(bytes),
      },
      bytes,
    ),
  ).toThrow(/JSON provenance/);
});
it("rejects unquoted SVG references and unrecognized elements without blocking escaped plain text", () => {
  expect(() =>
    assertGeneratedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><use href=#ok /></svg>',
    ),
  ).toThrow(/Unquoted/);
  expect(() =>
    assertGeneratedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><audio src="local"/></svg>',
    ),
  ).toThrow(/element/);
  expect(() =>
    assertGeneratedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>&lt;script&gt;</text></svg>',
    ),
  ).not.toThrow();
});
