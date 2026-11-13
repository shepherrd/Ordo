import type { Operation, ResolvedConfig, Finding } from "../domain/model";
import { authoringFindings } from "../domain/authoring";
import { moduleFindings } from "../domain/module-authoring";
import { planningCardFindings } from "../domain/planning-card-validation";
import { resolveResponsibleStaff } from "../domain/staff-resolution";
type Rule = (
  op: Operation,
  config: ResolvedConfig,
) => Omit<Finding, "revision" | "ruleId">[];
const rules: Record<string, Rule> = {
  "task-unit": (op) =>
    op.tasks
      .filter((t) => !t.unitId || !op.units.some((u) => u.id === t.unitId))
      .map((t) => ({
        severity: "error",
        category: "relationships",
        entityId: t.id,
        field: "unitId",
        message: !t.unitId
          ? `Task “${t.name}” is an incomplete draft: assign a unit before approval.`
          : `Task “${t.name}” references a unit outside this operation or a missing unit.`,
      })),
  "task-purpose": (op) =>
    op.tasks
      .filter((t) => !t.purpose.trim())
      .map((t) => ({
        severity: "warning",
        category: "completeness",
        entityId: t.id,
        field: "purpose",
        message: `Task “${t.name}” needs a purpose.`,
      })),
  "net-task-organization": (op) =>
    op.signal.nets.flatMap((n) =>
      n.participantUnitIds
        .filter(
          (id) => !op.units.some((u) => u.id === id && u.inTaskOrganization),
        )
        .map((id) => ({
          severity: "error" as const,
          category: "relationships",
          entityId: n.id,
          field: "participantUnitIds",
          message: `Net “${n.name}” includes ${op.units.find((u) => u.id === id)?.name ?? id}, which is absent from task organization.`,
        })),
    ),
  "base-summary": (op, config) =>
    config.doctrine.paragraphs
      .filter(
        (p) =>
          p.required &&
          !op.sections.find((s) => s.id === p.id)?.summary.trim() &&
          !op.authoring?.fields.some(
            (f) =>
              config.doctrine.catalog?.baseFields.some(
                (d) => d.id === f.fieldId && d.paragraphId === p.id,
              ) &&
              (f.text.trim() ||
                f.references.length ||
                f.entries?.some((e) => e.value.trim())),
          ),
      )
      .map((p) => ({
        severity: "warning",
        category: "completeness",
        entityId: op.orderId,
        field: p.id,
        message: `The base order needs a ${p.title} summary even when an annex supplies detail.`,
      })),
};
export function validate(op: Operation, config: ResolvedConfig): Finding[] {
  const organizationFindings: Finding[] = op.operationOrganizationBinding
    ? op.attachments.flatMap((a) => {
        if (!a.doctrineNodeId || a.applicability !== "INCLUDED") return [];
        const r = resolveResponsibleStaff(op, config, a.doctrineNodeId);
        return r.warning
          ? [
              {
                ruleId: "organization-staff-resolution",
                severity: "warning" as const,
                category: "Responsible Staff",
                entityId: a.id,
                field: "ownerId",
                message: `${a.name}: ${r.warning}`,
                revision: op.revision,
              },
            ]
          : [];
      })
    : [];
  return [
    ...organizationFindings,
    ...moduleFindings(op, config),
    ...planningCardFindings(op, config),
    ...authoringFindings(op, config),
    ...relationshipFindings(op),
    ...config.doctrine.validationRuleIds.flatMap((ruleId) => {
      const rule = rules[ruleId];
      if (!rule)
        return [
          {
            ruleId,
            severity: "error" as const,
            category: "configuration",
            entityId: config.doctrine.id,
            field: "validationRuleIds",
            message: `Unsupported validation rule: ${ruleId}`,
            revision: op.revision,
          },
        ];
      return rule(op, config).map((f) => ({
        ...f,
        ruleId,
        revision: op.revision,
      }));
    }),
  ];
}

// Structural integrity is mandatory even when doctrine omits a content rule.
// Findings explain rejected draft links; persistence independently rejects them.
function relationshipFindings(op: Operation): Finding[] {
  const findings: Finding[] = [];
  const report = (entityId: string, field: string, message: string) =>
    findings.push({
      ruleId: "structural-integrity",
      severity: "error",
      category: "relationships",
      entityId,
      field,
      message,
      revision: op.revision,
    });
  const links = (
    entity: { id: string; name: string },
    field: string,
    ids: (string | null)[],
    targets: { id: string }[],
  ) => {
    for (const id of ids)
      if (id && !targets.some((t) => t.id === id))
        report(
          entity.id,
          field,
          `“${entity.name}” references ${id} in ${field}, which is missing or outside this operation.`,
        );
  };
  for (const t of op.tasks) {
    links(t, "objectiveId", [t.objectiveId], op.objectives);
    links(t, "phaseId", [t.phaseId], op.phases);
  }
  for (const u of op.units)
    links(u, "parentUnitId", [u.parentUnitId], op.units);
  for (const e of op.events) {
    links(e, "relativeToEventId", [e.relativeToEventId], op.events);
    links(e, "phaseId", [e.phaseId], op.phases);
  }
  for (const n of op.signal.nets) {
    links(n, "participantUnitIds", n.participantUnitIds, op.units);
    links(n, "phaseIds", n.phaseIds, op.phases);
  }
  for (const a of [...op.attachments, ...op.signal.pacePlans]) {
    links(a, "unitIds", a.unitIds, op.units);
    links(a, "phaseIds", a.phaseIds, op.phases);
  }
  for (const a of op.attachments) {
    const expected = {
      annex: "order",
      appendix: "annex",
      tab: "appendix",
      exhibit: "tab",
    }[a.kind];
    const actual =
      a.parentId === op.orderId
        ? "order"
        : op.attachments.find((p) => p.id === a.parentId)?.kind;
    if (actual !== expected)
      report(
        a.id,
        "parentId",
        `“${a.name}” is a ${a.kind} and must belong to a ${expected} in this operation.`,
      );
  }
  return findings;
}
