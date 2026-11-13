import type { ExportRecord, Operation, ResolvedConfig } from "../domain/model";
import {
  canonicalValue,
  equalValue,
  type ChangeRecord,
  type ChangeImpact,
  type ResolvedEndpoint,
  type Hash,
} from "../domain/diff/model";
import {
  moduleDefinition,
  moduleConfiguration,
} from "../domain/module-authoring";
import { productOwner, productCode, factValue } from "../domain/authoring";
import { eventTime } from "../domain/invariants";
import { createExportProfile } from "../domain/factories";
import { renderModule } from "../export/module-render";
import {
  projectVersion,
  projectAuthoring,
  projectionVersionFor,
  exportStaleness,
  supportsProjection,
} from "../export/projection";
type Edge = { to: string; reason: string; columns?: string[] };
type Node = {
  key: string;
  id: string;
  kind: ChangeImpact["kind"];
  label: string;
  productId: string | null;
};
const profileId = "50000000-0000-4000-8000-000000000001";
const strip = (text: string) =>
  text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
export function reviewImpacts(
  source: ResolvedEndpoint,
  target: ResolvedEndpoint,
  changes: ChangeRecord[],
  exports: ExportRecord[],
  hash: Hash,
): ChangeImpact[] {
  const edges = new Map<string, Edge[]>(),
    labels = new Map<string, string>(),
    nodes = new Map<string, Node>();
  const edge = (
    from: string,
    to: string,
    reason: string,
    columns?: string[],
  ) => {
    if (from === to) return;
    const list = edges.get(from) ?? [];
    if (
      !list.some(
        (e) =>
          e.to === to && e.reason === reason && equalValue(e.columns, columns),
      )
    )
      list.push({ to, reason, columns });
    edges.set(from, list);
  };
  const node = (n: Node) => {
    nodes.set(n.key, n);
    labels.set(n.key, n.label);
  };
  const references = (v: unknown, to: string) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((x) => references(x, to));
      return;
    }
    const o = v as Record<string, any>;
    if (
      o.kind &&
      o.id &&
      [
        "unit",
        "task",
        "objective",
        "phase",
        "event",
        "net",
        "pace",
        "signal",
        "product",
      ].includes(o.kind)
    )
      edge(`${o.kind}:${o.id}`, to, `References canonical ${o.kind}`);
    for (const [key, value] of Object.entries(o)) {
      const kind = (
        {
          unitId: "unit",
          recipientUnitId: "unit",
          parentUnitId: "unit",
          objectiveId: "objective",
          phaseId: "phase",
          eventId: "event",
          referenceEventId: "event",
          relativeToEventId: "event",
          participantUnitIds: "unit",
          unitIds: "unit",
          phaseIds: "phase",
        } as Record<string, string>
      )[key];
      if (kind)
        for (const id of Array.isArray(value) ? value : value ? [value] : [])
          edge(
            `${kind}:${id}`,
            to,
            `Uses ${key === "referenceEventId" || key === "relativeToEventId" ? "relative time from" : "canonical"} ${kind}`,
          );
      if (key === "moduleInstanceId" && o.mode === "TABLE")
        edge(
          `module:${value}`,
          to,
          "Chart binds to source table and selected columns",
          [o.categoryColumnId, ...o.valueColumnIds],
        );
      references(value, to);
    }
  };
  for (const { operation: op, config } of [source, target]) {
    for (const [kind, list] of [
      ["unit", op.units],
      ["task", op.tasks],
      ["objective", op.objectives],
      ["phase", op.phases],
      ["event", op.events],
      ["net", op.signal.nets],
      ["pace", op.signal.pacePlans],
    ] as const)
      for (const entity of list) {
        labels.set(`${kind}:${entity.id}`, entity.name);
        references(entity, `${kind}:${entity.id}`);
      }
    labels.set(`operation:${op.id}`, op.name);
    labels.set(`signal:${op.signal.id}`, "Signal data");
    node({
      key: `product:${op.orderId}`,
      id: op.orderId,
      kind: "PRODUCT",
      label: "Base order / included OPORD package",
      productId: op.orderId,
    });
    node({
      key: "preview:timeline",
      id: "timeline",
      kind: "PREVIEW",
      label: "Operational Timeline",
      productId: null,
    });
    node({
      key: "preview:card",
      id: "communications-card",
      kind: "PREVIEW",
      label: "Live Communications Card (all fields)",
      productId: null,
    });
    references(op.authoring, `product:${op.orderId}`);
    for (const t of op.tasks)
      edge(
        `task:${t.id}`,
        `product:${op.orderId}`,
        "Base order derives subordinate task/purpose assignments",
      );
    for (const e of op.events)
      edge(
        `event:${e.id}`,
        "preview:timeline",
        "Timeline resolves the canonical event and relative event chain",
      );
    for (const list of [op.signal.nets, op.signal.pacePlans])
      for (const s of list) {
        edge(
          `${list === op.signal.nets ? "net" : "pace"}:${s.id}`,
          `signal:${op.signal.id}`,
          "Part of authoritative Signal data",
        );
        edge(
          `${list === op.signal.nets ? "net" : "pace"}:${s.id}`,
          "preview:card",
          "Card selects canonical Signal fields",
        );
      }
    for (const p of op.attachments) {
      const doctrine = config.doctrine.catalog?.nodes.find(
          (n) => n.id === p.doctrineNodeId,
        ),
        key = `product:${p.id}`;
      node({
        key,
        id: p.id,
        kind: "PRODUCT",
        label: doctrine
          ? `${productCode(doctrine, config)} ${doctrine.canonicalTitle}`
          : `${p.code} ${p.name}`,
        productId: p.id,
      });
      references(p.content, key);
      const capability =
        doctrine?.editorHint ??
        config.doctrine.annexCatalog.find((n) => n.id === p.catalogId)?.editor;
      if (
        ["TASK_ORGANIZATION_TREE", "task-organization"].includes(
          capability ?? "",
        )
      )
        for (const u of op.units)
          edge(`unit:${u.id}`, key, "Displays authoritative Task Organization");
      if (["SIGNAL_WORKSPACE", "signal"].includes(capability ?? ""))
        edge(
          `signal:${op.signal.id}`,
          key,
          "Displays authoritative Signal nets and PACE",
        );
      edge(
        key,
        `product:${op.orderId}`,
        "Product participates in the included package when applicable",
      );
      if (p.parentId !== op.orderId)
        edge(
          `product:${p.parentId}`,
          key,
          "Parent inclusion and inherited staff govern this product",
        );
    }
    for (const m of op.modules?.instances ?? []) {
      if (m.layoutState !== "ACTIVE") continue;
      const key = `module:${m.moduleInstanceId}`,
        cfg = moduleConfiguration(m, config);
      node({
        key,
        id: m.moduleInstanceId,
        kind: "MODULE",
        label: moduleDefinition(m, config)?.title ?? "Module",
        productId: m.productInstanceId,
      });
      references(m.content, key);
      edge(
        key,
        `product:${m.productInstanceId}`,
        "Active module is part of this product",
      );
      for (const field of [...(cfg.fields ?? []), ...(cfg.columns ?? [])])
        if (field.type.endsWith("_REFERENCE")) {
          const kind = field.type.split("_")[0].toLowerCase();
          const content = m.content;
          const values =
            content.type === "KEY_VALUE"
              ? [content.values[field.id]]
              : content.type === "TABLE" || content.type === "MATRIX"
                ? content.rows.map((r) => r.cells[field.id])
                : [];
          for (const value of values)
            if (typeof value === "string")
              edge(
                `${kind}:${value}`,
                key,
                `Typed field ${field.label} references canonical ${kind}`,
              );
        }
      if (m.content.type === "TASK_ORGANIZATION")
        for (const u of op.units)
          edge(
            `unit:${u.id}`,
            key,
            "Module displays canonical unit relationships",
          );
      if (m.content.type === "SIGNAL_NET_MATRIX")
        edge(
          `signal:${op.signal.id}`,
          key,
          "Module displays canonical Signal nets",
        );
      if (m.content.type === "PACE")
        for (const p of op.signal.pacePlans)
          edge(`pace:${p.id}`, key, "Module displays canonical PACE");
    }
    for (const n of nodes.values())
      edge(
        `operation:${op.id}`,
        n.key,
        "Operation identity appears in product context",
      );
  }
  const evaluate = (
    n: Node,
    state: ResolvedEndpoint,
  ): { value: unknown; display: string } => {
    const { operation: op, config } = state;
    try {
      if (n.kind === "MODULE") {
        const m = op.modules?.instances.find(
          (m) => m.moduleInstanceId === n.id && m.layoutState === "ACTIVE",
        );
        if (!m) return { value: null, display: "Module absent / removed" };
        const html = renderModule(m, op, config, []);
        return { value: html, display: strip(html) };
      }
      if (n.key === "preview:timeline") {
        const rows = op.events.map((e) => ({
          name: e.name,
          at: eventTime(op, e.id),
        }));
        return {
          value: rows,
          display: rows
            .map(
              (r) =>
                `${r.name}: ${r.at === null ? "Unresolved" : new Date(r.at).toISOString()}`,
            )
            .join("\n"),
        };
      }
      const profile = createExportProfile(
        op,
        n.key === "preview:card" ? "communications-card" : "opord",
        profileId,
      );
      let result;
      if (n.key === "preview:card" || n.id === op.orderId)
        result = projectVersion(projectionVersionFor(op), op, profile, config);
      else {
        const p = op.attachments.find((a) => a.id === n.id);
        if (!p) return { value: null, display: "Product absent" };
        if (p.doctrineNodeId)
          result = projectAuthoring(op, profile, config, p.doctrineNodeId);
        else
          result = projectVersion(
            projectionVersionFor(op),
            op,
            {
              ...profile,
              inclusion: {
                ...profile.inclusion,
                paragraphIds: [],
                attachmentIds: [p.id],
                packageScope: "selected",
              },
            },
            config,
          );
      }
      return {
        value: result.view,
        display: result.view.sections
          .map(
            (s) =>
              `${s.title}: ${s.text ?? s.rows?.map((r) => Object.values(r).join(" / ")).join("; ") ?? strip((s as { moduleHtml?: string }).moduleHtml ?? "")}`,
          )
          .join("\n")
          .slice(0, 12000),
      };
    } catch (e) {
      return {
        value: { unresolved: String(e) },
        display: `Unresolved dependency: ${String(e)}`,
      };
    }
  };
  const result: ChangeImpact[] = [];
  const cache = new Map<
    string,
    { before: ReturnType<typeof evaluate>; after: ReturnType<typeof evaluate> }
  >();
  const reachable = new Map<
    string,
    Map<string, { chain: string[]; reasons: string[] }>
  >();
  for (const c of changes) {
    const start =
      c.entityType === "base"
        ? `product:${c.entityId}`
        : `${c.entityType}:${c.entityId}`;
    const found = new Map<string, { chain: string[]; reasons: string[] }>(),
      queue = [
        {
          key: start,
          chain: [c.humanSummary.slice(0, 500)],
          reasons: [] as string[],
        },
      ];
    const seen = new Set([start]);
    while (queue.length) {
      const current = queue.shift()!;
      for (const e of [...(edges.get(current.key) ?? [])].sort((x, y) =>
        x.to.localeCompare(y.to),
      )) {
        if (current.key === start && !sourceFeedsEdge(c, e)) continue;
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        const info = {
          chain: [...current.chain, labels.get(e.to) ?? e.to],
          reasons: [...current.reasons, e.reason],
        };
        found.set(e.to, info);
        if (info.chain.length < 40) queue.push({ key: e.to, ...info });
      }
    }
    reachable.set(c.changeId, found);
    for (const [key, info] of found) {
      const n = nodes.get(key);
      if (!n) continue;
      if (!cache.has(key))
        cache.set(key, {
          before: evaluate(n, source),
          after: evaluate(n, target),
        });
      const values = cache.get(key)!;
      if (equalValue(values.before.value, values.after.value)) continue;
      result.push({
        id: hash(`${c.changeId}:${key}`),
        changeIds: [c.changeId],
        kind: n.kind,
        targetId: n.id,
        productId: n.productId,
        label: n.label,
        reason: info.reasons.join(" → "),
        chain: info.chain,
        beforeDisplay: values.before.display,
        afterDisplay: values.after.display,
        dependencyPaths: [],
        baselineOutdated: null,
        targetOutdated: null,
        compatibility:
          values.before.display.startsWith("Unresolved") ||
          values.after.display.startsWith("Unresolved")
            ? "unresolved"
            : "supported",
      });
    }
  }
  // Inherited staff changes are effects of the explicit parent override, not new source edits.
  for (const n of target.config.doctrine.catalog?.nodes ?? []) {
    const x = source.operation.attachments.find(
        (p) => p.doctrineNodeId === n.id,
      ),
      y = target.operation.attachments.find((p) => p.doctrineNodeId === n.id);
    if (!x || !y || x.metadata.ownerId || y.metadata.ownerId) continue;
    const oldNode = source.config.doctrine.catalog?.nodes.find(
      (p) => p.id === n.id,
    );
    if (!oldNode) continue;
    const old = productOwner(source.operation, oldNode, source.config),
      next = productOwner(target.operation, n, target.config);
    if (old === next) continue;
    for (const c of changes.filter(
      (c) =>
        c.category === "RESPONSIBLE_STAFF" &&
        reachable.get(c.changeId)?.has(`product:${y.id}`),
    )) {
      const info = reachable.get(c.changeId)!.get(`product:${y.id}`)!;
      result.push({
        id: hash(`${c.changeId}:owner:${y.id}`),
        changeIds: [c.changeId],
        kind: "EFFECTIVE_OWNER",
        targetId: y.id,
        productId: y.id,
        label: `${productCode(n, target.config)} Responsible Staff`,
        reason: "Inherited parent staff assignment changed",
        chain: info.chain,
        beforeDisplay:
          source.config.doctrine.staff.find((s) => s.id === old)?.name ??
          "Unassigned",
        afterDisplay:
          target.config.doctrine.staff.find((s) => s.id === next)?.name ??
          "Unassigned",
        dependencyPaths: [],
        baselineOutdated: null,
        targetOutdated: null,
        compatibility: "supported",
      });
    }
  }
  for (const record of exports) {
    if (!supportsProjection(record.projectionVersion)) continue;
    const before = exportStaleness(record, source.operation),
      after = exportStaleness(record, target.operation);
    let paths: string[] = [];
    try {
      const x = new Map(
        projectVersion(
          record.projectionVersion,
          source.operation,
          record.profile,
          record.config,
        ).dependencies.map((d) => [d.path, d.canonicalValue]),
      );
      const y = new Map(
        projectVersion(
          record.projectionVersion,
          target.operation,
          record.profile,
          record.config,
        ).dependencies.map((d) => [d.path, d.canonicalValue]),
      );
      paths = [...new Set([...x.keys(), ...y.keys()])]
        .filter((p) => x.get(p) !== y.get(p))
        .sort();
    } catch {
      paths = ["selection/unresolved-reference"];
    }
    if (!paths.length) continue;
    const contributing = changes.filter((c) =>
      paths.some((p) =>
        dependencyMatches(c, p, reachable.get(c.changeId) ?? new Map()),
      ),
    );
    if (!contributing.length) continue;
    result.push({
      id: hash(
        `export:${record.id}:${contributing.map((c) => c.changeId).join(",")}`,
      ),
      changeIds: contributing.map((c) => c.changeId),
      kind: "EXPORT",
      targetId: record.id,
      productId: null,
      label: `${record.profile.name} · generated ${record.generatedAt}`,
      reason: `Recorded projection v${record.projectionVersion} and profile v${record.profile.version} select dependencies changed between these endpoints. ${before.outdated ? "Already outdated at baseline; this comparison adds or changes dependencies." : "Current at baseline."}`,
      chain: [
        contributing[0].humanSummary.slice(0, 500),
        "Recorded selection and source dependencies",
        record.profile.name,
      ],
      beforeDisplay: before.outdated
        ? "Outdated at baseline"
        : "Current at baseline",
      afterDisplay: after.outdated ? "Outdated at target" : "Current at target",
      dependencyPaths: paths,
      baselineOutdated: before.outdated,
      targetOutdated: after.outdated,
      compatibility: paths.includes("selection/unresolved-reference")
        ? "unresolved"
        : "supported",
    });
  }
  if (source.endpoint.publicationId && changes.length)
    result.push({
      id: hash(`publication:${source.endpoint.publicationId}`),
      changeIds: changes.map((c) => c.changeId),
      kind: "PUBLICATION_DIVERGENCE",
      targetId: source.endpoint.publicationId,
      productId: null,
      label: source.endpoint.label,
      reason:
        "Target planning state diverges from this frozen publication baseline. The publication remains unchanged.",
      chain: [source.endpoint.label, target.endpoint.label],
      beforeDisplay: "Frozen publication baseline",
      afterDisplay: "Later saved planning state",
      dependencyPaths: [],
      baselineOutdated: null,
      targetOutdated: null,
      compatibility: "supported",
    });
  return result.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
}
function dependencyMatches(
  c: ChangeRecord,
  path: string,
  reachable: Map<string, unknown>,
) {
  const field = c.fieldPath.split("/").at(-1)!,
    structural = ["ADDED", "REMOVED", "MOVED"].includes(c.changeType);
  if (path === "selection/unresolved-reference")
    return c.changeType === "REMOVED" || c.changeType === "RELINKED";
  if (path.startsWith("operation/")) return c.fieldPath === path;
  const segments = path.split("/");
  if (path.startsWith("selection/")) {
    if (segments[1] === "modules")
      return c.category === "MODULE_LAYOUT" && c.productId === segments[2];
    if (["attachments", "package-products"].includes(segments[1]))
      return (
        c.entityType === "product" &&
        (structural ||
          ["applicability", "unitIds", "phaseIds", "parentId"].includes(field))
      );
    if (segments[1] === "radio-nets")
      return (
        c.entityType === "net" &&
        (structural || ["participantUnitIds", "phaseIds"].includes(field))
      );
    if (segments[1] === "pace-plans")
      return (
        c.entityType === "pace" &&
        (structural || ["unitIds", "phaseIds"].includes(field))
      );
    if (segments[1] === "base-tasks")
      return (
        c.entityType === "task" &&
        (structural || ["unitId", "phaseId"].includes(field))
      );
    return false;
  }
  if (["facts", "module-facts"].includes(segments[0]) && segments[2]) {
    const key = segments[1] + ":" + segments[2];
    return key === c.entityType + ":" + c.entityId || reachable.has(key);
  }
  if (
    path === "units/task-organization" ||
    path === "module-facts/task-organization"
  )
    return (
      c.entityType === "unit" &&
      (structural ||
        ["name", "parentUnitId", "inTaskOrganization"].includes(field))
    );
  if (path === "tasks/selected")
    return (
      (c.entityType === "task" &&
        (structural ||
          ["name", "purpose", "unitId", "objectiveId", "phaseId"].includes(
            field,
          ))) ||
      (["unit", "phase", "objective"].includes(c.entityType) &&
        field === "name")
    );
  if (path === "events/selected")
    return (
      c.entityType === "event" &&
      (structural ||
        [
          "name",
          "at",
          "relativeToEventId",
          "offsetMinutes",
          "phaseId",
        ].includes(field))
    );
  if (["nets", "pace", "units", "phases"].includes(segments[0]))
    return segments[1] === c.entityId && (structural || field === segments[2]);
  if (segments[0] === "signal")
    return c.entityType === "signal" && c.fieldPath === path;
  if (segments[0] === "sections") return c.fieldPath === "base/" + path;
  if (segments[0] === "base")
    return c.fieldPath.startsWith("base/fields/" + segments[1]);
  if (["products", "attachments"].includes(segments[0]))
    return (
      c.entityType === "product" &&
      c.entityId === segments[1] &&
      (structural ||
        c.fieldPath.includes("/" + segments[2]) ||
        (["identity", "heading"].includes(segments[2]) &&
          ["name", "code", "parentId"].includes(field)))
    );
  if (segments[0] === "modules")
    return (
      c.moduleInstanceId === segments[1] ||
      reachable.has("module:" + segments[1])
    );
  if (segments[0] === "assets")
    return (
      c.detailKind === "asset" &&
      (c.beforeValue === segments[1] || c.afterValue === segments[1])
    );
  return false;
}

// Source fields constrain the first dependency hop; later hops propagate a derived value.
function sourceFeedsEdge(c: ChangeRecord, e: Edge): boolean {
  const field = c.fieldPath.split("/").at(-1)!;
  if (c.fieldPath.includes("/metadata/")) return false;
  if (e.columns) {
    if (c.fieldPath.endsWith("/presence")) return true;
    if (c.fieldPath.includes("/rows/") && !c.fieldPath.includes("/cells/"))
      return true;
    return e.columns.some((id) => c.fieldPath.includes("/" + id));
  }
  if (["ADDED", "REMOVED", "MOVED"].includes(c.changeType)) return true;
  if (c.entityType === "operation")
    return ["name", "orderNumber", "demo"].includes(field);
  if (
    ["unit", "phase", "objective"].includes(c.entityType) &&
    /^(unit|task|net|pace|event):/.test(e.to)
  )
    return field === "name";
  if (c.entityType === "event" && e.to.startsWith("event:"))
    return ["at", "relativeToEventId", "offsetMinutes"].includes(field);
  if (c.entityType === "net" && e.to === "preview:card")
    return [
      "name",
      "purpose",
      "participantUnitIds",
      "system",
      "channel",
      "callsign",
    ].includes(field);
  if (c.entityType === "pace" && e.to === "preview:card")
    return [
      "name",
      "primary",
      "alternate",
      "contingency",
      "emergency",
      "lostCommunications",
    ].includes(field);
  if (
    c.entityType === "module" &&
    c.fieldPath.includes("/definition/") &&
    ["description", "guidance", "required", "defaultVisible"].includes(field)
  )
    return false;
  return true;
}
