import { diffV2 } from "./v2";
import { withoutM6 } from "./m6-state";
import {
  canonicalValue,
  semanticValue,
  fingerprintId,
  changeSchema,
  type ChangeRecord,
  type Hash,
  type ResolvedEndpoint,
} from "./model";
import type { MilitarySymbolDefinition } from "../symbology";

const appearance = (d: MilitarySymbolDefinition | undefined) =>
  d
    ? {
        code: { dialect: d.code.dialect, sidc: d.code.sidc },
        amplifiers: d.amplifiers,
        appearance: d.appearance,
        compatibility: d.compatibility,
        renderProfile: d.renderProfile,
      }
    : null;
const provenance = (
  s:
    | { definition: MilitarySymbolDefinition; source: unknown }
    | undefined
    | null,
) =>
  s
    ? {
        definitionId: s.definition.definitionId,
        origin: s.definition.origin,
        source: s.source,
        assertedStandard: s.definition.code.assertedStandard,
        sourceConvention: s.definition.code.sourceConvention,
      }
    : null;
export function diffV3(
  a: ResolvedEndpoint,
  b: ResolvedEndpoint,
  hash: Hash,
): ChangeRecord[] {
  const records = diffV2(withoutM6(a), withoutM6(b), hash);
  const emit = (
    kind: NonNullable<ChangeRecord["m6Kind"]>,
    category: ChangeRecord["category"],
    entityType: string,
    id: string,
    field: string,
    before: unknown,
    after: unknown,
    label: string,
    productId: string | null = null,
  ) => {
    if (canonicalValue(before) === canonicalValue(after)) return;
    records.push(
      changeSchema.parse({
        changeId: id,
        semanticFingerprint: "0".repeat(64),
        m6Kind: kind,
        changeType:
          before == null ? "ADDED" : after == null ? "REMOVED" : "MODIFIED",
        category,
        operationId: a.operation.id,
        entityType,
        entityId: id,
        productId,
        moduleInstanceId: entityType === "module" ? id : null,
        moduleDefinitionId: null,
        fieldPath: field,
        humanSummary: label,
        beforeValue: semanticValue(before),
        afterValue: semanticValue(after),
        beforeDisplay:
          before == null ? "Not set" : JSON.stringify(before, null, 2),
        afterDisplay:
          after == null ? "Not set" : JSON.stringify(after, null, 2),
        sourceLabel: label,
        targetLabel: label,
        directProductReferences: productId ? [productId] : [],
        canonicalEntityReferences: [`${entityType}:${id}`],
        location: {
          page:
            entityType === "module"
              ? productId === a.operation.orderId
                ? "base"
                : "attachment"
              : "units",
          id: productId ?? id,
          moduleInstanceId: entityType === "module" ? id : null,
        },
        detailKind: "value",
      }),
    );
  };
  for (const id of new Set(
    [...a.operation.units, ...b.operation.units].map((u) => u.id),
  )) {
    const x = a.operation.units.find((u) => u.id === id),
      y = b.operation.units.find((u) => u.id === id),
      name = y?.name ?? x!.name;
    for (const field of ["base", "override"] as const) {
      emit(
        field === "base" ? "SYMBOL_BASE" : "SYMBOL_OVERRIDE",
        "SYMBOL",
        "unit",
        id,
        `units/${id}/symbol/${field}/definition`,
        appearance(x?.symbol?.[field]?.definition),
        appearance(y?.symbol?.[field]?.definition),
        `${name}: ${field} symbol definition`,
      );
      emit(
        "SYMBOL_PROVENANCE",
        "PROVENANCE",
        "unit",
        id,
        `units/${id}/symbol/${field}/provenance`,
        provenance(x?.symbol?.[field]),
        provenance(y?.symbol?.[field]),
        `${name}: ${field} symbol provenance`,
      );
    }
    for (const key of ["uniqueDesignation", "higherFormation"] as const)
      emit(
        "SYMBOL_BINDING",
        "SYMBOL",
        "unit",
        id,
        `units/${id}/symbol/labels/${key}`,
        x?.symbol?.labels[key],
        y?.symbol?.labels[key],
        `${name}: ${key} label binding`,
      );
    emit(
      "ORBAT_SOURCE",
      "PROVENANCE",
      "unit",
      id,
      `units/${id}/sourceOrbat`,
      x?.sourceOrbat,
      y?.sourceOrbat,
      `${name}: Saved ORBAT import provenance`,
    );
  }
  const layouts = [a.operation.orbatLayout, b.operation.orbatLayout];
  const orders = [a.operation.units, b.operation.units].map((units) =>
    units.map((u) => u.id),
  );
  if (
    canonicalValue([...orders[0]].sort()) ===
    canonicalValue([...orders[1]].sort())
  )
    emit(
      "ORBAT_LAYOUT",
      "PRESENTATION",
      "operation",
      a.operation.id,
      "units/presentationOrder",
      orders[0],
      orders[1],
      "ORBAT fallback sibling presentation order",
    );
  for (const field of [
    "layoutId",
    "algorithm",
    "mode",
    "commandLevels",
    "labelProfile",
    "siblingOrder",
  ] as const)
    emit(
      "ORBAT_LAYOUT",
      "PRESENTATION",
      "operation",
      a.operation.id,
      `orbatLayout/${field}`,
      layouts[0]?.[field],
      layouts[1]?.[field],
      `ORBAT presentation: ${field}`,
    );
  for (const id of new Set(
    layouts.flatMap((l) => l?.hints.map((h) => h.nodeId) ?? []),
  ))
    emit(
      "ORBAT_LAYOUT",
      "PRESENTATION",
      "operation",
      a.operation.id,
      `orbatLayout/hints/${id}`,
      layouts[0]?.hints.find((h) => h.nodeId === id),
      layouts[1]?.hints.find((h) => h.nodeId === id),
      `ORBAT presentation hint: ${id}`,
    );
  for (const id of new Set(
    [
      ...(a.operation.modules?.instances ?? []),
      ...(b.operation.modules?.instances ?? []),
    ].map((m) => m.moduleInstanceId),
  )) {
    const x = a.operation.modules?.instances.find(
        (m) => m.moduleInstanceId === id,
      ),
      y = b.operation.modules?.instances.find((m) => m.moduleInstanceId === id);
    const p = (m: typeof x) =>
      m?.content.type === "TASK_ORGANIZATION"
        ? m.content.presentation
        : undefined;
    emit(
      "PRODUCT_PRESENTATION",
      "PRESENTATION",
      "module",
      id,
      `modules/${id}/presentation`,
      p(x),
      p(y),
      "Task Organization product presentation",
      (y ?? x)!.productInstanceId,
    );
  }
  return records.map((c) => {
    const semanticFingerprint = hash(
      canonicalValue({
        engine: "diff-engine-v3",
        entityType: c.entityType,
        entityId: c.entityId,
        module: c.moduleInstanceId,
        field: c.fieldPath,
        type: c.changeType,
        before: c.beforeValue,
        after: c.afterValue,
      }),
    );
    return {
      ...c,
      semanticFingerprint,
      changeId: fingerprintId(semanticFingerprint),
    };
  });
}
