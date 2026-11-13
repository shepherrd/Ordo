import type {
  Operation,
  ResolvedConfig,
  Dependency,
  ExportProfile,
} from "../domain/model";
import type {
  ModuleInstance,
  RichNode,
  FieldValue,
  FieldDefinition,
  ModuleReference,
} from "../domain/modules";
import {
  moduleConfiguration,
  moduleDefinition,
} from "../domain/module-authoring";
import { factValue, factDescription } from "../domain/authoring";
import { eventTime } from "../domain/invariants";
import { escapeHtml as e } from "./html";
import { canonical } from "./projections/v1";
export const richHtml = (node: RichNode): string => {
  if (node.type === "text")
    return (node.marks ?? []).reduce(
      (s, m) =>
        m.type === "link"
          ? `<a href="${e(m.attrs!.href)}" rel="noopener noreferrer">${s}</a>`
          : `<${{ bold: "strong", italic: "em", underline: "u" }[m.type]}>${s}</${{ bold: "strong", italic: "em", underline: "u" }[m.type]}>`,
      e(node.text ?? ""),
    );
  if (node.type === "image")
    return `<img src="asset:${e(node.attrs!.assetId!)}" alt="${e(node.attrs?.alt ?? "")}" style="max-width:100%">`;
  if (node.type === "hardBreak") return "<br>";
  const content = (node.content ?? []).map(richHtml).join("");
  const tag = {
    doc: "div",
    paragraph: "p",
    heading: `h${node.attrs?.level ?? 2}`,
    bulletList: "ul",
    orderedList: "ol",
    listItem: "li",
    blockquote: "blockquote",
  }[node.type];
  return `<${tag}${node.type === "orderedList" ? ` start="${node.attrs?.start ?? 1}"` : ""}>${content}</${tag}>`;
};
export const tableHtml = (head: string[], rows: string[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${e(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
export type ChartPoint = {
  label: string;
  x: number;
  value: number;
  series: string;
};
export function chartSvg(type: string, points: ChartPoint[]): string {
  if (!points.length) return "<p>No chart data.</p>";
  const palette = ["#28665e", "#bb733d", "#547fa6", "#8a658e", "#677b38"],
    width = 640,
    height = 270,
    pad = 40;
  const vals = points.map((p) => p.value),
    lo = Math.min(0, ...vals),
    hi = Math.max(1, ...vals),
    y = (v: number) =>
      height - pad - ((v - lo) / (hi - lo)) * (height - 2 * pad);
  let shapes = "";
  if (type === "PIE") {
    const total = points.reduce((n, p) => n + Math.max(0, p.value), 0);
    if (!total) return "<p>Pie chart requires positive values.</p>";
    let angle = -Math.PI / 2;
    points.forEach((p, i) => {
      const sweep = (Math.max(0, p.value) / total) * Math.PI * 2,
        end = angle + sweep,
        r = 95,
        cx = 160,
        cy = 130;
      shapes +=
        sweep >= Math.PI * 2 - 0.00001
          ? `<circle cx="160" cy="130" r="95" fill="${palette[i % palette.length]}"/>`
          : `<path d="M ${cx} ${cy} L ${cx + r * Math.cos(angle)} ${cy + r * Math.sin(angle)} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(end)} ${cy + r * Math.sin(end)} Z" fill="${palette[i % palette.length]}"/>`;
      shapes += `<text x="300" y="${30 + i * 18}" fill="${palette[i % palette.length]}">${e(p.label)}: ${p.value}</text>`;
      angle = end;
    });
  } else {
    const minX = Math.min(...points.map((p) => p.x)),
      maxX = Math.max(minX + 1, ...points.map((p) => p.x));
    const categories = [...new Set(points.map((p) => p.label))];
    const x = (p: ChartPoint, i: number) =>
      type === "SCATTER"
        ? pad + ((p.x - minX) / (maxX - minX)) * (width - 2 * pad)
        : type === "LINE"
          ? pad +
            ((categories.indexOf(p.label) + 0.5) / categories.length) *
              (width - 2 * pad)
          : pad + ((i + 0.5) / points.length) * (width - 2 * pad);
    shapes = `<path d="M ${pad} ${pad} V ${height - pad} H ${width - pad}" fill="none" stroke="#62716d"/>`;
    if (type === "LINE")
      for (const series of new Set(points.map((p) => p.series)))
        shapes += `<polyline fill="none" stroke="${palette[[...new Set(points.map((p) => p.series))].indexOf(series) % palette.length]}" stroke-width="2" points="${points
          .map((p, i) =>
            p.series === series ? `${x(p, i)},${y(p.value)}` : "",
          )
          .filter(Boolean)
          .join(" ")}"/>`;
    points.forEach((p, i) => {
      const color = palette[i % palette.length];
      shapes +=
        type === "BAR"
          ? `<rect x="${x(p, i) - Math.min(20, 200 / points.length)}" y="${Math.min(y(0), y(p.value))}" width="${Math.min(40, 400 / points.length)}" height="${Math.abs(y(0) - y(p.value))}" fill="${color}"/>`
          : `<circle cx="${x(p, i)}" cy="${y(p.value)}" r="4" fill="${color}"/>`;
      if (points.length <= 20)
        shapes += `<text x="${x(p, i)}" y="${height - 12}" text-anchor="middle">${e(p.label.slice(0, 18))}</text>`;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(type)} chart" style="max-width:100%;font:11px system-ui">${shapes}</svg>${tableHtml(
    ["Category", "Series", "Value"],
    points.map((p) => [e(p.label), e(p.series), String(p.value)]),
  )}`;
}
export function renderModule(
  m: ModuleInstance,
  op: Operation,
  config: ResolvedConfig,
  dependencies: Dependency[],
  profile?: ExportProfile,
): string {
  const track = <T>(path: string, v: T) => {
    dependencies.push({ path, canonicalValue: canonical(v) });
    return v;
  };
  const d = moduleDefinition(m, config),
    cfg = moduleConfiguration(m, config),
    c = m.content;
  if (!d) return "<p>Missing module definition.</p>";
  track(`modules/${m.moduleInstanceId}/content`, c);
  track(`modules/${m.moduleInstanceId}/definition`, {
    title: d.title,
    moduleType: d.moduleType,
    configuration: cfg,
  });
  const reference = (r: ModuleReference) => {
    if (r.kind === "product") {
      const product =
        r.id === op.orderId
          ? { name: op.name }
          : op.attachments.find((a) => a.id === r.id);
      track(
        `module-facts/product/${r.id}`,
        product ? { name: product.name } : null,
      );
      return product?.name ?? "Missing product";
    }
    track(`module-facts/${r.kind}/${r.id}`, factValue(op, r));
    return factDescription(op, r);
  };
  const value = (f: FieldDefinition, v: FieldValue | undefined): string => {
    if (v === null || v === undefined) return "";
    if (f.type === "RICH_TEXT" && typeof v === "object" && !Array.isArray(v))
      return richHtml(v);
    if (f.type.endsWith("_REFERENCE") && typeof v === "string" && v) {
      const kind = f.type.split("_")[0].toLowerCase();
      return e(
        kind === "staff"
          ? (config.doctrine.staff.find((s) => s.id === v)?.name ??
              "Missing staff")
          : reference({ kind: kind as ModuleReference["kind"], id: v }),
      );
    }
    if (f.type === "SINGLE_SELECT")
      return e(f.options.find((o) => o.id === v)?.label ?? String(v));
    if (Array.isArray(v))
      return e(
        v.map((x) => f.options.find((o) => o.id === x)?.label ?? x).join(", "),
      );
    return e(String(v));
  };
  const image = (i: {
    assetId: string;
    title: string;
    caption: string;
    alt: string;
    width: string;
    alignment: string;
  }) =>
    `<figure style="text-align:${i.alignment}">${i.title ? `<h3>${e(i.title)}</h3>` : ""}<img src="asset:${i.assetId}" alt="${e(i.alt)}" style="max-width:${{ small: "30%", medium: "60%", full: "100%" }[i.width] ?? "100%"}"><figcaption>${e(i.caption)}</figcaption></figure>`;
  switch (c.type) {
    case "PLAIN_TEXT":
      return `<p>${e(c.text)}</p>`;
    case "RICH_TEXT":
      return richHtml(c.document);
    case "KEY_VALUE":
      return tableHtml(
        ["Field", "Value"],
        (cfg.fields ?? []).map((f) => [e(f.label), value(f, c.values[f.id])]),
      );
    case "TABLE":
    case "MATRIX":
      return tableHtml(
        (cfg.columns ?? []).map((f) => f.label),
        c.rows.map((r) =>
          (cfg.columns ?? []).map((f) => value(f, r.cells[f.id])),
        ),
      );
    case "CHECKLIST":
      return tableHtml(
        ["Status", "Item", "Notes", "Responsible", "Due"],
        c.items.map((i) => [
          i.checked ? "Complete" : "Open",
          e(i.text),
          e(i.notes),
          e(
            i.unitId
              ? reference({ kind: "unit", id: i.unitId })
              : (config.doctrine.staff.find((s) => s.id === i.staffId)?.name ??
                  ""),
          ),
          e(i.eventId ? reference({ kind: "event", id: i.eventId }) : ""),
        ]),
      );
    case "TIMELINE":
      return tableHtml(
        ["Item", "Description", "Time (UTC)", "Timing", "Phase"],
        c.items.map((i) => {
          let at: string | null =
              i.timing.mode === "ABSOLUTE" ? i.timing.at : null,
            mode = "Absolute";
          if (i.timing.mode === "RELATIVE") {
            const timing = i.timing;
            const ev = op.events.find((e) => e.id === timing.referenceEventId);
            reference({ kind: "event", id: timing.referenceEventId });
            const time = ev ? eventTime(op, ev.id) : null;
            at = time
              ? new Date(
                  Date.parse(time) + i.timing.offsetMinutes * 60000,
                ).toISOString()
              : null;
            mode = `${ev?.name ?? "Missing event"} ${i.timing.offsetMinutes >= 0 ? "+" : ""}${i.timing.offsetMinutes} min`;
          }
          return [
            e(i.title),
            e(i.description),
            e(at ?? "Unresolved"),
            e(mode),
            e(i.phaseId ? reference({ kind: "phase", id: i.phaseId }) : ""),
          ];
        }),
      );
    case "CHART": {
      let points: ChartPoint[] = [];
      if (c.source.mode === "DIRECT")
        points = c.source.points.map((p) => ({ ...p, series: "Value" }));
      else {
        const source = c.source,
          table = op.modules?.instances.find(
            (i) =>
              i.moduleInstanceId === source.moduleInstanceId &&
              i.layoutState === "ACTIVE",
          );
        if (
          !table ||
          !(table.content.type === "TABLE" || table.content.type === "MATRIX")
        )
          return "<p>Chart source table is missing or removed.</p>";
        const cols = moduleConfiguration(table, config).columns ?? [];
        const category = cols.find((f) => f.id === source.categoryColumnId);
        if (
          !category ||
          source.valueColumnIds.some((id) => !cols.some((f) => f.id === id))
        )
          return "<p>Chart source column is missing.</p>";
        track(
          `modules/${m.moduleInstanceId}/chart-columns`,
          cols.filter((f) =>
            [source.categoryColumnId, ...source.valueColumnIds].includes(f.id),
          ),
        );
        points = table.content.rows.flatMap((row, index) =>
          source.valueColumnIds
            .filter((cid) => typeof row.cells[cid] === "number")
            .map((cid) => ({
              label: String(row.cells[category.id] ?? ""),
              x:
                typeof row.cells[category.id] === "number"
                  ? (row.cells[category.id] as number)
                  : index,
              value:
                typeof row.cells[cid] === "number"
                  ? (row.cells[cid] as number)
                  : 0,
              series: cols.find((f) => f.id === cid)!.label,
            })),
        );
        track(`modules/${m.moduleInstanceId}/chart-data`, points);
      }
      return chartSvg(c.chartType, points);
    }
    case "IMAGE":
      return c.image ? image(c.image) : "<p>No managed image selected.</p>";
    case "IMAGE_GALLERY":
      return c.images.map(image).join("");
    case "FILE_ATTACHMENT": {
      const a = [
        ...(op.modules?.assets ?? []),
        ...(config.doctrine.modules?.assets ?? []),
      ].find((a) => a.assetId === c.assetId);
      return `<p>${e(c.displayName)} — ${e(c.description)}</p><p>${a ? `${e(a.originalFilename)} · ${e(a.mimeType)} · ${a.sizeBytes} bytes · SHA-256 ${a.sha256}` : "No managed attachment selected."}</p>`;
    }
    case "CANONICAL_REFERENCES":
      return tableHtml(
        ["Type", "Authoritative fact"],
        c.references.map((r) => [e(r.kind), e(reference(r))]),
      );
    case "TASK_ORGANIZATION": {
      const rows = op.units
        .filter(
          (u) =>
            u.inTaskOrganization &&
            (!profile?.inclusion.audienceUnitIds.length ||
              profile.inclusion.audienceUnitIds.includes(u.id)),
        )
        .map((u) => [
          u.name,
          op.units.find((p) => p.id === u.parentUnitId)?.name ?? "",
        ]);
      track("module-facts/task-organization", rows);
      return tableHtml(
        ["Unit", "Parent"],
        rows.map((r) => r.map(e)),
      );
    }
    case "SIGNAL_NET_MATRIX":
      return tableHtml(
        ["Net", "Purpose", "Participants", "System", "Channel", "Callsign"],
        op.signal.nets
          .filter(
            (n) =>
              (!profile?.inclusion.netIds.length ||
                profile.inclusion.netIds.includes(n.id)) &&
              (!profile?.inclusion.audienceUnitIds.length ||
                n.participantUnitIds.some((id) =>
                  profile.inclusion.audienceUnitIds.includes(id),
                )) &&
              (!profile?.inclusion.phaseIds.length ||
                !n.phaseIds.length ||
                n.phaseIds.some((id) =>
                  profile.inclusion.phaseIds.includes(id),
                )),
          )
          .map((n, index) => {
            track(`modules/${m.moduleInstanceId}/net-order/${n.id}`, index);
            reference({ kind: "net", id: n.id });
            return [
              n.name,
              n.purpose,
              n.participantUnitIds
                .map(
                  (id) =>
                    op.units.find((u) => u.id === id)?.name ?? "Missing unit",
                )
                .join(", "),
              n.system,
              n.channel,
              n.callsign,
            ].map(e);
          }),
      );
    case "PACE":
      return tableHtml(
        [
          "Plan",
          "Primary",
          "Alternate",
          "Contingency",
          "Emergency",
          "Lost communications",
        ],
        op.signal.pacePlans
          .filter(
            (p) =>
              (!profile?.inclusion.audienceUnitIds.length ||
                !p.unitIds.length ||
                p.unitIds.some((id) =>
                  profile.inclusion.audienceUnitIds.includes(id),
                )) &&
              (!profile?.inclusion.phaseIds.length ||
                !p.phaseIds.length ||
                p.phaseIds.some((id) =>
                  profile.inclusion.phaseIds.includes(id),
                )),
          )
          .map((p, index) => {
            track(`modules/${m.moduleInstanceId}/pace-order/${p.id}`, index);
            reference({ kind: "pace", id: p.id });
            return [
              p.name,
              p.primary,
              p.alternate,
              p.contingency,
              p.emergency,
              p.lostCommunications,
            ].map(e);
          }),
      );
    case "REPORT_CATALOG":
      return c.data.kind === "reports"
        ? tableHtml(
            ["Report", "Format", "Submission", "Recipient", "Event"],
            c.data.reports.map((r) => [
              e(r.name),
              e(r.format),
              e(r.submission),
              e(
                r.recipientUnitId
                  ? reference({ kind: "unit", id: r.recipientUnitId })
                  : "",
              ),
              e(r.eventId ? reference({ kind: "event", id: r.eventId }) : ""),
            ]),
          )
        : "";
    case "DISTRIBUTION_LIST":
      return c.data.kind === "distribution"
        ? tableHtml(
            [
              "Recipient",
              "Duty",
              "Unit",
              "Location",
              "Purpose",
              "Copy",
              "Method",
              "Acknowledgment",
            ],
            c.data.recipients.map((r) =>
              [
                r.recipient,
                r.dutyPosition,
                r.unitId ? reference({ kind: "unit", id: r.unitId }) : "",
                r.location,
                r.distributionPurpose,
                r.copyNumber,
                r.method,
                r.acknowledgmentRequired ? "Required" : "Not required",
              ].map(e),
            ),
          )
        : "";
    default:
      return `<p>${e(c.message)}</p>`;
  }
}
