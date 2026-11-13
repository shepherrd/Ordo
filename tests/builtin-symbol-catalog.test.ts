import { expect, it } from "vitest";
import { createHash, randomUUID as uid } from "node:crypto";
import { readFileSync } from "node:fs";
import { symbolCatalog } from "../src/rendering/symbol-catalog";
import { renderSymbol } from "../src/rendering/symbol-renderer";
import { metadataSelectorsV1 } from "../src/rendering/metadata-selector-v1";
import { militarySymbolDefinitionSchema } from "../src/domain/symbology";
import { SqliteRepository } from "../src/persistence/repository";
import { SymbologyService } from "../src/application/symbology-service";
import { starterConfig } from "../src/config/profiles";
import legacy from "../src/rendering/resources/legacy-catalog-v1.json";
import sof from "../src/rendering/resources/legacy-sof-catalog-v1.json";
import fm from "../src/rendering/resources/fm-dictionary-v1.json";
import frozen from "./fixtures/deletion-frozen-implementations.json";
import sourceEvidence from "../docs/symbol-catalog-source-evidence.json";
const browse = (
  collection: "NUMERIC" | "LEGACY" | "FM",
  search = "",
  group = "",
  offset = 0,
) =>
  symbolCatalog({
    type: "builtin-browse",
    collection,
    search,
    group,
    offset,
    limit: 100,
  }).builtin!;
const all = (collection: "NUMERIC" | "LEGACY" | "FM") => {
  const page = browse(collection),
    entries = [...page.entries];
  for (let offset = 100; offset < page.total; offset += 100)
    entries.push(...browse(collection, "", "", offset).entries);
  return entries;
};
it("exposes every retained numeric selector including both modifier kinds without mutating the adapter", () => {
  const metadata = metadataSelectorsV1(),
    entries = all("NUMERIC");
  expect(entries.length).toBe(
    Object.values(metadata).reduce(
      (sum, set) =>
        sum + set.mainIcon.length + set.modifier1.length + set.modifier2.length,
      0,
    ),
  );
  expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  expect(browse("NUMERIC").groups).toHaveLength(Object.keys(metadata).length);
  expect(entries.some((e) => e.kind === "Common modifier 1")).toBe(true);
  for (const entry of entries)
    expect(
      militarySymbolDefinitionSchema.safeParse(entry.definition).success,
    ).toBe(true);
  expect(metadataSelectorsV1()).toEqual(metadata);
  expect(
    browse("NUMERIC", "infantry", "10").entries.every(
      (e) => e.group === "Land unit",
    ),
  ).toBe(true);
});
it("exposes all eight reference legacy groups with original codes, including all 29 verified SOF entries", () => {
  const entries = all("LEGACY");
  expect(entries).toHaveLength(862);
  expect(browse("LEGACY").groups).toHaveLength(8);
  expect(new Set(entries.map((e) => e.id)).size).toBe(862);
  for (const group of [...legacy.groups, ...sof.groups])
    for (const source of group.entries) {
      const entry = entries.find((e) => e.id === source.id)!;
      expect(entry.name).toBe(source.names.join(" / "));
      expect(entry.definition!.code.sidc).toBe(
        `${source.scheme}F${source.dimension}P${source.functionId}--`,
      );
      expect(entry.definition!.code.dialect).toBe("LETTER");
    }
  const special = browse("LEGACY", "", "SOFUNT");
  expect(special.total).toBe(29);
  for (const entry of special.entries) {
    const rendered = renderSymbol({
      definition: entry.definition!,
      size: 35,
      context: "SYMBOL",
      labelSide: "RIGHT",
    });
    expect(rendered.svg).toContain("<svg");
    expect(rendered.diagnostics).toContain(
      "Legacy letter code retained; no numeric SIDC conversion was inferred.",
    );
  }
  // Existing selector commands and dataset keep their exact historical scope.
  expect(symbolCatalog({ type: "legacy-sets" }).choices).toHaveLength(7);
});
it("retains every FM mapping, unavailable entry, caveat and citation separately", () => {
  const entries = all("FM");
  expect(entries).toHaveLength(453);
  expect(entries.filter((e) => e.definition === null)).toHaveLength(23);
  for (const source of fm.entries) {
    const entry = entries.find((e) => e.id === source.entryId)!;
    expect(entry.availability).toBe(source.availability);
    expect(entry.code).toBe(source.sidc);
    for (const note of [...source.notes, ...source.editorialIssues].filter(
      Boolean,
    ))
      expect(entry.notes).toContain(note);
    expect(entry.source).toContain(source.citation.provenanceClass);
    expect(entry.source).toContain(source.citation.sourceHash);
  }
});
it("returns independent pages and definitions and rejects invalid or oversized requests", () => {
  const first = browse("LEGACY"),
    original = structuredClone(first.entries[0]);
  first.entries[0].definition!.amplifiers.uniqueDesignation = "edited";
  expect(browse("LEGACY").entries[0]).toEqual(original);
  expect(browse("LEGACY", "no such symbol 87293487").total).toBe(0);
  expect(browse("LEGACY", "", "", 90000).entries).toHaveLength(0);
  for (const extra of [
    { limit: 101 },
    { offset: -1 },
    { search: "x".repeat(201) },
    { collection: "unknown" },
  ])
    expect(() =>
      symbolCatalog({
        type: "builtin-browse",
        collection: "LEGACY",
        group: "",
        search: "",
        offset: 0,
        limit: 24,
        ...extra,
      }),
    ).toThrow();
});
it("creates independent saved drafts atomically with the exact code, origin and render profile", () => {
  const repo = new SqliteRepository(":memory:");
  try {
    repo.seedConfig(starterConfig);
    const service = new SymbologyService(repo, {
      id: uid,
      now: () => "2026-10-08T12:00:00.000Z",
      actor: "Fictional catalog tester",
    });
    const source = browse("LEGACY", "", "SOFUNT").entries[0].definition!;
    const a = service.execute({
      type: "new-symbol-from-definition",
      name: "Fictional SOF copy",
      definition: source,
    }).symbol!;
    const b = service.execute({
      type: "new-symbol-from-definition",
      name: "Second independent copy",
      definition: source,
    }).symbol!;
    expect(
      new Set([
        source.definitionId,
        a.definition.definitionId,
        b.definition.definitionId,
      ]).size,
    ).toBe(3);
    expect(a.status).toBe("DRAFT");
    expect(a.publishedAt).toBeNull();
    expect({ ...a.definition, definitionId: source.definitionId }).toEqual(
      source,
    );
    expect(a.familyId).not.toBe(b.familyId);
    expect(() =>
      service.execute({
        type: "new-symbol-from-definition",
        name: "Invalid",
        definition: { ...source, code: { ...source.code, sidc: "invalid" } },
      }),
    ).toThrow();
    expect(
      service.execute({
        type: "browse",
        kind: "SYMBOL",
        query: { search: "", status: "", offset: 0, limit: 100 },
      }).page!.total,
    ).toBe(2);
    repo.verifyAll();
  } finally {
    repo.close();
  }
});
it("preserves historical hashes and records the exact new SOF resource provenance", () => {
  const hash = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  for (const [path, expected] of Object.entries(frozen))
    expect(hash(path), path).toBe(expected);
  expect(hash(sourceEvidence.resource)).toBe(sourceEvidence.resourceHash);
  expect(sourceEvidence.rows).toBe(29);
  expect(sourceEvidence.difference).toBe("Exact normalized SOF table");
});
