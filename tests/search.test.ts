import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { SqliteRepository } from "../src/persistence/repository";
import { starterConfig, armyConfig } from "../src/config/profiles";
import { demoOperation } from "../src/demo/operation";
import { SearchService } from "../src/application/search-service";
import {
  searchRequestSchema,
  searchScore,
  normalizeSearch,
} from "../src/domain/search";
import { operationSearchDocuments } from "../src/domain/search-documents";
import { writeNarrative } from "../src/domain/narrative";
import { SearchSession } from "../src/renderer/src/search-session";

describe("unified saved search", () => {
  it("indexes saved source fields atomically, extracts rich text and treats query syntax literally", () => {
    const repo = new SqliteRepository(":memory:");
    try {
      repo.seedConfig(starterConfig);
      const op = demoOperation(
        starterConfig,
        randomUUID,
        new Date().toISOString(),
      );
      op.name = "38th Unité";
      op.tasks[0].purpose = writeNarrative({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Readiness by morning",
                marks: [{ type: "bold" }],
              },
            ],
          },
        ],
      });
      repo.saveOperation(op, null, "Test");
      while (!repo.search.rebuildBatch()) {
        /* bounded startup batches */
      }
      const service = new SearchService(repo.search, "fixture");
      const query = (query: string, patch = {}) =>
        service.query(
          searchRequestSchema.parse({ query, sequence: 1, ...patch }),
        );
      expect(query("38th unite").hits[0].title).toBe("38th Unité");
      const rich = query("readiness morning").hits[0];
      expect(rich.text).toBe("Readiness by morning");
      expect(rich.text).not.toContain("ORDO_RICH");
      expect(query('" OR *; DROP TABLE operations; --').hits).toEqual([]);
      expect(
        query("readiness", { excludedOwners: ["operation:" + op.id] }).hits,
      ).toEqual([]);
      const changed = structuredClone(op);
      changed.revision++;
      changed.tasks[0].purpose = "Revised purpose";
      repo.saveOperation(changed, op.revision, "Test");
      expect(query("readiness").hits).toEqual([]);
      expect(query("revised").hits).toHaveLength(1);
      expect(() =>
        repo.transaction(() => {
          const failed = structuredClone(changed);
          failed.revision++;
          failed.tasks[0].purpose = "Rollback marker";
          repo.saveOperation(failed, changed.revision, "Test");
          throw Error("abort");
        }),
      ).toThrow("abort");
      expect(query("rollback").hits).toHaveLength(0);
      expect(query("revised").hits).toHaveLength(1);
      expect(() =>
        service.resolve({
          target: rich.target,
          sourceToken: rich.sourceToken,
          workspaceGeneration: "previous",
        }),
      ).toThrow("workspace changed");
      expect(() =>
        service.resolve({
          target: rich.target,
          sourceToken: rich.sourceToken,
          workspaceGeneration: "fixture",
        }),
      ).toThrow("source changed");
      expect(query("revised").complete).toBe(true);
    } finally {
      repo.close();
    }
  });
  it("rebuilds missing disposable entries and gives stable ranked, filtered pages", () => {
    const repo = new SqliteRepository(":memory:");
    try {
      repo.seedConfig(armyConfig);
      const operations = Array.from({ length: 3 }, () =>
        demoOperation(armyConfig, randomUUID, new Date().toISOString()),
      );
      for (const op of operations) {
        op.name = "Shared designation";
        repo.saveOperation(op, null, "Test");
      }
      repo.sqlite
        .prepare("DELETE FROM search_documents WHERE owner=?")
        .run("operation:" + operations[0].id);
      while (!repo.search.rebuildBatch()) {
        /* bounded startup batches */
      }
      const r = searchRequestSchema.parse({
        query: "shared",
        type: "operation",
        sequence: 1,
        limit: 2,
      });
      const first = repo.search.query(r);
      expect(first.hits).toHaveLength(2);
      expect(first.more).toBe(true);
      expect(repo.search.query({ ...r, offset: 2 }).hits).toHaveLength(1);
      expect(
        repo.search.query({ ...r, operationId: operations[0].id }).hits,
      ).toHaveLength(1);
      const source = {
        area: "operation" as const,
        operationId: operations[0].id,
        target: {
          kind: "entity" as const,
          entityKind: "unit" as const,
          entityId: operations[0].tasks[0].unitId!,
        },
      };
      expect(
        repo.search
          .usage({ target: source, excludedOwners: [], offset: 0 })
          .references.some((r) => r.label.includes("unit")),
      ).toBe(true);
      expect(
        repo.search.usage({
          target: source,
          excludedOwners: ["operation:" + operations[0].id],
          offset: 0,
        }).references,
      ).toEqual([]);
      expect(repo.search.query(r).hits.map((h) => h.id)).toEqual(
        first.hits.map((h) => h.id),
      );
      for (const hit of first.hits)
        expect(searchScore(hit, r.query)).toBe(hit.score);
      expect(repo.search.query({ ...r, query: "" }).hits).toHaveLength(0);
      expect(() =>
        searchScore(
          first.hits[0],
          Array.from({ length: 17 }, (_, i) => "term" + i).join(" "),
        ),
      ).toThrow("16");
    } finally {
      repo.close();
    }
  });
  it("uses stable text targets for starter paragraphs and structured entries", () => {
    const op = demoOperation(armyConfig, randomUUID, new Date().toISOString());
    const docs = operationSearchDocuments(op, armyConfig);
    expect(new Set(docs.map((d) => d.id)).size).toBe(docs.length);
    expect(
      docs.some(
        (d) =>
          d.target.area === "operation" &&
          d.target.target.kind === "base-field",
      ),
    ).toBe(true);
    expect(normalizeSearch("38th / Équipe – 北方")).toBe("38th equipe 北方");
  });
});

describe("working search owner replacement", () => {
  it("replaces whole owners, suppresses deleted saved rows, rejects stale drafts and clears after restore", () => {
    const op = demoOperation(
        starterConfig,
        randomUUID,
        new Date().toISOString(),
      ),
      session = new SearchSession();
    op.tasks[0].name = "Working readiness";
    const docs = operationSearchDocuments(op, starterConfig),
      request = searchRequestSchema.parse({ query: "readiness", sequence: 1 });
    session.setContext(op, starterConfig, op);
    session.register("operation:" + op.id, docs);
    const hits = session.query(request);
    expect(hits.length).toBeGreaterThan(0);
    expect(session.originState(op.id).kind).toBe("saved");
    const changed = structuredClone(op);
    changed.tasks = changed.tasks.filter((t) => t.id !== op.tasks[0].id);
    session.register(
      "operation:" + op.id,
      operationSearchDocuments(changed, starterConfig),
    );
    expect(session.query(request)).toEqual([]);
    expect(session.owners()).toContain("operation:" + op.id);
    expect(() => session.resolve(hits[0])).toThrow("working source changed");
    session.register("operation:" + op.id, []);
    expect(session.owners()).toHaveLength(1);
    session.open(hits[0].target);
    session.clear();
    expect(session.target).toBeNull();
    expect(session.owners()).toEqual([]);
    expect(session.context(op.id)).toBeUndefined();
  });
});
