import type {
  Finding,
  Metadata,
  Operation,
  ResolvedConfig,
} from "../../domain/model";
import { catalogNodes } from "../../domain/authoring";
import { DoctrineInspector } from "./DoctrineWorkspace";
import { Field, Select } from "./Fields";
import { taskUnitOptions } from "./TaskUnitPicker";

function recordGroups(op: Operation) {
  return [
    { name: "Units", items: op.units },
    { name: "Tasks", items: op.tasks },
    { name: "Objectives", items: op.objectives },
    { name: "Phases", items: op.phases },
    { name: "Timeline events", items: op.events },
    { name: "Order attachments", items: op.attachments },
    { name: "Radio nets", items: op.signal.nets },
    { name: "PACE plans", items: op.signal.pacePlans },
  ];
}
export function OverviewInspector({
  op,
  config,
  findings,
  selectedId,
  onSelect,
  onProduct,
  onFindings,
  change,
}: {
  op: Operation;
  config: ResolvedConfig;
  findings: Finding[];
  selectedId: string;
  onSelect: (id: string) => void;
  onProduct: (id: string) => void;
  onFindings: () => void;
  change: (edit: (draft: Operation) => void) => void;
}) {
  const groups = recordGroups(op);
  const record =
    groups
      .flatMap(
        (g): { id: string; name: string; metadata: Metadata }[] => g.items,
      )
      .find((r) => r.id === selectedId) ?? op;
  const nodes = catalogNodes(config);
  const node = nodes.find((n) => n.id === selectedId);
  const names = new Map(taskUnitOptions(op.units).map((u) => [u.id, u.name]));
  const update = (edit: (m: Metadata) => void) =>
    change((draft) => {
      if (record.id === draft.id) edit(draft.metadata);
      else
        for (const group of recordGroups(draft)) {
          const item = group.items.find((r) => r.id === record.id);
          if (item) {
            edit(item.metadata);
            break;
          }
        }
    });
  return (
    <section
      className="panel inspector"
      data-overview-inspector
      aria-label="Inspector"
    >
      <h2>Inspector</h2>
      <div className="inspector-fields">
        <label className="field">
          <span>Inspect record</span>
          <select
            aria-label="Inspect record"
            value={node?.id ?? record.id}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value={op.id}>Operation · {op.name}</option>
            {groups
              .filter((g) => g.items.length)
              .map((g) => (
                <optgroup key={g.name} label={g.name}>
                  {g.items.map((r) => (
                    <option key={r.id} value={r.id}>
                      {names.get(r.id) ?? r.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            {!!nodes.length && (
              <optgroup label="Doctrine guidance">
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.stableKey} · {n.canonicalTitle}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {!node && (
          <>
            <Select
              label="Staff owner"
              options={config.doctrine.staff}
              value={record.metadata.ownerId}
              onChange={(value) =>
                update((m) => {
                  m.ownerId = value;
                })
              }
            />
            <label className="field">
              <span>Workflow status</span>
              <select
                aria-label="Workflow status"
                value={record.metadata.statusId}
                onChange={(e) =>
                  update((m) => {
                    m.statusId = e.target.value;
                  })
                }
              >
                {config.doctrine.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {node ? (
        <DoctrineInspector
          op={op}
          config={config}
          node={node}
          findings={findings}
          onSelect={onProduct}
        />
      ) : (
        <>
          <details className="inspector-section" key={record.id}>
            <summary>Source & references</summary>
            <label className="field">
              <span>Source type</span>
              <select
                value={record.metadata.source.type}
                onChange={(e) =>
                  update((m) => {
                    m.source.type = e.target
                      .value as Metadata["source"]["type"];
                  })
                }
              >
                {[
                  "user-entry",
                  "higher-hq",
                  "guidance",
                  "sop",
                  "import",
                  "derived",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <Field
              label="Source note"
              area
              value={record.metadata.source.note}
              onChange={(v) =>
                update((m) => {
                  m.source.note = v;
                })
              }
            />
            <Field
              label="References (one per line)"
              area
              plain
              value={record.metadata.references.join("\n")}
              onChange={(v) =>
                update((m) => {
                  m.references = v.split("\n");
                })
              }
            />
          </details>
          <details className="inspector-section">
            <summary>Record details</summary>
            <code>{record.id}</code>
            <p>
              Planning revision {op.revision} · Doctrine version{" "}
              {op.doctrineRef.version}
            </p>
            <p>
              {findings.filter((f) => f.entityId === record.id).length} findings
              for this record ·{" "}
              <button className="text-button" onClick={onFindings}>
                Review all findings →
              </button>
            </p>
          </details>
        </>
      )}
    </section>
  );
}
