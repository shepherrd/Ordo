// Version 3 adds typed base authoring and operation package applicability.
// Versions 1 and 2 remain unchanged for their historical export manifests.
import { canonical, projectV2, type ProductView } from "./v2";
import { assertExportScope } from "../../domain/invariants";
import {
  catalogNodes,
  factDescription,
  factValue,
  packageIncluded,
  productCode,
} from "../../domain/authoring";
import type {
  DoctrineNode,
  FactReference,
  ProductContent,
} from "../../domain/doctrine";
import type {
  Operation,
  ExportProfile,
  ResolvedConfig,
  Dependency,
  Attachment,
} from "../../domain/model";

export function projectV3(
  op: Operation,
  profile: ExportProfile,
  config: ResolvedConfig,
  previewNodeId?: string,
): { view: ProductView; dependencies: Dependency[] } {
  if (!config.doctrine.catalog || profile.product === "communications-card")
    return projectV2(op, profile, config);
  assertExportScope(
    op,
    profile.inclusion.packageScope === "selected"
      ? profile
      : { ...profile, inclusion: { ...profile.inclusion, attachmentIds: [] } },
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
  const addRefs = (
    refs: FactReference[],
    title = "Authoritative references",
  ) => {
    if (!refs.length) return;
    view.sections.push({
      title,
      rows: refs.map((ref) => {
        track(`facts/${ref.kind}/${ref.id}`, factValue(op, ref));
        return { Type: ref.kind, Fact: factDescription(op, ref) };
      }),
    });
  };
  const addContent = (c: ProductContent, prefix: string) => {
    track(`${prefix}/content`, c);
    switch (c.kind) {
      case "narrative":
        for (const section of c.sections)
          view.sections.push({ title: section.title, text: section.text });
        break;
      case "generic":
        view.sections.push({
          title: "Structured content",
          rows: c.fields.map((f) => ({ Field: f.label, Value: f.value })),
        });
        break;
      case "matrix":
        view.sections.push({
          title: "Matrix",
          rows: c.rows.map((r) =>
            Object.fromEntries(
              c.columns.map((col, i) => [
                `${i + 1}. ${col.title}`,
                r.cells[col.id] ?? "",
              ]),
            ),
          ),
        });
        break;
      case "checklist":
        view.sections.push({
          title: "Checklist",
          rows: c.items.map((i) => ({
            Status: i.checked ? "Complete" : "Open",
            Item: i.text,
          })),
        });
        break;
      case "reports":
        view.sections.push({
          title: "Report catalog",
          rows: c.reports.map((r) => {
            const refs: FactReference[] = [];
            if (r.recipientUnitId)
              refs.push({ kind: "unit", id: r.recipientUnitId });
            if (r.eventId) refs.push({ kind: "event", id: r.eventId });
            for (const ref of refs)
              track(`facts/${ref.kind}/${ref.id}`, factValue(op, ref));
            return {
              Report: r.name,
              Format: r.format,
              Submission: r.submission,
              Recipient:
                op.units.find((u) => u.id === r.recipientUnitId)?.name ?? "",
              Event: r.eventId
                ? factDescription(op, { kind: "event", id: r.eventId })
                : "",
            };
          }),
        });
        break;
      case "distribution":
        view.sections.push({
          title: "Distribution list",
          rows: c.recipients.map((r) => {
            if (r.unitId)
              track(
                `facts/unit/${r.unitId}`,
                factValue(op, { kind: "unit", id: r.unitId }),
              );
            return {
              Recipient: r.recipient,
              "Duty position": r.dutyPosition,
              Unit: op.units.find((u) => u.id === r.unitId)?.name ?? "",
              Location: r.location,
              Purpose: r.distributionPurpose,
              Copy: r.copyNumber,
              Method: r.method,
              Acknowledgment: r.acknowledgmentRequired
                ? "Required"
                : "Not required",
            };
          }),
        });
        break;
    }
    addRefs(c.references);
  };
  if (!previewNodeId) {
    for (const [index, p] of config.doctrine.paragraphs.entries()) {
      if (!profile.inclusion.paragraphIds.includes(p.id)) continue;
      const summary = track(
        `sections/${p.id}/summary`,
        op.sections.find((s) => s.id === p.id)?.summary ?? "",
      );
      view.sections.push({
        title: `${index + 1}. ${p.title}`,
        ...(summary ? { text: summary } : {}),
      });
      const paragraphFields = config.doctrine.catalog.baseFields.filter(
        (f) => f.paragraphId === p.id,
      );
      for (const definition of paragraphFields) {
        const content = op.authoring?.fields.find(
          (f) => f.fieldId === definition.id,
        );
        track(`base/${definition.id}`, content ?? null);
        const siblings = paragraphFields.filter(
          (f) => f.parentStableKey === definition.parentStableKey,
        );
        const fieldIndex = siblings.findIndex((f) => f.id === definition.id);
        const prefix = definition.parentStableKey
          ? `(${fieldIndex + 1})`
          : `${String.fromCharCode(97 + fieldIndex)}.`;
        view.sections.push({
          title: `${prefix} ${definition.title}`,
          ...(content?.text ? { text: content.text } : {}),
        });
        if (definition.contentKind === "canonical-tasks") {
          const refs: FactReference[] = op.tasks
            .filter(
              (t) =>
                (!profile.inclusion.audienceUnitIds.length ||
                  (!!t.unitId &&
                    profile.inclusion.audienceUnitIds.includes(t.unitId))) &&
                (!profile.inclusion.phaseIds.length ||
                  (!!t.phaseId &&
                    profile.inclusion.phaseIds.includes(t.phaseId))),
            )
            .map((t) => ({ kind: "task", id: t.id }));
          track("selection/base-tasks", refs);
          addRefs(refs, "Tasks and purposes");
        } else
          addRefs(
            content?.references ?? [],
            definition.contentKind === "task-collection"
              ? "Key tasks"
              : "Linked facts",
          );
        for (const entry of content?.entries ?? []) {
          view.sections.push({ title: entry.label, text: entry.value });
          addRefs(entry.references);
        }
      }
    }
  }
  const selected = op.attachments.filter((a) =>
    previewNodeId
      ? a.doctrineNodeId === previewNodeId
      : packageIncluded(op, a) &&
        (profile.inclusion.packageScope !== "selected" ||
          profile.inclusion.attachmentIds.includes(a.id)) &&
        (!profile.inclusion.audienceUnitIds.length ||
          !a.unitIds.length ||
          a.unitIds.some((id) =>
            profile.inclusion.audienceUnitIds.includes(id),
          )) &&
        (!profile.inclusion.phaseIds.length ||
          !a.phaseIds.length ||
          a.phaseIds.some((id) => profile.inclusion.phaseIds.includes(id))),
  );
  track(
    "selection/package-products",
    selected.map((a) => a.id),
  );
  const appendProduct = (node: DoctrineNode, a: Attachment) => {
    track(`products/${a.id}/identity`, {
      id: a.id,
      doctrineNodeId: a.doctrineNodeId,
      code: a.code,
      name: a.name,
    });
    view.sections.push({
      title: `${node.nodeType.charAt(0) + node.nodeType.slice(1).toLowerCase()} ${productCode(node, config)} — ${node.canonicalTitle}`,
      text: track(`products/${a.id}/narrative`, a.narrative),
    });
    if (node.editorHint === "TASK_ORGANIZATION_TREE") {
      const rows = op.units
        .filter(
          (u) =>
            u.inTaskOrganization &&
            (!profile.inclusion.audienceUnitIds.length ||
              profile.inclusion.audienceUnitIds.includes(u.id)),
        )
        .map((u) => ({
          Unit: u.name,
          Parent: op.units.find((p) => p.id === u.parentUnitId)?.name ?? "—",
        }));
      view.sections.push({
        title: "Task organization",
        rows: track("units/task-organization", rows),
      });
    } else if (node.editorHint === "SIGNAL_WORKSPACE") {
      for (const [key, title] of [
        ["concept", "Signal concept"],
        ["architecture", "Network architecture"],
        ["spectrumNotes", "Spectrum notes"],
        ["maintenanceNotes", "Maintenance notes"],
      ] as const)
        view.sections.push({
          title,
          text: track(`signal/${key}`, op.signal[key]),
        });
      const signal = projectV2(
        op,
        {
          ...profile,
          product: "communications-card",
          inclusion: {
            ...profile.inclusion,
            netFields: [
              "purpose",
              "participants",
              "system",
              "channel",
              "callsign",
            ],
            includeNetName: true,
            includePace: true,
            includeLostCommunications: true,
          },
        },
        config,
      );
      view.sections.push(
        ...signal.view.sections.filter((s) => s.title !== "Scope"),
      );
      dependencies.push(...signal.dependencies);
    } else if (a.content) addContent(a.content, `products/${a.id}`);
  };
  const visit = (parent: string | null) => {
    for (const node of catalogNodes(config).filter(
      (n) => n.parentStableKey === parent,
    )) {
      const a = selected.find((a) => a.doctrineNodeId === node.id);
      if (a) appendProduct(node, a);
      visit(node.stableKey);
    }
  };
  visit(null);
  if (previewNodeId && selected.length === 0) {
    const node = catalogNodes(config).find((n) => n.id === previewNodeId);
    if (node)
      view.sections.push({
        title: node.canonicalTitle,
        text:
          node.status === "SPARE"
            ? "Reserved spare. No authored product."
            : "No authored content. This catalog entry has not been instantiated.",
      });
  }
  return {
    view,
    dependencies: [
      ...new Map(dependencies.map((d) => [d.path, d])).values(),
    ].sort((a, b) => a.path.localeCompare(b.path)),
  };
}
