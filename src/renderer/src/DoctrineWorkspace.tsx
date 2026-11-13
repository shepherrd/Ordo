import { NarrativeContent } from "./NarrativeContent";
import { countLabel } from "./ui-text";
import { useState, type ReactNode } from "react";
import { Field, Select, Checks, Panel } from "./Fields";
import type { Operation, ResolvedConfig, Finding } from "../../domain/model";
import {
  catalogNodes,
  productFor,
  productCode,
  setApplicability,
  instantiateProduct,
  emptyContent,
  productOwner,
  packageRows,
  factTargets,
  factDescription,
  type PackageFilter,
} from "../../domain/authoring";
import {
  sourceLabels,
  type DoctrineNode,
  type FactReference,
  type ProductContent,
  type Applicability,
} from "../../domain/doctrine";
import { registeredEditor } from "./editorRegistry";
import { ensureModuleLayout } from "../../domain/module-authoring";
import { ResponsibleStaff } from "./ResponsibleStaff";
import { resolveResponsibleStaff } from "../../domain/staff-resolution";
const uid = () => crypto.randomUUID();
export const displayProductCode = (
  node: DoctrineNode,
  config: ResolvedConfig,
) => (config.doctrine.modules ? productCode(node, config) : node.stableKey);
type Shared = {
  op: Operation;
  config: ResolvedConfig;
  change: (edit: (draft: Operation) => void) => void;
};
const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

export function DoctrineTree({
  op,
  config,
  selectedId,
  onSelect,
}: {
  op: Operation;
  config: ResolvedConfig;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const nodes = catalogNodes(config);
  const matching = new Set(
    nodes
      .filter((n) =>
        `${n.stableKey} ${displayProductCode(n, config)} ${n.canonicalTitle} ${n.aliases.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
      .map((n) => n.stableKey),
  );
  if (query)
    for (const key of [...matching]) {
      let n = nodes.find((n) => n.stableKey === key);
      while (n?.parentStableKey) {
        matching.add(n.parentStableKey);
        n = nodes.find((p) => p.stableKey === n!.parentStableKey);
      }
    }
  const render = (parent: string | null, depth = 0): ReactNode =>
    nodes
      .filter(
        (n) =>
          n.parentStableKey === parent && (!query || matching.has(n.stableKey)),
      )
      .map((n) => {
        const children = nodes.some((c) => c.parentStableKey === n.stableKey),
          expanded = !!query || open.has(n.id),
          a = productFor(op, n),
          status =
            n.status === "SPARE"
              ? "Spare"
              : titleCase(a?.applicability ?? "UNDECIDED");
        return (
          <div
            key={n.id}
            role="treeitem"
            aria-expanded={children ? expanded : undefined}
            aria-selected={selectedId === n.id}
          >
            <div
              className={`doctrine-tree-row ${selectedId === n.id ? "active" : ""}`}
              style={{ paddingLeft: depth * 12 }}
            >
              {children ? (
                <button
                  className="tree-toggle"
                  aria-label={`${expanded ? "Collapse" : "Expand"} ${displayProductCode(n, config)}`}
                  onClick={() =>
                    setOpen((old) => {
                      const next = new Set(old);
                      next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                      return next;
                    })
                  }
                >
                  {expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="tree-leaf" />
              )}
              <button
                className="doctrine-select"
                onClick={() => onSelect(n.id)}
                title={`${n.canonicalTitle} · ${status}`}
                aria-label={`${displayProductCode(n, config)} ${n.canonicalTitle}`}
              >
                <b>{n.code}</b>
                <span>
                  {n.canonicalTitle}
                  <small>
                    {status}
                    {n.sourceClass === "FM5_SAMPLE_FORMAT"
                      ? " · Sample format"
                      : ""}
                  </small>
                </span>
              </button>
            </div>
            {children && expanded && (
              <div role="group">{render(n.stableKey, depth + 1)}</div>
            )}
          </div>
        );
      });
  return (
    <div className="doctrine-tree">
      <label className="tree-search">
        <input
          aria-label="Find doctrine product"
          placeholder="Find doctrine product…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div role="tree" aria-label="Doctrine catalog">
        {render(null)}
      </div>
    </div>
  );
}
export function ReferencePicker({
  op,
  value,
  onChange,
  kinds = [
    "unit",
    "task",
    "objective",
    "phase",
    "event",
    "net",
    "pace",
    "signal",
  ],
}: {
  op: Operation;
  value: FactReference[];
  onChange: (refs: FactReference[]) => void;
  kinds?: FactReference["kind"][];
}) {
  return (
    <details className="reference-picker">
      <summary>Linked operation information ({value.length})</summary>
      {kinds.map((kind) => (
        <Checks
          key={kind}
          label={titleCase(kind)}
          options={factTargets(op, kind)}
          values={value.filter((r) => r.kind === kind).map((r) => r.id)}
          onChange={(ids) =>
            onChange([
              ...value.filter((r) => r.kind !== kind),
              ...ids.map((id) => ({ kind, id })),
            ])
          }
        />
      ))}
      {value.map((ref) => (
        <p className="linked-fact" key={`${ref.kind}:${ref.id}`}>
          {factTargets(op, ref.kind).some((t) => t.id === ref.id)
            ? factDescription(op, ref)
            : "Missing reference — remove or repair this link."}
        </p>
      ))}
    </details>
  );
}
export function DoctrineInspector({
  op,
  config,
  node,
  findings,
  onSelect,
}: {
  op: Operation;
  config: ResolvedConfig;
  node: DoctrineNode;
  findings: Finding[];
  onSelect: (id: string) => void;
}) {
  const a = productFor(op, node),
    parent = catalogNodes(config).find(
      (n) => n.stableKey === node.parentStableKey,
    ),
    editor = registeredEditor(node.editorHint);
  const owner = productOwner(op, node, config);
  const staff = resolveResponsibleStaff(op, config, node.id);
  return (
    <>
      <h3>{node.canonicalTitle}</h3>
      <span className="pill">
        {titleCase(node.nodeType)} {node.code}
      </span>
      <dl className="doctrine-metadata">
        <dt>Source</dt>
        <dd>{sourceLabels[node.sourceClass]}</dd>
        <dt>Applicability</dt>
        <dd>
          {node.status === "SPARE"
            ? "Spare"
            : titleCase(a?.applicability ?? "UNDECIDED")}
        </dd>
        <dt>Owner</dt>
        <dd>
          {op.operationOrganizationBinding
            ? staff.label
            : (config.doctrine.staff.find((s) => s.id === owner)?.name ??
              "Unassigned")}
          {node.ownerBehavior === "INHERIT_PARENT" && !a?.metadata.ownerId
            ? " (inherited)"
            : ""}
        </dd>
        {op.operationOrganizationBinding &&
          staff.doctrineLabel !== staff.label && (
            <>
              <dt>Doctrine role</dt>
              <dd>{staff.doctrineLabel}</dd>
            </>
          )}
        <dt>Workflow</dt>
        <dd>
          {config.doctrine.statuses.find((s) => s.id === a?.metadata.statusId)
            ?.name ?? "Not Started"}
        </dd>
        <dt>Purpose</dt>
        <dd>
          <NarrativeContent
            value={
              node.purpose || "No additional purpose specified in this catalog."
            }
          />
        </dd>
        <dt>Applicability guidance</dt>
        <dd>
          <NarrativeContent value={node.normalApplicabilityNotes} />
        </dd>
        <dt>Catalog default</dt>
        <dd>{titleCase(node.defaultApplicability)} — recommendation only</dd>
        <dt>Parent</dt>
        <dd>
          {parent ? (
            <button className="text-button" onClick={() => onSelect(parent.id)}>
              {parent.stableKey} · {parent.canonicalTitle}
            </button>
          ) : (
            "Base OPORD"
          )}
        </dd>
        <dt>Format</dt>
        <dd>{titleCase(node.formatType)}</dd>

        <dt>References</dt>
        <dd>
          {node.sourceReferences.map((r, i) => (
            <p key={i}>
              {r.publicationIdentifier} · {r.title}
              <br />
              {r.editionDate}; Change {r.changeNumber}, {r.changeDate ?? "none"}
              <br />
              {r.locator}
            </p>
          ))}
        </dd>
        {!!node.aliases.length && (
          <>
            <dt>Aliases</dt>
            <dd>{node.aliases.join("; ")}</dd>
          </>
        )}
        {node.sourceVariants.map((v, i) => (
          <div key={i}>
            <dt>{sourceLabels[v.sourceClass]}</dt>
            <dd>
              {v.title}
              <small>{v.note}</small>
              {v.sourceReferences.map((r, j) => (
                <small key={j}>
                  {r.publicationIdentifier} · {r.editionDate} · Change{" "}
                  {r.changeNumber} ({r.changeDate}) · {r.locator}
                </small>
              ))}
            </dd>
          </div>
        ))}
        {node.sourceNotes && (
          <>
            <dt>Source note</dt>
            <dd>{node.sourceNotes}</dd>
          </>
        )}
        <dt>Cross-references</dt>
        <dd>
          {node.crossReferences.length
            ? node.crossReferences.map((key) => {
                const n = catalogNodes(config).find(
                  (n) => n.stableKey === key,
                )!;
                return (
                  <button
                    key={key}
                    className="text-button"
                    onClick={() => onSelect(n.id)}
                  >
                    {key} · {n.canonicalTitle}
                  </button>
                );
              })
            : "None specified"}
          <small>Open a related product</small>
        </dd>
        <dt>Specialist sources</dt>
        <dd>{node.specialistDoctrineSources.join("; ") || "None specified"}</dd>
        <dt>Issues to review</dt>
        <dd>
          {findings
            .filter((f) => f.entityId === node.id || f.entityId === a?.id)
            .map((f, i) => (
              <p key={i}>{f.message}</p>
            ))}
          {!findings.some(
            (f) => f.entityId === node.id || f.entityId === a?.id,
          ) && "No findings for this product"}
        </dd>
      </dl>
      <details>
        <summary>Technical details</summary>
        <p>
          Editor: {editor.label}
          {editor.fallback ? " (general editor)" : ""}
        </p>
        <code>{node.id}</code>
        <p>{node.stableKey}</p>
        {a && <code>{a.id}</code>}
      </details>
    </>
  );
}
export function StructuredEditor({
  op,
  content,
  onChange,
}: {
  op: Operation;
  content: ProductContent;
  onChange: (c: ProductContent) => void;
}) {
  const edit = (fn: (c: ProductContent) => void) => {
    const c = structuredClone(content);
    fn(c);
    onChange(c);
  };
  return (
    <div className="structured-editor" data-editor={content.kind}>
      {content.kind === "narrative" &&
        content.sections.map((s, i) => (
          <Field
            key={s.id}
            contentId={s.id}
            area
            label={s.title}
            value={s.text}
            onChange={(v) =>
              edit((c) => {
                if (c.kind === "narrative") c.sections[i].text = v;
              })
            }
          />
        ))}
      {content.kind === "generic" && (
        <>
          <p className="hint">
            Use fields for this product’s own authored material. Link existing
            operational facts below.
          </p>
          {content.fields.map((f, i) => (
            <div className="entity" key={f.id} data-content-id={f.id}>
              <Field
                label={`Field ${i + 1} label`}
                value={f.label}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "generic") c.fields[i].label = v;
                  })
                }
              />
              <Field
                label={`Field ${i + 1} value`}
                area
                value={f.value}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "generic") c.fields[i].value = v;
                  })
                }
              />
              <button
                onClick={() =>
                  edit((c) => {
                    if (c.kind === "generic") c.fields.splice(i, 1);
                  })
                }
              >
                Remove field
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              edit((c) => {
                if (c.kind === "generic")
                  c.fields.push({ id: uid(), label: "New field", value: "" });
              })
            }
          >
            Add field
          </button>
        </>
      )}
      {content.kind === "matrix" && (
        <>
          <div className="matrix-columns">
            {content.columns.map((col, i) => (
              <div key={col.id}>
                <Field
                  label={`Column ${i + 1}`}
                  value={col.title}
                  onChange={(v) =>
                    edit((c) => {
                      if (c.kind === "matrix") c.columns[i].title = v;
                    })
                  }
                />
                <button
                  aria-label={`Remove column ${i + 1}`}
                  onClick={() =>
                    edit((c) => {
                      if (c.kind === "matrix") {
                        c.columns.splice(i, 1);
                        c.rows.forEach((r) => {
                          delete r.cells[col.id];
                        });
                      }
                    })
                  }
                >
                  Remove column
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() =>
              edit((c) => {
                if (c.kind === "matrix")
                  c.columns.push({ id: uid(), title: "New column" });
              })
            }
          >
            Add column
          </button>
          <div className="table-scroll">
            <table className="authoring-table">
              <thead>
                <tr>
                  {content.columns.map((c) => (
                    <th key={c.id}>{c.title}</th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {content.rows.map((row, i) => (
                  <tr key={row.id} data-content-id={row.id}>
                    {content.columns.map((col) => (
                      <td key={col.id} data-column-id={col.id}>
                        <Field
                          area
                          label={`Row ${i + 1} ${col.title}`}
                          value={row.cells[col.id] ?? ""}
                          onChange={(e) =>
                            edit((c) => {
                              if (c.kind === "matrix")
                                c.rows[i].cells[col.id] = e;
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() =>
                          edit((c) => {
                            if (c.kind === "matrix") c.rows.splice(i, 1);
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={() =>
              edit((c) => {
                if (c.kind === "matrix") c.rows.push({ id: uid(), cells: {} });
              })
            }
          >
            Add row
          </button>
        </>
      )}
      {content.kind === "checklist" && (
        <>
          {content.items.map((item, i) => (
            <div key={item.id} className="checklist-row">
              <input
                type="checkbox"
                aria-label={`Complete item ${i + 1}`}
                checked={item.checked}
                onChange={(e) =>
                  edit((c) => {
                    if (c.kind === "checklist")
                      c.items[i].checked = e.target.checked;
                  })
                }
              />
              <Field
                label={`Checklist item ${i + 1}`}
                value={item.text}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "checklist") c.items[i].text = v;
                  })
                }
              />
              <button
                aria-label={`Remove item ${i + 1}`}
                onClick={() =>
                  edit((c) => {
                    if (c.kind === "checklist") c.items.splice(i, 1);
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              edit((c) => {
                if (c.kind === "checklist")
                  c.items.push({ id: uid(), text: "", checked: false });
              })
            }
          >
            Add checklist item
          </button>
        </>
      )}
      {content.kind === "reports" && (
        <>
          {content.reports.map((r, i) => (
            <div className="entity" key={r.id}>
              <Field
                label={`Report ${i + 1} name`}
                value={r.name}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "reports") c.reports[i].name = v;
                  })
                }
              />
              <Field
                label="Format / reference"
                value={r.format}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "reports") c.reports[i].format = v;
                  })
                }
              />
              <Field
                label="Submission instructions"
                area
                value={r.submission}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "reports") c.reports[i].submission = v;
                  })
                }
              />
              <Select
                label="Recipient unit"
                options={op.units}
                value={r.recipientUnitId}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "reports") c.reports[i].recipientUnitId = v;
                  })
                }
              />
              <Select
                label="Timeline event"
                options={op.events}
                value={r.eventId}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "reports") c.reports[i].eventId = v;
                  })
                }
              />
              <button
                onClick={() =>
                  edit((c) => {
                    if (c.kind === "reports") c.reports.splice(i, 1);
                  })
                }
              >
                Remove report
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              edit((c) => {
                if (c.kind === "reports")
                  c.reports.push({
                    id: uid(),
                    name: "New report",
                    format: "",
                    submission: "",
                    recipientUnitId: null,
                    eventId: null,
                  });
              })
            }
          >
            Add report
          </button>
        </>
      )}
      {content.kind === "distribution" && (
        <>
          {content.recipients.map((r, i) => (
            <div className="entity" key={r.id}>
              {(
                [
                  ["recipient", `Recipient ${i + 1}`],
                  ["dutyPosition", "Duty position"],
                  ["location", "Location"],
                  ["distributionPurpose", "Distribution purpose"],
                  ["copyNumber", "Copy number"],
                  ["method", "Delivery method"],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={r[key]}
                  onChange={(v) =>
                    edit((c) => {
                      if (c.kind === "distribution") c.recipients[i][key] = v;
                    })
                  }
                />
              ))}
              <Select
                label="Recipient unit"
                options={op.units}
                value={r.unitId}
                onChange={(v) =>
                  edit((c) => {
                    if (c.kind === "distribution") c.recipients[i].unitId = v;
                  })
                }
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={r.acknowledgmentRequired}
                  onChange={(e) =>
                    edit((c) => {
                      if (c.kind === "distribution")
                        c.recipients[i].acknowledgmentRequired =
                          e.target.checked;
                    })
                  }
                />
                Acknowledgment required
              </label>
              <button
                onClick={() =>
                  edit((c) => {
                    if (c.kind === "distribution") c.recipients.splice(i, 1);
                  })
                }
              >
                Remove recipient
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              edit((c) => {
                if (c.kind === "distribution")
                  c.recipients.push({
                    id: uid(),
                    recipient: "New recipient",
                    dutyPosition: "",
                    unitId: null,
                    location: "",
                    distributionPurpose: "",
                    copyNumber: "",
                    method: "",
                    acknowledgmentRequired: false,
                  });
              })
            }
          >
            Add recipient
          </button>
        </>
      )}
      <ReferencePicker
        op={op}
        value={content.references}
        onChange={(refs) =>
          edit((c) => {
            c.references = refs;
          })
        }
      />
    </div>
  );
}
export function DoctrineProduct({
  op,
  config,
  change,
  node,
  onError,
  onSelect,
  units,
  signal,
}: {
  node: DoctrineNode;
  onError: (message: string) => void;
  onSelect: (id: string) => void;
  units: () => ReactNode;
  signal: () => ReactNode;
} & Shared) {
  const [ownerOverride, setOwnerOverride] = useState(false);
  const hasModules = !!config.doctrine.modules?.layouts.find(
    (l) => l.productId === node.id,
  )?.definitions.length;
  const a = productFor(op, node),
    editor = registeredEditor(node.editorHint),
    children = catalogNodes(config).filter(
      (n) => n.parentStableKey === node.stableKey,
    );
  const apply = (value: Applicability) => {
    try {
      const draft = structuredClone(op);
      setApplicability(draft, config, node.id, value, uid);
      if (hasModules)
        ensureModuleLayout(
          draft,
          config,
          node.id,
          uid,
          new Date().toISOString(),
        );
      change((d) => {
        d.attachments = draft.attachments;
        if (draft.modules) d.modules = draft.modules;
      });
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const start = () =>
    change((d) => {
      const p = instantiateProduct(d, config, node.id, uid);
      if (!["units", "signal"].includes(editor.implementation) && !p.content)
        p.content = emptyContent(node, uid);
    });
  return (
    <>
      <Panel
        title={`${titleCase(node.nodeType)} ${displayProductCode(node, config)} · ${node.canonicalTitle}`}
        subtitle={sourceLabels[node.sourceClass]}
      >
        <div className="product-state">
          <span className="pill">
            {node.status === "SPARE"
              ? "Spare"
              : titleCase(a?.applicability ?? "UNDECIDED")}
          </span>
          <span>{editor.label}</span>
        </div>
        {node.status === "SPARE" ? (
          <p>
            Reserved spare. An explicit organization profile override is
            required before repurposing.
          </p>
        ) : (
          <>
            <div className="button-row">
              <button
                onClick={() => apply("INCLUDED")}
                disabled={a?.applicability === "INCLUDED"}
              >
                Include
              </button>
              <button
                onClick={() => apply("OMITTED")}
                disabled={a?.applicability === "OMITTED"}
              >
                Omit
              </button>
              <button
                onClick={() => apply("UNDECIDED")}
                disabled={!a || a.applicability === "UNDECIDED"}
              >
                Reset to undecided
              </button>
            </div>
            <p className="hint">
              Choose Include to add this product to the order package. Save the
              operation to keep your choice.
            </p>
          </>
        )}
        {node.alternativeToStableKey && (
          <p className="notice">
            Sample-format alternative to {node.alternativeToStableKey}. Only one
            alternative can be included.
          </p>
        )}
        {node.sourceNotes && <p className="hint">{node.sourceNotes}</p>}
        {a && (
          <div className="two-columns">
            {op.operationOrganizationBinding ? (
              <ResponsibleStaff
                op={op}
                config={config}
                nodeId={node.id}
                change={change}
              />
            ) : (
              <div className="staff-assignment">
                <span>Responsible Staff</span>
                <strong>
                  {config.doctrine.staff.find(
                    (s) => s.id === productOwner(op, node, config),
                  )?.name ?? "Unassigned"}
                </strong>
                <small>
                  {a.metadata.ownerId
                    ? "Operational override"
                    : node.ownerBehavior === "INHERIT_PARENT"
                      ? `Inherited from ${catalogNodes(config).find((n) => n.stableKey === node.parentStableKey)?.canonicalTitle ?? "parent"}`
                      : "Doctrine default"}
                </small>
                {a.metadata.ownerId && (
                  <p className="hint">
                    Doctrine default:{" "}
                    {node.responsibleStaff
                      .map(
                        (id) =>
                          config.doctrine.staff.find((s) => s.id === id)
                            ?.name ?? id,
                      )
                      .join(", ") || "Inherit from parent"}
                  </p>
                )}
                {ownerOverride ? (
                  <Select
                    label="Responsible Staff override"
                    options={config.doctrine.staff}
                    value={a.metadata.ownerId}
                    empty="Use doctrine default"
                    onChange={(v) => {
                      change(
                        (d) => (productFor(d, node)!.metadata.ownerId = v),
                      );
                      setOwnerOverride(false);
                    }}
                  />
                ) : (
                  <button onClick={() => setOwnerOverride(true)}>
                    Override
                  </button>
                )}
                {a.metadata.ownerId && (
                  <button
                    onClick={() => {
                      change(
                        (d) => (productFor(d, node)!.metadata.ownerId = null),
                      );
                      setOwnerOverride(false);
                    }}
                  >
                    Restore doctrine default
                  </button>
                )}
              </div>
            )}
            <Select
              label="Product workflow"
              options={config.doctrine.statuses}
              value={a.metadata.statusId}
              onChange={(v) =>
                change((d) => {
                  productFor(d, node)!.metadata.statusId =
                    v ?? config.doctrine.editingStatus;
                })
              }
            />
          </div>
        )}
      </Panel>
      {children.length > 0 && (
        <Panel
          title="Available child products"
          subtitle="Catalog entries remain available whether included, omitted, or undecided."
        >
          <div className="product-links">
            {children.map((child) => (
              <button key={child.id} onClick={() => onSelect(child.id)}>
                <b>{child.code}</b> {child.canonicalTitle}
                <small>
                  {sourceLabels[child.sourceClass]} ·{" "}
                  {titleCase(
                    productFor(op, child)?.applicability ?? "UNDECIDED",
                  )}
                </small>
              </button>
            ))}
          </div>
        </Panel>
      )}
      {!hasModules &&
        node.status !== "SPARE" &&
        (!a ||
          (!a.content &&
            !["units", "signal"].includes(editor.implementation))) && (
          <Panel
            title="Author this product"
            subtitle="Start writing the content for this product."
          >
            <button onClick={start}>Start authoring</button>
          </Panel>
        )}
      {!hasModules && a && editor.implementation === "units" && <>{units()}</>}
      {!hasModules && a && editor.implementation === "signal" && (
        <>
          <p className="notice">
            This view edits the authoritative Signal workspace. Communications
            Cards derive from the same nets and PACE plans.
          </p>
          {signal()}
        </>
      )}
      {a?.content && (
        <Panel
          title={hasModules ? `Legacy content · ${editor.label}` : editor.label}
          subtitle={
            editor.capability === "PLACEHOLDER_GRAPHIC"
              ? "Record graphic references and notes here. Map editing is not available."
              : editor.fallback
                ? "Use the general editor for this product; a specialized editor is not available."
                : undefined
          }
        >
          <StructuredEditor
            op={op}
            content={a.content}
            onChange={(c) =>
              change((d) => {
                productFor(d, node)!.content = c;
              })
            }
          />
        </Panel>
      )}
    </>
  );
}
export function BaseAuthoring({
  op,
  config,
  change,
  onSignal,
}: { onSignal: () => void } & Shared) {
  const definitions = config.doctrine.catalog!.baseFields;
  const write = (
    id: string,
    edit: (
      field: NonNullable<Operation["authoring"]>["fields"][number],
    ) => void,
  ) =>
    change((d) => {
      let f = d.authoring!.fields.find((f) => f.fieldId === id);
      if (!f) {
        f = { fieldId: id, text: "", references: [] };
        d.authoring!.fields.push(f);
      }
      edit(f);
    });
  return (
    <>
      {config.doctrine.paragraphs.map((p, i) => (
        <Panel
          key={p.id}
          title={`${i + 1}. ${p.title}`}
          paragraphId={p.id}
          subtitle={
            p.id === "execution"
              ? "Intent, concept of operations, assigned tasks, and coordinating instructions."
              : undefined
          }
        >
          {op.sections.find((s) => s.id === p.id)?.summary && (
            <div className="legacy-narrative">
              <b>Existing paragraph narrative</b>
              <NarrativeContent
                value={op.sections.find((s) => s.id === p.id)!.summary}
              />
            </div>
          )}
          {definitions
            .filter((f) => f.paragraphId === p.id)
            .map((definition) => {
              const value = op.authoring?.fields.find(
                (f) => f.fieldId === definition.id,
              );
              return (
                <section
                  key={definition.id}
                  data-entity-id={definition.id}
                  data-field-id={definition.id}
                  className={`base-subparagraph ${definition.parentStableKey ? "nested" : ""}`}
                >
                  <h3>{definition.title}</h3>
                  {definition.guidance && (
                    <NarrativeContent value={definition.guidance} />
                  )}
                  {definition.contentKind ===
                  "group" ? null : definition.contentKind ===
                    "canonical-tasks" ? (
                    <div className="canonical-task-view">
                      {op.tasks.map((t) => (
                        <article key={t.id}>
                          <b>
                            {op.units.find((u) => u.id === t.unitId)?.name ??
                              "Unassigned"}{" "}
                            · {t.name}
                          </b>
                          <div>
                            Purpose:{" "}
                            <NarrativeContent
                              value={t.purpose || "Not entered"}
                            />
                          </div>
                          <small>
                            {op.phases.find((p) => p.id === t.phaseId)?.name}{" "}
                            {
                              op.objectives.find((o) => o.id === t.objectiveId)
                                ?.name
                            }
                          </small>
                        </article>
                      ))}
                      {!op.tasks.length && (
                        <p>Add and edit tasks in Tasks & objectives.</p>
                      )}
                    </div>
                  ) : definition.contentKind === "structured-fields" ? (
                    <>
                      {(value?.entries ?? []).map((entry, i) => (
                        <div
                          className="entity"
                          key={entry.id}
                          data-entry-id={entry.id}
                        >
                          <Field
                            label={`End state field ${i + 1}`}
                            value={entry.label}
                            onChange={(v) =>
                              write(definition.id, (f) => {
                                f.entries![i].label = v;
                              })
                            }
                          />
                          <Field
                            label={`End state value ${i + 1}`}
                            area
                            value={entry.value}
                            onChange={(v) =>
                              write(definition.id, (f) => {
                                f.entries![i].value = v;
                              })
                            }
                          />
                          <ReferencePicker
                            op={op}
                            value={entry.references}
                            kinds={definition.bindings}
                            onChange={(refs) =>
                              write(definition.id, (f) => {
                                f.entries![i].references = refs;
                              })
                            }
                          />
                          <button
                            onClick={() =>
                              write(definition.id, (f) => {
                                f.entries!.splice(i, 1);
                              })
                            }
                          >
                            Remove end state field
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() =>
                          write(definition.id, (f) => {
                            (f.entries ??= []).push({
                              id: uid(),
                              label: "Desired condition",
                              value: "",
                              references: [],
                            });
                          })
                        }
                      >
                        Add end state field
                      </button>
                    </>
                  ) : definition.contentKind === "task-collection" ? (
                    <Checks
                      label="Key tasks"
                      options={op.tasks}
                      values={
                        value?.references
                          .filter((r) => r.kind === "task")
                          .map((r) => r.id) ?? []
                      }
                      onChange={(ids) =>
                        write(definition.id, (f) => {
                          f.references = ids.map((id) => ({
                            kind: "task",
                            id,
                          }));
                        })
                      }
                    />
                  ) : (
                    <Field
                      label={definition.title}
                      hideLabel
                      area
                      value={value?.text ?? ""}
                      onChange={(v) =>
                        write(definition.id, (f) => {
                          f.text = v;
                        })
                      }
                    />
                  )}
                  {definition.bindings.length > 0 &&
                    ![
                      "canonical-tasks",
                      "task-collection",
                      "structured-fields",
                    ].includes(definition.contentKind) && (
                      <ReferencePicker
                        op={op}
                        value={value?.references ?? []}
                        kinds={definition.bindings}
                        onChange={(refs) =>
                          write(definition.id, (f) => {
                            f.references = refs;
                          })
                        }
                      />
                    )}
                  {definition.stableKey === "signal" && (
                    <button onClick={onSignal}>Open Signal / Annex H</button>
                  )}
                </section>
              );
            })}
        </Panel>
      ))}
    </>
  );
}
export function PackageComposer({
  op,
  config,
  findings,
  onSelect,
  onBase,
}: {
  op: Operation;
  config: ResolvedConfig;
  findings: Finding[];
  onSelect: (id: string) => void;
  onBase: () => void;
}) {
  const [filter, setFilter] = useState<PackageFilter>("All"),
    [owner, setOwner] = useState("");
  const rows = packageRows(op, config, findings, filter, owner);
  return (
    <Panel
      title="Planning package"
      subtitle="The package includes products marked Included when their parent products are also Included. Published orders keep the package as it was when published."
    >
      <div className="two-columns">
        <label className="field">
          <span>Package filter</span>
          <select
            aria-label="Package filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value as PackageFilter)}
          >
            {[
              "All",
              "Included",
              "Omitted",
              "Undecided",
              "Spare",
              "Has Issues",
              "By Owner",
            ].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        {filter === "By Owner" && (
          <Select
            label="Package owner"
            value={owner}
            options={config.doctrine.staff}
            onChange={(v) => setOwner(v ?? "")}
          />
        )}
      </div>
      {filter === "All" && (
        <button className="base-package-row" onClick={onBase}>
          <b>Base OPORD</b> Always included ·{" "}
          {
            config.doctrine.statuses.find((s) => s.id === op.metadata.statusId)
              ?.name
          }{" "}
          ·{" "}
          {countLabel(
            findings.filter((f) => f.entityId === op.orderId).length,
            "finding",
          )}
        </button>
      )}
      <p className="hint">
        {rows.length} catalog products shown. Inclusion changes are made in each
        product’s authoring view.
      </p>
      <div className="table-scroll">
        <table className="authoring-table package-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Applicability</th>
              <th>Owner / workflow</th>
              <th>Content</th>
              <th>Findings / preview</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.node.id} data-product-key={r.node.stableKey}>
                <td>
                  <button
                    className="text-button"
                    onClick={() => onSelect(r.node.id)}
                  >
                    {displayProductCode(r.node, config)} ·{" "}
                    {r.node.canonicalTitle}
                  </button>
                  <small>{sourceLabels[r.node.sourceClass]}</small>
                </td>
                <td>
                  {r.node.status === "SPARE"
                    ? "Spare"
                    : titleCase(r.applicability)}
                </td>
                <td>
                  {config.doctrine.staff.find((s) => s.id === r.ownerId)
                    ?.name ?? "Unassigned"}
                  <small>
                    {config.doctrine.statuses.find((s) => s.id === r.statusId)
                      ?.name ?? "Not Started"}
                  </small>
                </td>
                <td>{r.hasContent ? "Has content" : "Empty"}</td>
                <td>
                  {countLabel(r.findings.length, "finding")}
                  <small>{r.inPreview ? "In preview" : "Not in preview"}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
