// Version 2 adds explicit Net-name inclusion. Retain v1 for historical artifacts.
import { assertExportScope, eventTime } from "../../domain/invariants";
import type {
  Operation,
  ExportProfile,
  ResolvedConfig,
  Dependency,
  ExportRecord,
} from "../../domain/model";

export function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
export interface ProductView {
  title: string;
  detail: ExportProfile["rendering"]["detail"];
  operationName: string;
  orderNumber: string;
  demo: boolean;
  sections: { title: string; text?: string; rows?: Record<string, string>[] }[];
}
export function projectV2(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
): { view: ProductView; dependencies: Dependency[] } {
  assertExportScope(
    op,
    profile.product === "communications-card"
      ? {
          ...profile,
          inclusion: {
            ...profile.inclusion,
            paragraphIds: [],
            attachmentIds: [],
          },
        }
      : profile,
  );
  const dependencies: Dependency[] = [];
  const track = <T>(path: string, value: T): T => {
    dependencies.push({ path, canonicalValue: canonical(value) });
    return value;
  };
  const view: ProductView = {
    title: profile.rendering.title,
    detail: profile.rendering.detail,
    operationName: track("operation/name", op.name),
    orderNumber: track("operation/orderNumber", op.orderNumber),
    demo: track("operation/demo", op.demo),
    sections: [],
  };
  const inc = profile.inclusion;
  const applies = (units: string[], phases: string[]) =>
    (!inc.audienceUnitIds.length ||
      !units.length ||
      units.some((id) => inc.audienceUnitIds.includes(id))) &&
    (!inc.phaseIds.length ||
      !phases.length ||
      phases.some((id) => inc.phaseIds.includes(id)));
  const unitName = (id: string) =>
    track(
      `units/${id}/name`,
      op.units.find((u) => u.id === id)?.name ?? "Missing unit",
    );
  const phaseName = (id: string) =>
    track(
      `phases/${id}/name`,
      op.phases.find((p) => p.id === id)?.name ?? "Missing phase",
    );
  const scope = [
    inc.audienceUnitIds.length
      ? inc.audienceUnitIds.map(unitName).join(", ")
      : "Entire force",
    inc.phaseIds.length ? inc.phaseIds.map(phaseName).join(", ") : "All phases",
  ].join(" · ");
  view.sections.push({ title: "Scope", text: scope });
  const nets = op.signal.nets.filter(
    (n) =>
      (!inc.netIds.length || inc.netIds.includes(n.id)) &&
      applies(n.participantUnitIds, n.phaseIds),
  );
  const netRows = (full: boolean) => {
    track(
      "selection/radio-nets",
      nets.map((n) => n.id),
    );
    return nets.map((n) => {
      const row: Record<string, string> = {
        ...(full || inc.includeNetName !== false
          ? { Net: track(`nets/${n.id}/name`, n.name) }
          : {}),
      };
      for (const f of full
        ? ["purpose", "participants", "system", "channel", "callsign"]
        : inc.netFields) {
        if (f === "participants")
          row.Participants = track(
            `nets/${n.id}/participantUnitIds`,
            n.participantUnitIds,
          )
            .map(unitName)
            .join(", ");
        else
          row[f.charAt(0).toUpperCase() + f.slice(1)] = track(
            `nets/${n.id}/${f}`,
            n[f as "purpose" | "system" | "channel" | "callsign"],
          );
      }
      return row;
    });
  };
  const paceSections = (full: boolean) => {
    if (!full && !inc.includePace && !inc.includeLostCommunications) return;
    const plans = op.signal.pacePlans.filter((p) =>
      applies(p.unitIds, p.phaseIds),
    );
    track(
      "selection/pace-plans",
      plans.map((p) => p.id),
    );
    for (const p of plans) {
      const name = track(`pace/${p.id}/name`, p.name);
      if (full || inc.includePace)
        view.sections.push({
          title: name,
          rows: ["primary", "alternate", "contingency", "emergency"].map(
            (key) => ({
              Priority: key,
              Method: track(
                `pace/${p.id}/${key}`,
                p[key as "primary" | "alternate" | "contingency" | "emergency"],
              ),
            }),
          ),
        });
      if (full || inc.includeLostCommunications)
        view.sections.push({
          title: `${name} — Lost communications`,
          text: track(`pace/${p.id}/lostCommunications`, p.lostCommunications),
        });
    }
  };
  if (profile.product === "communications-card") {
    view.sections.push({ title: "Radio nets", rows: netRows(false) });
    paceSections(false);
  } else {
    for (const p of config.doctrine.paragraphs.filter((p) =>
      inc.paragraphIds.includes(p.id),
    ))
      view.sections.push({
        title: track(`doctrine/paragraphs/${p.id}/title`, p.title),
        text: track(
          `sections/${p.id}/summary`,
          op.sections.find((s) => s.id === p.id)?.summary ?? "",
        ),
      });
    const tasks = op.tasks.filter((t) =>
      applies(t.unitId ? [t.unitId] : [], t.phaseId ? [t.phaseId] : []),
    );
    view.sections.push({
      title: "Subordinate tasks",
      rows: track(
        "tasks/selected",
        tasks.map((t) => ({
          Task: t.name,
          Unit: t.unitId ? unitName(t.unitId) : "Unassigned",
          Purpose: t.purpose,
          Objective:
            op.objectives.find((o) => o.id === t.objectiveId)?.name ?? "",
          Phase: t.phaseId ? phaseName(t.phaseId) : "",
        })),
      ),
    });
    view.sections.push({
      title: "Timeline",
      rows: track(
        "events/selected",
        op.events
          .filter((e) => applies([], e.phaseId ? [e.phaseId] : []))
          .map((e) => ({
            Event: e.name,
            "Time (UTC)": eventTime(op, e.id) ?? "Unscheduled",
          })),
      ),
    });
    const included = new Set(inc.attachmentIds);
    const visited = new Set<string>();
    const visit = (parentId: string, prefix: string) => {
      for (const a of op.attachments.filter((a) => a.parentId === parentId)) {
        if (visited.has(a.id)) continue;
        visited.add(a.id);
        const path = `${prefix}${a.kind.toUpperCase()} ${a.code}`;
        if (included.has(a.id) && applies(a.unitIds, a.phaseIds)) {
          view.sections.push({
            title: track(`attachments/${a.id}/heading`, `${path} — ${a.name}`),
            text: track(`attachments/${a.id}/narrative`, a.narrative),
          });
          const editor = config.doctrine.annexCatalog.find(
            (c) => c.id === a.catalogId,
          )?.editor;
          track(`attachments/${a.id}/editor`, editor ?? "narrative");
          if (editor === "task-organization")
            view.sections.push({
              title: "Task organization",
              rows: track(
                "units/task-organization",
                op.units
                  .filter(
                    (u) =>
                      u.inTaskOrganization &&
                      (!inc.audienceUnitIds.length ||
                        inc.audienceUnitIds.includes(u.id)),
                  )
                  .map((u) => ({
                    Unit: u.name,
                    Parent:
                      op.units.find((p) => p.id === u.parentUnitId)?.name ??
                      "—",
                  })),
              ),
            });
          if (editor === "signal") {
            for (const key of [
              "concept",
              "architecture",
              "spectrumNotes",
              "maintenanceNotes",
            ] as const)
              view.sections.push({
                title: {
                  concept: "Signal concept",
                  architecture: "Network architecture",
                  spectrumNotes: "Spectrum notes",
                  maintenanceNotes: "Maintenance notes",
                }[key],
                text: track(`signal/${key}`, op.signal[key]),
              });
            view.sections.push({ title: "Radio nets", rows: netRows(true) });
            paceSections(true);
          }
        }
        visit(a.id, `${path} / `);
      }
    };
    track(
      "selection/attachments",
      op.attachments
        .filter((a) => included.has(a.id) && applies(a.unitIds, a.phaseIds))
        .map((a) => a.id),
    );
    visit(op.orderId, "");
  }
  return {
    view,
    dependencies: [
      ...new Map(dependencies.map((d) => [d.path, d])).values(),
    ].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
