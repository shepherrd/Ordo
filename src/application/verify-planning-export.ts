import type { ExportRecord, Operation } from "../domain/model";
import { canonical } from "../export/projection";
import { projectPlanningCards } from "../export/planning-cards";
import { verifyOrderGraphics } from "./order-graphics";
export function verifyPlanningExport(
  record: Extract<ExportRecord, { schemaVersion: 7 }>,
  source: Operation,
  hash: (text: string) => string,
) {
  const projected = projectPlanningCards(source, record.profile, record.config);
  if (
    canonical(projected.dependencies) !== canonical(record.dependencies) ||
    canonical(record.documentLayout) !==
      canonical(source.metadata.documentLayout) ||
    hash(record.html) !== record.htmlHash
  )
    throw Error("Retained planning card export differs from its source");
  verifyOrderGraphics(projected.view, record.graphics, hash);
  for (const section of projected.view.sections)
    if (
      section.moduleHtml?.includes("order-planning-card") &&
      !record.html.includes(section.moduleHtml)
    )
      throw Error("Retained HTML differs from its resolved planning cards");
  for (const graphic of record.graphics)
    if (
      !record.html.includes(
        `<div class="task-organization-graphic">${graphic.svg}</div>`,
      )
    )
      throw Error("Retained HTML differs from its graphic bytes");
}
export function planningExportStaleness(
  record: Extract<ExportRecord, { schemaVersion: 7 }>,
  current: Operation,
) {
  if (record.operationId !== current.id)
    throw Error("Wrong operation for staleness comparison");
  try {
    const now = projectPlanningCards(
      current,
      record.profile,
      record.config,
    ).dependencies;
    const previous = new Map(
        record.dependencies.map((d) => [d.path, d.canonicalValue]),
      ),
      next = new Map(now.map((d) => [d.path, d.canonicalValue]));
    const changedPaths = [
      ...new Set([...previous.keys(), ...next.keys()]),
    ].filter((p) => previous.get(p) !== next.get(p));
    if (
      canonical(record.documentLayout) !==
      canonical(current.metadata.documentLayout)
    )
      changedPaths.push("document/layout");
    return {
      outdated: !!changedPaths.length,
      changedPaths,
      compatibility: "supported" as const,
    };
  } catch {
    return {
      outdated: true,
      changedPaths: ["cards/unresolved-source"],
      compatibility: "supported" as const,
    };
  }
}
