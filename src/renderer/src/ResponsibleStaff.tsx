import { useState } from "react";
import type { Operation, ResolvedConfig } from "../../domain/model";
import { resolveResponsibleStaff } from "../../domain/staff-resolution";
import { roleLabel } from "./ui-text";
export function ResponsibleStaff({
  op,
  config,
  nodeId,
  change,
  hideLabel = false,
}: {
  op: Operation;
  config: ResolvedConfig;
  nodeId: string | null;
  change: (fn: (draft: Operation) => void) => void;
  hideLabel?: boolean;
}) {
  const [editing, setEditing] = useState(false),
    resolved = resolveResponsibleStaff(op, config, nodeId),
    productId = nodeId
      ? op.attachments.find((a) => a.doctrineNodeId === nodeId)!.id
      : op.orderId;
  const setLegacy = (d: Operation, value: string | null) => {
    if (productId === d.orderId) d.metadata.ownerId = value;
    else
      d.attachments.find((a) => a.id === productId)!.metadata.ownerId = value;
  };
  const restored = structuredClone(op);
  restored.staffPositionOverrides = restored.staffPositionOverrides?.filter(
    (o) => o.productId !== productId,
  );
  setLegacy(restored, null);
  const defaultLabel = resolveResponsibleStaff(restored, config, nodeId).label;
  return (
    <div className="staff-assignment">
      {!hideLabel && <span>Responsible Staff</span>}
      <strong>{resolved.label}</strong>
      <small>
        {resolved.overridden
          ? "Assigned for this operation"
          : resolved.inherited
            ? "Inherited from parent product"
            : resolved.position
              ? "Organization default"
              : "Doctrine default"}
      </small>
      {resolved.doctrineLabel !== resolved.label &&
        (!resolved.overridden || resolved.doctrineLabel !== defaultLabel) && (
          <p className="hint">Doctrine role: {resolved.doctrineLabel}</p>
        )}
      {resolved.position && (
        <details>
          <summary>Position details</summary>
          <p>
            {
              op.operationOrganizationBinding?.staff.sections.find(
                (s) => s.sectionId === resolved.position!.sectionId,
              )?.name
            }
            {resolved.position.rankGrade && ` · ${resolved.position.rankGrade}`}
          </p>
          {resolved.position.incumbent?.name && (
            <p>Person filling this role: {resolved.position.incumbent.name}</p>
          )}
        </details>
      )}
      {resolved.warning && <p className="staff-warning">{resolved.warning}</p>}
      {resolved.overridden && <p>Default: {defaultLabel}</p>}
      <button aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
        {editing ? "Close assignment" : "Change assignment"}
      </button>
      {editing && (
        <>
          <label className="field">
            <span>Organization position override</span>
            <select
              aria-label="Organization position override"
              value={
                op.staffPositionOverrides?.find(
                  (o) => o.productId === productId,
                )?.positionId ?? ""
              }
              onChange={(e) => {
                const p = op.operationOrganizationBinding!.staff.positions.find(
                  (p) => p.positionId === e.target.value,
                );
                change((d) => {
                  d.staffPositionOverrides = (
                    d.staffPositionOverrides ?? []
                  ).filter((o) => o.productId !== productId);
                  setLegacy(d, null);
                  if (p)
                    d.staffPositionOverrides.push({
                      productId,
                      unitProfileVersionId:
                        d.operationOrganizationBinding!.unitProfileVersionId,
                      sectionId: p.sectionId,
                      positionId: p.positionId,
                      functionalRole: p.functionalRole,
                    });
                });
                setEditing(false);
              }}
            >
              <option value="">Use default assignment</option>
              {op.operationOrganizationBinding!.staff.sections.map(
                (section) => (
                  <optgroup key={section.sectionId} label={section.name}>
                    {op
                      .operationOrganizationBinding!.staff.positions.filter(
                        (p) => p.sectionId === section.sectionId,
                      )
                      .map((p) => (
                        <option key={p.positionId} value={p.positionId}>
                          {p.title}
                          {p.functionalRole
                            ? ` · ${roleLabel(p.functionalRole)}`
                            : ""}
                        </option>
                      ))}
                  </optgroup>
                ),
              )}
            </select>
          </label>
          <label className="field">
            <span>Doctrine staff override</span>
            <select
              aria-label="Doctrine staff override"
              value={
                nodeId
                  ? (op.attachments.find((a) => a.id === productId)!.metadata
                      .ownerId ?? "")
                  : (op.metadata.ownerId ?? "")
              }
              onChange={(e) => {
                change((d) => {
                  d.staffPositionOverrides = (
                    d.staffPositionOverrides ?? []
                  ).filter((o) => o.productId !== productId);
                  setLegacy(d, e.target.value || null);
                });
                setEditing(false);
              }}
            >
              <option value="">Use default assignment</option>
              {config.doctrine.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {resolved.overridden && (
        <button
          onClick={() => {
            change((d) => {
              d.staffPositionOverrides = (
                d.staffPositionOverrides ?? []
              ).filter((o) => o.productId !== productId);
              setLegacy(d, null);
            });
            setEditing(false);
          }}
        >
          Restore default
        </button>
      )}
    </div>
  );
}
