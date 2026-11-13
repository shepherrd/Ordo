import { diffV1 } from "./v1";
import {
  canonicalValue,
  semanticValue,
  changeSchema,
  fingerprintId,
  type Hash,
  type ResolvedEndpoint,
  type ChangeRecord,
} from "./model";
export function diffV2(
  a: ResolvedEndpoint,
  b: ResolvedEndpoint,
  hash: Hash,
): ChangeRecord[] {
  const legacy = (e: ResolvedEndpoint) => {
    const o = structuredClone(e.operation);
    delete o.operationOrganizationBinding;
    delete o.staffPositionOverrides;
    for (const u of o.units) {
      delete u.sourceUnitProfile;
      delete u.profileIdentity;
    }
    return { ...e, operation: o };
  };
  const records = diffV1(legacy(a), legacy(b), hash);
  const emit = (
    entityType: string,
    entityId: string,
    category: ChangeRecord["category"],
    field: string,
    before: unknown,
    after: unknown,
    label: string,
    page: ChangeRecord["location"]["page"],
    productId: string | null = null,
  ) => {
    if (canonicalValue(before ?? null) === canonicalValue(after ?? null))
      return;
    records.push(
      changeSchema.parse({
        changeId: entityId,
        semanticFingerprint: "0".repeat(64),
        changeType: "CONFIGURATION_CHANGED",
        category,
        operationId: a.operation.id,
        entityType,
        entityId,
        productId,
        moduleInstanceId: null,
        moduleDefinitionId: null,
        fieldPath: field,
        humanSummary: label,
        beforeValue: semanticValue(before ?? null),
        afterValue: semanticValue(after ?? null),
        beforeDisplay: before ? JSON.stringify(before, null, 2) : "Not set",
        afterDisplay: after ? JSON.stringify(after, null, 2) : "Not set",
        sourceLabel: label,
        targetLabel: label,
        directProductReferences: productId ? [productId] : [],
        canonicalEntityReferences: [`${entityType}:${entityId}`],
        location: { page, id: productId ?? entityId, moduleInstanceId: null },
        detailKind: "value",
      }),
    );
  };
  emit(
    "operation",
    a.operation.id,
    "OPERATION_METADATA",
    "operationOrganizationBinding",
    a.operation.operationOrganizationBinding,
    b.operation.operationOrganizationBinding,
    "Pinned organization configuration",
    "overview",
  );
  for (const unitId of new Set(
    [...a.operation.units, ...b.operation.units].map((u) => u.id),
  )) {
    const x = a.operation.units.find((u) => u.id === unitId),
      y = b.operation.units.find((u) => u.id === unitId);
    for (const field of ["sourceUnitProfile", "profileIdentity"] as const)
      emit(
        "unit",
        unitId,
        "TASK_ORGANIZATION",
        `units/${unitId}/${field}`,
        x?.[field],
        y?.[field],
        `${y?.name ?? x?.name}: ${field === "sourceUnitProfile" ? "Unit Profile provenance" : "Unit identity"}`,
        "units",
      );
  }
  for (const productId of new Set(
    [
      ...(a.operation.staffPositionOverrides ?? []),
      ...(b.operation.staffPositionOverrides ?? []),
    ].map((o) => o.productId),
  )) {
    const x = a.operation.staffPositionOverrides?.find(
        (o) => o.productId === productId,
      ),
      y = b.operation.staffPositionOverrides?.find(
        (o) => o.productId === productId,
      ),
      base = productId === a.operation.orderId;
    emit(
      base ? "base" : "product",
      productId,
      "RESPONSIBLE_STAFF",
      `staffPositionOverrides/${productId}`,
      x,
      y,
      "Operational staff-position override",
      base ? "base" : "attachment",
      productId,
    );
  }
  return records.map((c) => {
    const semanticFingerprint = hash(
      canonicalValue({
        engine: "diff-engine-v2",
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
