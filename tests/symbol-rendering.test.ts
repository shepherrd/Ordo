import { expect, it } from "vitest";
import { randomUUID as uid } from "node:crypto";
import { newOrbatLayout } from "../src/domain/orbat";
import {
  planTreeDrop,
  reorderSibling,
  subtreeIds,
} from "../src/domain/organization-editing";
import {
  deleteOperationSubtree,
  moveOperationSubtree,
} from "../src/domain/organization-actions";
import { newSymbolDefinition } from "../src/domain/symbology";
import {
  resetSymbolDraft,
  changeSymbolSet,
} from "../src/domain/symbol-editing";
import { demoOperation } from "../src/demo/operation";
import { starterConfig } from "../src/config/profiles";
import { SqliteRepository } from "../src/persistence/repository";
import { SymbologyService } from "../src/application/symbology-service";
import { resetOrbatComposition } from "../src/domain/orbat-actions";
import { symbolCatalog } from "../src/rendering/symbol-catalog";

const tree = () => {
  const [root, a, b, childA, childB] = Array.from({ length: 5 }, uid);
  return {
    root,
    a,
    b,
    childA,
    childB,
    nodes: [
      { id: root, parentId: null },
      { id: a, parentId: root },
      { id: b, parentId: root },
      { id: childA, parentId: a },
      { id: childB, parentId: b },
    ],
    layout: newOrbatLayout(uid),
  };
};
it("moves a subtree onto an occupied parent without replacing either branch", () => {
  const t = tree(),
    original = structuredClone(t.nodes);
  const m = planTreeDrop(t.nodes, t.layout, t.a, t.b, "CHILD", t.root);
  expect(m.parentId).toBe(t.b);
  expect(t.nodes).toEqual(original);
  expect(subtreeIds(t.nodes, t.a)).toEqual(new Set([t.a, t.childA]));
  expect(m.layout.siblingOrder).toHaveLength(5);
  expect(new Set(m.layout.siblingOrder).size).toBe(5);
});
it("rejects self, descendants, missing targets and moving the saved root", () => {
  const t = tree();
  for (const target of [t.a, t.childA])
    expect(() =>
      planTreeDrop(t.nodes, t.layout, t.a, target, "CHILD", t.root),
    ).toThrow(/itself|descendants/);
  expect(() =>
    planTreeDrop(t.nodes, t.layout, t.root, t.b, "BEFORE", t.root),
  ).toThrow(/root/);
  expect(() => planTreeDrop(t.nodes, t.layout, t.a, uid(), "CHILD")).toThrow(
    /Destination/,
  );
  expect(() =>
    planTreeDrop(t.nodes, t.layout, t.a, t.root, "BEFORE", t.root),
  ).toThrow(/root/);
});
it("sibling ordering changes only presentation and respects existing order", () => {
  const t = tree(),
    nodes = structuredClone(t.nodes);
  const before = reorderSibling(t.nodes, t.layout, t.b, -1);
  expect(before.siblingOrder.indexOf(t.b)).toBeLessThan(
    before.siblingOrder.indexOf(t.a),
  );
  const after = reorderSibling(t.nodes, before, t.b, 1);
  expect(after.siblingOrder.indexOf(t.a)).toBeLessThan(
    after.siblingOrder.indexOf(t.b),
  );
  expect(t.nodes).toEqual(nodes);
  expect(reorderSibling(t.nodes, before, t.b, -1)).toBe(before);
});
it("keeps names, IDs, references and unrelated units when moving canonical operation data", () => {
  const op = demoOperation(starterConfig, uid, new Date().toISOString());
  const original = structuredClone(op),
    [a, b] = op.units;
  b.parentUnitId = null;
  const next = moveOperationSubtree(op, b.id, a.id, "CHILD");
  expect(next.units.find((u) => u.id === b.id)?.parentUnitId).toBe(a.id);
  expect(next.units.map((u) => u.id)).toEqual(original.units.map((u) => u.id));
  expect(next.tasks).toEqual(op.tasks);
  expect(op.units[1].parentUnitId).toBeNull();
});
it("blocks subtree deletion when authoritative planning references would dangle", () => {
  const op = demoOperation(starterConfig, uid, new Date().toISOString());
  const target = op.tasks.find((t) => t.unitId)?.unitId;
  expect(target).toBeTruthy();
  const before = structuredClone(op);
  expect(() => deleteOperationSubtree(op, target!, starterConfig)).toThrow(
    /blocked/,
  );
  expect(op).toEqual(before);
});
it.each([20, 30])(
  "reset keeps numeric prefix, stable identity and explicit render profile (%i digits)",
  (length) => {
    const d = newSymbolDefinition(uid);
    d.code.sidc = d.code.sidc.slice(0, length);
    d.renderProfile.version = 2;
    d.amplifiers.uniqueDesignation = "FICTIONAL";
    d.compatibility.flagId = "US";
    const n = resetSymbolDraft(d);
    expect(n.code.sidc).toBe(d.code.sidc.slice(0, 6) + "0".repeat(length - 6));
    expect(n.definitionId).toBe(d.definitionId);
    expect(n.renderProfile).toEqual(d.renderProfile);
    expect(n.amplifiers.uniqueDesignation).toBeUndefined();
    expect(d.compatibility.flagId).toBe("US");
  },
);
it("legacy reset retains the legacy dialect without using conversion mappings", () => {
  const d = newSymbolDefinition(uid);
  d.code = {
    dialect: "LETTER",
    sidc: "SFGPUCI-----USG",
    assertedStandard: "UNVERIFIED",
    sourceConvention: "LETTER_CODE",
  };
  const n = resetSymbolDraft(d);
  expect(n.code.sidc).toBe("SFGPU----------");
  expect(n.code.dialect).toBe("LETTER");
});
it("set changes clear sector extensions without losing labels, identity or frame shape", () => {
  const d = newSymbolDefinition(uid);
  d.code.sidc = "130310000012110012343450000000";
  d.amplifiers.uniqueDesignation = "FICTIONAL";
  const n = changeSymbolSet(d, "20");
  expect(n.code.sidc.slice(4, 6)).toBe("20");
  expect(n.code.sidc.slice(8, 22)).toBe("0".repeat(14));
  expect(n.code.sidc.slice(22)).toBe(d.code.sidc.slice(22));
  expect(n.amplifiers).toEqual(d.amplifiers);
  expect(n.definitionId).toBe(d.definitionId);
});
it("root reset keeps identity and symbol while atomically removing descendants and layout hints", () => {
  const repo = new SqliteRepository(":memory:");
  const lib = new SymbologyService(repo, {
    id: uid,
    now: () => new Date().toISOString(),
    actor: "Fictional test",
  });
  const v = lib.execute({
      type: "new",
      kind: "ORBAT",
      name: "FICTIONAL",
    }).orbat!,
    root = structuredClone(v.nodes[0]);
  repo.close();
  const id = uid();
  v.nodes.push({
    ...structuredClone(root),
    nodeId: id,
    parentNodeId: v.rootNodeId,
  });
  v.layout.siblingOrder = [id, v.rootNodeId];
  v.layout.hints = [
    { nodeId: id, offset: { x: 10, y: 5 }, hqStaff: false, folded: true },
  ];
  const reset = resetOrbatComposition(v);
  expect(reset.nodes).toEqual([root]);
  expect(reset.layout.hints).toEqual([]);
  expect(reset.layout.siblingOrder).toEqual([]);
  expect(v.nodes).toHaveLength(2);
});
it("searches pinned main-icon metadata across sets with explicit set identity and bounded pages", () => {
  const r = symbolCatalog({
    type: "main-search",
    search: "",
    offset: 0,
    limit: 50,
  });
  expect(r.total).toBeGreaterThan(50);
  expect(r.choices).toHaveLength(50);
  expect(
    r.choices?.every(
      (c) => /^\d{2}$/.test(c.symbolSet ?? "") && /^\d{6}$/.test(c.id),
    ),
  ).toBe(true);
  const later = symbolCatalog({
    type: "main-search",
    search: "",
    offset: 50,
    limit: 50,
  });
  expect(later.choices).not.toEqual(r.choices);
  expect(() =>
    symbolCatalog({ type: "main-search", search: "", offset: 0, limit: 101 }),
  ).toThrow();
});
