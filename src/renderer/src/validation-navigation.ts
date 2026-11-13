import type { Finding, Operation, ResolvedConfig } from "../../domain/model";
export function findingLocation(
  f: Finding,
  op: Operation,
  config: ResolvedConfig,
) {
  const module = op.modules?.instances.find(
    (m) => m.moduleInstanceId === f.entityId,
  );
  const attachment = op.attachments.find(
    (a) => a.id === (module?.productInstanceId ?? f.entityId),
  );
  const nodeId =
    attachment?.doctrineNodeId ??
    config.doctrine.catalog?.nodes.find((n) => n.id === f.entityId)?.id;
  const page = nodeId
    ? "doctrine"
    : attachment
      ? "attachment"
      : module
        ? "base"
        : op.units.some((e) => e.id === f.entityId)
          ? "units"
          : [...op.tasks, ...op.objectives].some((e) => e.id === f.entityId)
            ? "tasks"
            : op.phases.some((e) => e.id === f.entityId)
              ? "phases"
              : op.events.some((e) => e.id === f.entityId)
                ? "events"
                : [...op.signal.nets, ...op.signal.pacePlans].some(
                      (e) => e.id === f.entityId,
                    )
                  ? "signal"
                  : f.category === "configuration" ||
                      f.ruleId === "managed-asset"
                    ? "settings"
                    : "base";
  const labels: Record<string, string> = {
    unitId: "Assigned unit",
    purpose: page === "signal" ? "Net purpose" : "Purpose",
    objectiveId: "Objective",
    phaseId: page === "events" ? "Event phase" : "Phase",
    parentUnitId: "Parent unit",
    relativeToEventId: "Relative to event",
    offsetMinutes: "Offset in minutes",
    at: "Absolute time (UTC)",
    participantUnitIds: "Participants",
    phaseIds: "Applicable phases",
    unitIds: "Applicable units",
    ownerId: "Staff owner",
    applicability: "Applicability",
  };
  return {
    page,
    id: nodeId ?? attachment?.id ?? f.entityId,
    anchor: module
      ? `[data-module-id="${module.moduleInstanceId}"]`
      : f.ruleId === "base-summary"
        ? `[data-paragraph-id="${f.field}"]`
        : `[data-entity-id="${f.entityId}"]`,
    label: labels[f.field],
  } as const;
}
