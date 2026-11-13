import type { Repository } from "./ports";
import type { DocumentComparison } from "../domain/document-review";
import type { Operation } from "../domain/model";
import { resolveSchedule, timelineLanes } from "../domain/planning-schedule";

export function scheduleChanges(before: Operation, after: Operation) {
  const changes: {
    entityId: string;
    label: string;
    field: string;
    before: string;
    after: string;
  }[] = [];
  const add = (
    entityId: string,
    label: string,
    field: string,
    a: string,
    b: string,
  ) => {
    if (a !== b) changes.push({ entityId, label, field, before: a, after: b });
  };
  const oldTimes = resolveSchedule(before),
    newTimes = resolveSchedule(after);
  const oldLanes = new Map(
    timelineLanes(before).map((lane) => [lane.id, lane]),
  );
  const newLanes = new Map(timelineLanes(after).map((lane) => [lane.id, lane]));
  add(
    after.id,
    "Timeline",
    "D-Day",
    before.timeline?.dDay ?? "Not set",
    after.timeline?.dDay ?? "Not set",
  );
  for (const id of new Set([...oldLanes.keys(), ...newLanes.keys()])) {
    const a = oldLanes.get(id),
      b = newLanes.get(id);
    add(
      after.id,
      "Timeline",
      "Lane",
      a ? `${a.name} (${a.color})` : "Not present",
      b ? `${b.name} (${b.color})` : "Not present",
    );
  }
  for (const id of [
    ...new Set([...before.events, ...after.events].map((e) => e.id)),
  ].sort()) {
    const a = before.events.find((e) => e.id === id),
      b = after.events.find((e) => e.id === id),
      label = b?.name ?? a!.name;
    if (
      !a?.schedule &&
      !b?.schedule &&
      oldTimes.get(id)?.start === newTimes.get(id)?.start
    )
      continue;
    add(
      id,
      label,
      "Duration",
      a ? `${a.schedule?.durationMinutes ?? 0} minutes` : "Not present",
      b ? `${b.schedule?.durationMinutes ?? 0} minutes` : "Not present",
    );
    add(
      id,
      label,
      "Scheduled unit",
      before.units.find((u) => u.id === a?.schedule?.unitId)?.name ??
        "Unassigned",
      after.units.find((u) => u.id === b?.schedule?.unitId)?.name ??
        "Unassigned",
    );
    if (a?.schedule?.laneId || b?.schedule?.laneId)
      add(
        id,
        label,
        "Timeline lane",
        oldLanes.get(a?.schedule?.laneId ?? "")?.name ?? "Unsorted events",
        newLanes.get(b?.schedule?.laneId ?? "")?.name ?? "Unsorted events",
      );
    add(
      id,
      label,
      "Scheduling relationship",
      a?.relativeToEventId
        ? `${before.events.find((e) => e.id === a.relativeToEventId)?.name ?? "Missing event"} ${a.schedule?.relativeAnchor === "END" ? "finish" : "start"}, ${a.offsetMinutes} minutes`
        : "Absolute time",
      b?.relativeToEventId
        ? `${after.events.find((e) => e.id === b.relativeToEventId)?.name ?? "Missing event"} ${b.schedule?.relativeAnchor === "END" ? "finish" : "start"}, ${b.offsetMinutes} minutes`
        : "Absolute time",
    );
    const time = (value: number | null | undefined) =>
      value == null ? "Unscheduled" : new Date(value).toISOString();
    add(
      id,
      label,
      "Resolved start",
      time(oldTimes.get(id)?.start),
      time(newTimes.get(id)?.start),
    );
    add(
      id,
      label,
      "Resolved finish",
      time(oldTimes.get(id)?.end),
      time(newTimes.get(id)?.end),
    );
  }
  for (const id of [
    ...new Set(
      [
        ...(before.planningProgress?.products ?? []),
        ...(after.planningProgress?.products ?? []),
      ].map((p) => p.productId),
    ),
  ].sort()) {
    const a = before.planningProgress?.products.find((p) => p.productId === id),
      b = after.planningProgress?.products.find((p) => p.productId === id),
      label =
        id === after.orderId
          ? "Base order"
          : (after.attachments.find((p) => p.id === id)?.name ??
            before.attachments.find((p) => p.id === id)?.name ??
            "Removed product");
    add(
      id,
      label,
      "Writing due date",
      a?.dueAt ?? "No due date",
      b?.dueAt ?? "No due date",
    );
    add(
      id,
      label,
      "Writing ready",
      a?.readyAt ?? "Not marked Ready",
      b?.readyAt ?? "Not marked Ready",
    );
  }
  return { schemaVersion: 1 as const, changes };
}

export function planningScheduleComparison(
  repo: Repository,
  comparison: DocumentComparison,
) {
  const resolve = (endpoint: DocumentComparison["baseline"]) =>
    repo.resolveEndpoint(
      endpoint.kind === "PUBLICATION"
        ? {
            kind: "PUBLICATION",
            operationId: endpoint.operationId,
            publicationId: endpoint.publicationId!,
          }
        : {
            kind: "REVISION",
            operationId: endpoint.operationId,
            revisionId: endpoint.revisionId,
          },
    ).operation;
  return scheduleChanges(
    resolve(comparison.baseline),
    resolve(comparison.target),
  );
}
