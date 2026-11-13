import { NarrativeContent } from "./NarrativeContent";
import { PlanningCards } from "./PlanningCards";
import { PlanningTimeline } from "./PlanningTimeline";
import { instantiateProduct } from "../../domain/authoring";
import { useWorkspaceApi } from "./WorkspaceContext";
import { GraphicalProductPreview } from "./GraphicalProductPreview";
import { taskOrganizationGraphic } from "../../export/task-organization-v5";
import { createExportProfile } from "../../domain/factories";
import { useState, type ReactNode } from "react";
import { Panel, Field, Select, Checks } from "./Fields";
import { RichEditor } from "./RichEditor";
import { moduleOptions, registeredModule } from "./editorRegistry";
import { DefinitionEditor, FieldValueEditor } from "./ModuleFields";
import { ReferencePicker, StructuredEditor } from "./DoctrineWorkspace";
import type { Operation, ResolvedConfig } from "../../domain/model";
import {
  newModuleDefinition,
  type ModuleInstance,
  type ModuleContent,
  type ManagedAsset,
} from "../../domain/modules";
import {
  ensureModuleLayout,
  addOperationModule,
  moduleDefinition,
  moduleConfiguration,
  resetModuleLayout,
  moduleFindings,
} from "../../domain/module-authoring";
import { renderModule } from "../../export/module-render";
import {
  needsScheduledTimeline,
  renderScheduledTimeline,
} from "../../export/scheduled-module";
import { renderModularHtml } from "../../export/modular-html";
const uid = () => crypto.randomUUID(),
  now = () => new Date().toISOString();
type Props = {
  op: Operation;
  config: ResolvedConfig;
  nodeId: string | null;
  attachmentId?: string;
  revealTimelineItem?: { moduleId: string; itemId: string };
  change: (fn: (d: Operation) => void) => void;
  units: () => ReactNode;
  signal: () => ReactNode;
  assets: Record<string, string>;
  doctrineSource?: string;
  onAsset: (id: string, data: string) => void;
  onError: (s: string) => void;
};
export function ModuleWorkspace(props: Props) {
  const desktop = useWorkspaceApi();
  const { op, config, nodeId, change, onError } = props;
  const [type, setType] = useState("RICH_TEXT"),
    [reset, setReset] = useState(false),
    [configure, setConfigure] = useState("");
  const productId =
    props.attachmentId ??
    (nodeId
      ? op.attachments.find((a) => a.doctrineNodeId === nodeId)?.id
      : op.orderId);
  const all = (op.modules?.instances ?? [])
    .filter((m) => m.productInstanceId === productId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.moduleInstanceId.localeCompare(b.moduleInstanceId),
    );
  const active = all.filter((m) => m.layoutState === "ACTIVE"),
    definitions =
      config.doctrine.modules?.layouts.find(
        (l) => !props.attachmentId && l.productId === nodeId,
      )?.definitions ?? [];
  const edit = (id: string, fn: (m: ModuleInstance) => void) =>
    change((d) => {
      const m = d.modules!.instances.find((i) => i.moduleInstanceId === id)!;
      fn(m);
      m.updatedAt = now();
    });
  const importAsset = async (
    imageOnly = false,
  ): Promise<ManagedAsset | null> => {
    try {
      const result = await desktop.files({
        type: "asset-import",
        owner: { kind: "operation", id: op.id },
      });
      if (!result?.asset) return null;
      if (imageOnly && !result.asset.mimeType.startsWith("image/"))
        throw Error("Select a PNG, JPEG, GIF, or WebP image");
      const asset = result.asset;
      change((d) => {
        d.modules ??= { schemaVersion: 1, instances: [], assets: [] };
        d.modules.assets.push(asset);
      });
      if (result.data) props.onAsset(asset.assetId, result.data);
      return asset;
    } catch (e) {
      onError(String(e));
      return null;
    }
  };
  return (
    <Panel
      title="Product modules"
      subtitle="Sections supplied by the doctrine. Customize their layout for this operation."
    >
      {!!definitions.length && !all.some((m) => m.origin === "DOCTRINE") && (
        <button
          onClick={() =>
            change((d) => ensureModuleLayout(d, config, nodeId, uid, now()))
          }
        >
          Use doctrine module layout
        </button>
      )}
      {active.map((m, index) => {
        const def = moduleDefinition(m, config);
        return (
          <article
            className="module-card"
            key={m.moduleInstanceId}
            data-module-id={m.moduleInstanceId}
          >
            <div className="module-heading">
              <div>
                <h3>{def?.title ?? "Missing definition"}</h3>
                <small>
                  {def?.moduleType.replaceAll("_", " ")} ·{" "}
                  {m.origin === "OPERATION"
                    ? "Operation-specific module"
                    : m.configurationOverride
                      ? `${props.doctrineSource ?? "Doctrine"} module · operational configuration override`
                      : `${props.doctrineSource ?? "Doctrine"} module`}
                </small>
              </div>
              <div className="button-row">
                <button
                  aria-label={`Move ${def?.title} up`}
                  disabled={!index}
                  onClick={() =>
                    change((d) => {
                      const first = d.modules!.instances.find(
                          (i) => i.moduleInstanceId === m.moduleInstanceId,
                        )!,
                        other = d.modules!.instances.find(
                          (i) =>
                            i.moduleInstanceId ===
                            active[index - 1].moduleInstanceId,
                        )!;
                      [first.position, other.position] = [
                        other.position,
                        first.position,
                      ];
                      first.updatedAt = other.updatedAt = now();
                    })
                  }
                >
                  ↑
                </button>
                <button
                  aria-label={`Move ${def?.title} down`}
                  disabled={index === active.length - 1}
                  onClick={() =>
                    change((d) => {
                      const first = d.modules!.instances.find(
                          (i) => i.moduleInstanceId === m.moduleInstanceId,
                        )!,
                        other = d.modules!.instances.find(
                          (i) =>
                            i.moduleInstanceId ===
                            active[index + 1].moduleInstanceId,
                        )!;
                      [first.position, other.position] = [
                        other.position,
                        first.position,
                      ];
                      first.updatedAt = other.updatedAt = now();
                    })
                  }
                >
                  ↓
                </button>
                <button
                  onClick={() =>
                    setConfigure(
                      configure === m.moduleInstanceId
                        ? ""
                        : m.moduleInstanceId,
                    )
                  }
                >
                  Configure
                </button>
                <button
                  onClick={() =>
                    change((d) => {
                      if (!def) return;
                      const definition = {
                        ...structuredClone(def),
                        moduleDefinitionId: uid(),
                        stableKey: `module-${uid()}`,
                        title: `${def.title} copy`,
                      };
                      const copy = addOperationModule(
                        d,
                        productId!,
                        definition,
                        uid,
                        now(),
                      );
                      copy.content = structuredClone(m.content);
                      if (copy.content.type === "PLANNING_CARDS")
                        copy.content.placements = copy.content.placements.map(
                          (p) => ({ ...p, id: uid() }),
                        );
                      copy.configurationOverride = structuredClone(
                        m.configurationOverride,
                      );
                    })
                  }
                >
                  Duplicate
                </button>
                <button
                  onClick={() =>
                    edit(
                      m.moduleInstanceId,
                      (v) => (v.layoutState = "REMOVED_BY_OPERATION_OVERRIDE"),
                    )
                  }
                >
                  Remove module
                </button>
              </div>
            </div>
            {def?.guidance && <NarrativeContent value={def.guidance} />}
            {configure === m.moduleInstanceId && def && (
              <details open>
                <summary>Module configuration</summary>
                <DefinitionEditor
                  inherited={m.origin === "DOCTRINE"}
                  definition={{
                    ...def,
                    configuration: moduleConfiguration(m, config),
                  }}
                  onChange={(next) =>
                    edit(m.moduleInstanceId, (v) => {
                      if (v.origin === "OPERATION") v.localDefinition = next;
                      else v.configurationOverride = next.configuration;
                    })
                  }
                />
                {m.origin === "DOCTRINE" && (
                  <p className="hint">
                    The title and requirement come from this operation’s
                    doctrine. Adjust the available settings below for this
                    operation.
                  </p>
                )}
                {m.recoveryConfiguration && (
                  <button
                    onClick={() =>
                      edit(m.moduleInstanceId, (v) => {
                        v.configurationOverride = structuredClone(
                          v.recoveryConfiguration,
                        );
                        delete v.recoveryConfiguration;
                      })
                    }
                  >
                    Recover configuration from before reset
                  </button>
                )}
              </details>
            )}
            <ModuleBody
              {...props}
              module={m}
              edit={(fn) => edit(m.moduleInstanceId, fn)}
              importAsset={importAsset}
            />
            {[
              ...new Set(
                moduleFindings(op, config)
                  .filter((f) => f.entityId === m.moduleInstanceId)
                  .map((f) => f.message),
              ),
            ].map((message) => (
              <p className="notice error" key={message}>
                {message}
              </p>
            ))}
          </article>
        );
      })}
      <div className="button-row">
        <Select
          label="Module type"
          value={type}
          options={moduleOptions}
          onChange={(v) => setType(v ?? "RICH_TEXT")}
        />
        <button
          onClick={() =>
            change((d) => {
              const pid =
                props.attachmentId ??
                (type === "PLANNING_CARDS"
                  ? nodeId
                    ? instantiateProduct(d, config, nodeId, uid).id
                    : d.orderId
                  : ensureModuleLayout(d, config, nodeId, uid, now()));
              addOperationModule(
                d,
                pid,
                newModuleDefinition(type, uid()),
                uid,
                now(),
              );
            })
          }
        >
          Add operation module
        </button>
        <button disabled={!all.length} onClick={() => setReset(true)}>
          Reset layout to doctrine default
        </button>
      </div>
      {reset && (
        <div role="dialog" aria-label="Confirm layout reset" className="notice">
          <p>
            Restore doctrine order, visibility, and configuration?
            Operation-added modules move to recovery. All authored content is
            retained. Older saved layouts remain in revision history.
          </p>
          <button
            onClick={() => {
              change((d) =>
                resetModuleLayout(d, config, productId!, true, now()),
              );
              setReset(false);
            }}
          >
            Confirm reset and retain content
          </button>
          <button onClick={() => setReset(false)}>Cancel reset</button>
        </div>
      )}
      {all.some((m) => m.layoutState !== "ACTIVE") && (
        <details>
          <summary>Removed modules / recovery</summary>
          {all
            .filter((m) => m.layoutState !== "ACTIVE")
            .map((m) => (
              <div className="button-row" key={m.moduleInstanceId}>
                <span>
                  {moduleDefinition(m, config)?.title} · content retained
                </span>
                <button
                  onClick={() =>
                    edit(m.moduleInstanceId, (v) => {
                      v.layoutState = "ACTIVE";
                      v.position =
                        Math.max(-1, ...all.map((x) => x.position)) + 1;
                    })
                  }
                >
                  Restore module
                </button>
              </div>
            ))}
        </details>
      )}
    </Panel>
  );
}
function ModuleBody(
  props: Props & {
    module: ModuleInstance;
    edit: (fn: (m: ModuleInstance) => void) => void;
    importAsset: (imageOnly?: boolean) => Promise<ManagedAsset | null>;
  },
) {
  const desktop = useWorkspaceApi();
  const { module: m, op, config, edit, assets, importAsset } = props,
    c = m.content,
    editor = registeredModule(c.type),
    cfg = moduleConfiguration(m, config);
  const [previewTimeline, setPreviewTimeline] = useState(false);
  const update = (fn: (c: ModuleContent) => void) => edit((v) => fn(v.content));
  const importImage = async () => (await importAsset(true))?.assetId ?? null;
  if (c.type === "PLANNING_CARDS")
    return (
      <PlanningCards op={op} config={config} module={m} change={props.change} />
    );
  const imageValue = (assetId: string) => ({
    id: uid(),
    assetId,
    title: "",
    caption: "",
    alt: "",
    width: "full" as const,
    alignment: "center" as const,
  });
  if (c.type === "PLAIN_TEXT")
    return (
      <Field
        label="Module text"
        area={cfg.multiline !== false}
        value={c.text}
        onChange={(v) =>
          update((d) => {
            if (d.type === "PLAIN_TEXT") d.text = v;
          })
        }
      />
    );
  if (c.type === "RICH_TEXT")
    return (
      <RichEditor
        label={`Rich text ${m.moduleInstanceId}`}
        value={c.document}
        assets={assets}
        importImage={importImage}
        onChange={(v) =>
          update((d) => {
            if (d.type === "RICH_TEXT") d.document = v;
          })
        }
      />
    );
  if (c.type === "KEY_VALUE")
    return (
      <div className="module-fields">
        {(cfg.fields ?? []).map((f) => (
          <div key={f.id} data-field-id={f.id}>
            <FieldValueEditor
              field={f}
              value={c.values[f.id]}
              op={op}
              config={config}
              assets={assets}
              importImage={importImage}
              onChange={(v) =>
                update((d) => {
                  if (d.type === "KEY_VALUE") d.values[f.id] = v;
                })
              }
            />
            <div className="hint">
              <NarrativeContent value={f.help} />
              {f.required ? "Required" : ""}
            </div>
          </div>
        ))}
      </div>
    );
  if (c.type === "TABLE" || c.type === "MATRIX")
    return (
      <>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {(cfg.columns ?? []).map((f) => (
                  <th key={f.id}>{f.label}</th>
                ))}
                <th>Row actions</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((row, index) => (
                <tr key={row.id} data-item-id={row.id}>
                  {(cfg.columns ?? []).map((f) => (
                    <td key={f.id} data-field-id={f.id}>
                      <FieldValueEditor
                        field={{ ...f, label: `${f.label} row ${index + 1}` }}
                        value={row.cells[f.id]}
                        op={op}
                        config={config}
                        onChange={(v) =>
                          update((d) => {
                            if (d.type === "TABLE" || d.type === "MATRIX")
                              d.rows[index].cells[f.id] = v;
                          })
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      disabled={!index}
                      onClick={() =>
                        update((d) => {
                          if (d.type === "TABLE" || d.type === "MATRIX")
                            [d.rows[index - 1], d.rows[index]] = [
                              d.rows[index],
                              d.rows[index - 1],
                            ];
                        })
                      }
                    >
                      Move row up
                    </button>
                    <button
                      onClick={() =>
                        update((d) => {
                          if (d.type === "TABLE" || d.type === "MATRIX")
                            d.rows.splice(index, 1);
                        })
                      }
                    >
                      Remove row
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={() =>
            update((d) => {
              if (d.type === "TABLE" || d.type === "MATRIX")
                d.rows.push({
                  id: uid(),
                  cells: Object.fromEntries(
                    (cfg.columns ?? [])
                      .filter((f) => f.defaultValue !== undefined)
                      .map((f) => [f.id, structuredClone(f.defaultValue!)]),
                  ),
                });
            })
          }
        >
          Add row
        </button>
      </>
    );
  if (c.type === "CHECKLIST")
    return (
      <>
        {c.items.map((item, i) => (
          <div className="entity" key={item.id} data-item-id={item.id}>
            <label>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) =>
                  update((d) => {
                    if (d.type === "CHECKLIST")
                      d.items[i].checked = e.target.checked;
                  })
                }
              />
              Complete
            </label>
            {(["text", "notes"] as const).map((key) => (
              <Field
                key={key}
                label={`Checklist ${key} ${i + 1}`}
                value={item[key]}
                onChange={(v) =>
                  update((d) => {
                    if (d.type === "CHECKLIST") d.items[i][key] = v;
                  })
                }
              />
            ))}
            <Select
              label={`Checklist unit ${i + 1}`}
              value={item.unitId}
              options={op.units}
              onChange={(v) =>
                update((d) => {
                  if (d.type === "CHECKLIST") d.items[i].unitId = v;
                })
              }
            />
            <Select
              label={`Checklist event ${i + 1}`}
              value={item.eventId}
              options={op.events}
              onChange={(v) =>
                update((d) => {
                  if (d.type === "CHECKLIST") d.items[i].eventId = v;
                })
              }
            />
            <button
              onClick={() =>
                update((d) => {
                  if (d.type === "CHECKLIST") d.items.splice(i, 1);
                })
              }
            >
              Remove item
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            update((d) => {
              if (d.type === "CHECKLIST")
                d.items.push({
                  id: uid(),
                  text: "",
                  notes: "",
                  checked: false,
                  unitId: null,
                  staffId: null,
                  eventId: null,
                });
            })
          }
        >
          Add checklist item
        </button>
      </>
    );
  if (c.type === "TIMELINE")
    return (
      <>
        <PlanningTimeline
          op={op}
          config={config}
          moduleId={m.moduleInstanceId}
          revealItem={props.revealTimelineItem}
          change={props.change}
        />
        <details onToggle={(e) => setPreviewTimeline(e.currentTarget.open)}>
          <summary>Order preview</summary>
          {previewTimeline && <ModulePreview {...props} />}
        </details>
      </>
    );
  if (c.type === "CHART") {
    const table =
        c.source.mode === "TABLE"
          ? op.modules?.instances.find(
              (m) =>
                m.moduleInstanceId ===
                (c.source as { moduleInstanceId: string }).moduleInstanceId,
            )
          : undefined,
      columns = table ? (moduleConfiguration(table, config).columns ?? []) : [];
    return (
      <>
        <Select
          label="Chart type"
          value={c.chartType}
          options={["BAR", "LINE", "PIE", "SCATTER"].map((id) => ({
            id,
            name: id,
          }))}
          onChange={(v) =>
            update((d) => {
              if (d.type === "CHART") d.chartType = (v ?? "BAR") as "BAR";
            })
          }
        />
        <Select
          label="Linked source table"
          value={c.source.mode === "TABLE" ? c.source.moduleInstanceId : null}
          empty="Direct dataset"
          options={(op.modules?.instances ?? [])
            .filter(
              (t) =>
                ["TABLE", "MATRIX"].includes(t.content.type) &&
                t.layoutState === "ACTIVE",
            )
            .map((t) => ({
              id: t.moduleInstanceId,
              name: moduleDefinition(t, config)?.title ?? t.moduleInstanceId,
            }))}
          onChange={(v) =>
            update((d) => {
              if (d.type !== "CHART") return;
              const t = op.modules?.instances.find(
                  (t) => t.moduleInstanceId === v,
                ),
                cols = t ? (moduleConfiguration(t, config).columns ?? []) : [];
              d.source = v
                ? {
                    mode: "TABLE",
                    moduleInstanceId: v,
                    categoryColumnId: cols[0]?.id ?? uid(),
                    valueColumnIds: [
                      cols.find((f) => ["INTEGER", "DECIMAL"].includes(f.type))
                        ?.id ??
                        cols[1]?.id ??
                        uid(),
                    ],
                  }
                : { mode: "DIRECT", points: [] };
            })
          }
        />
        {c.source.mode === "TABLE" ? (
          <>
            <Select
              label="Category column"
              value={c.source.categoryColumnId}
              options={columns.map((f) => ({ id: f.id, name: f.label }))}
              onChange={(v) =>
                update((d) => {
                  if (d.type === "CHART" && d.source.mode === "TABLE" && v)
                    d.source.categoryColumnId = v;
                })
              }
            />
            <Checks
              label="Value columns"
              options={columns
                .filter((f) =>
                  ["INTEGER", "DECIMAL", "DURATION"].includes(f.type),
                )
                .map((f) => ({ id: f.id, name: f.label }))}
              values={c.source.valueColumnIds}
              onChange={(v) =>
                update((d) => {
                  if (d.type === "CHART" && d.source.mode === "TABLE")
                    d.source.valueColumnIds = v;
                })
              }
            />
          </>
        ) : (
          <>
            {c.source.points.map((p, i) => (
              <div className="three-columns" key={p.id}>
                <Field
                  label={`Category ${i + 1}`}
                  value={p.label}
                  onChange={(v) =>
                    update((d) => {
                      if (d.type === "CHART" && d.source.mode === "DIRECT")
                        d.source.points[i].label = v;
                    })
                  }
                />
                <Field
                  label={`X ${i + 1}`}
                  type="number"
                  value={String(p.x)}
                  onChange={(v) =>
                    update((d) => {
                      if (d.type === "CHART" && d.source.mode === "DIRECT")
                        d.source.points[i].x = Number(v);
                    })
                  }
                />
                <Field
                  label={`Value ${i + 1}`}
                  type="number"
                  value={String(p.value)}
                  onChange={(v) =>
                    update((d) => {
                      if (d.type === "CHART" && d.source.mode === "DIRECT")
                        d.source.points[i].value = Number(v);
                    })
                  }
                />
                <button
                  onClick={() =>
                    update((d) => {
                      if (d.type === "CHART" && d.source.mode === "DIRECT")
                        d.source.points.splice(i, 1);
                    })
                  }
                >
                  Remove point
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                update((d) => {
                  if (d.type === "CHART" && d.source.mode === "DIRECT")
                    d.source.points.push({
                      id: uid(),
                      label: `Category ${d.source.points.length + 1}`,
                      x: d.source.points.length,
                      value: 0,
                    });
                })
              }
            >
              Add data point
            </button>
          </>
        )}
        <ModulePreview {...props} />
      </>
    );
  }
  if (c.type === "IMAGE" || c.type === "IMAGE_GALLERY") {
    const images = c.type === "IMAGE" ? (c.image ? [c.image] : []) : c.images;
    return (
      <>
        {images.map((img, i) => (
          <div className="entity" key={img.id}>
            {assets[img.assetId] ? (
              <img
                className="managed-image"
                src={assets[img.assetId]}
                alt={img.alt}
              />
            ) : (
              <p>Managed image preview unavailable</p>
            )}
            {(["title", "caption", "alt"] as const).map((key) => (
              <Field
                key={key}
                label={`Image ${key} ${i + 1}`}
                value={img[key]}
                onChange={(v) =>
                  update((d) => {
                    const image =
                      d.type === "IMAGE"
                        ? d.image
                        : d.type === "IMAGE_GALLERY"
                          ? d.images[i]
                          : null;
                    if (image) image[key] = v;
                  })
                }
              />
            ))}
            <Select
              label={`Image size ${i + 1}`}
              value={img.width}
              options={["small", "medium", "full"].map((id) => ({
                id,
                name: id,
              }))}
              onChange={(v) =>
                update((d) => {
                  const image =
                    d.type === "IMAGE"
                      ? d.image
                      : d.type === "IMAGE_GALLERY"
                        ? d.images[i]
                        : null;
                  if (image) image.width = (v ?? "full") as "full";
                })
              }
            />
            <Select
              label={`Image alignment ${i + 1}`}
              value={img.alignment}
              options={["left", "center", "right"].map((id) => ({
                id,
                name: id,
              }))}
              onChange={(v) =>
                update((d) => {
                  const image =
                    d.type === "IMAGE"
                      ? d.image
                      : d.type === "IMAGE_GALLERY"
                        ? d.images[i]
                        : null;
                  if (image) image.alignment = (v ?? "center") as "center";
                })
              }
            />
            <button
              disabled={!i}
              onClick={() =>
                update((d) => {
                  if (d.type === "IMAGE_GALLERY")
                    [d.images[i - 1], d.images[i]] = [
                      d.images[i],
                      d.images[i - 1],
                    ];
                })
              }
            >
              Move image up
            </button>
            <button
              onClick={() =>
                update((d) => {
                  if (d.type === "IMAGE") d.image = null;
                  else if (d.type === "IMAGE_GALLERY") d.images.splice(i, 1);
                })
              }
            >
              Remove image
            </button>
          </div>
        ))}
        <button
          onClick={async () => {
            const a = await importAsset(true);
            if (a)
              update((d) => {
                if (d.type === "IMAGE") d.image = imageValue(a.assetId);
                else if (d.type === "IMAGE_GALLERY")
                  d.images.push(imageValue(a.assetId));
              });
          }}
        >
          Import image
        </button>
      </>
    );
  }
  if (c.type === "FILE_ATTACHMENT") {
    const asset = [
      ...(op.modules?.assets ?? []),
      ...(config.doctrine.modules?.assets ?? []),
    ].find((a) => a.assetId === c.assetId);
    return (
      <>
        <Field
          label="Attachment display name"
          value={c.displayName}
          onChange={(v) =>
            update((d) => {
              if (d.type === "FILE_ATTACHMENT") d.displayName = v;
            })
          }
        />
        <Field
          area
          label="Attachment description"
          value={c.description}
          onChange={(v) =>
            update((d) => {
              if (d.type === "FILE_ATTACHMENT") d.description = v;
            })
          }
        />
        {asset && (
          <p>
            {asset.originalFilename} · {asset.mimeType} · {asset.sizeBytes}{" "}
            bytes
          </p>
        )}
        <button
          onClick={async () => {
            const a = await importAsset();
            if (a)
              update((d) => {
                if (d.type === "FILE_ATTACHMENT") {
                  d.assetId = a.assetId;
                  d.displayName = a.originalFilename;
                }
              });
          }}
        >
          Import attachment
        </button>
        {asset && (
          <button
            onClick={() =>
              desktop
                .files({ type: "asset-save", assetId: asset.assetId })
                .catch((e) => props.onError(String(e)))
            }
          >
            Save attachment copy
          </button>
        )}
      </>
    );
  }
  if (c.type === "CANONICAL_REFERENCES")
    return (
      <>
        <ReferencePicker
          op={op}
          value={c.references.filter((r) => r.kind !== "product")}
          onChange={(refs) =>
            update((d) => {
              if (d.type === "CANONICAL_REFERENCES")
                d.references = [
                  ...refs,
                  ...d.references.filter((r) => r.kind === "product"),
                ];
            })
          }
        />
        <Checks
          label="Order product references"
          options={[{ id: op.orderId, name: "Base order" }, ...op.attachments]}
          values={c.references
            .filter((r) => r.kind === "product")
            .map((r) => r.id)}
          onChange={(ids) =>
            update((d) => {
              if (d.type === "CANONICAL_REFERENCES")
                d.references = [
                  ...d.references.filter((r) => r.kind !== "product"),
                  ...ids.map((id) => ({ kind: "product" as const, id })),
                ];
            })
          }
        />
        <ModulePreview {...props} />
      </>
    );
  if (editor.implementation === "units")
    return (
      <>
        {c.type === "TASK_ORGANIZATION" && (
          <>
            <Select
              label="Task Organization product format"
              value={c.presentation?.mode ?? "TABLE"}
              options={["TABLE", "DIAGRAM", "BOTH"].map((id) => ({
                id,
                name: id,
              }))}
              onChange={(mode) =>
                update((d) => {
                  if (d.type === "TASK_ORGANIZATION")
                    d.presentation = {
                      ...(d.presentation ?? {
                        schemaVersion: 1,
                        ancestorPolicy: "BOUNDARY",
                        foldPolicy: "AS_SHOWN",
                        symbolSize: 30,
                      }),
                      mode: mode as "TABLE" | "DIAGRAM" | "BOTH",
                    };
                })
              }
            />
            {c.presentation && c.presentation.mode !== "TABLE" && (
              <>
                <Select
                  label="Parent units"
                  value={c.presentation.ancestorPolicy}
                  options={[
                    { id: "BOUNDARY", name: "Show connection only" },
                    {
                      id: "INCLUDE_CONTEXT",
                      name: "Include parent names and symbols",
                    },
                  ]}
                  onChange={(v) =>
                    update((d) => {
                      if (d.type === "TASK_ORGANIZATION" && d.presentation)
                        d.presentation.ancestorPolicy = v as
                          "BOUNDARY" | "INCLUDE_CONTEXT";
                    })
                  }
                />
                <Select
                  label="Folded branches"
                  value={c.presentation.foldPolicy}
                  options={[
                    { id: "AS_SHOWN", name: "Use operation folds" },
                    { id: "EXPANDED", name: "Expand all units" },
                  ]}
                  onChange={(v) =>
                    update((d) => {
                      if (d.type === "TASK_ORGANIZATION" && d.presentation)
                        d.presentation.foldPolicy = v as
                          "AS_SHOWN" | "EXPANDED";
                    })
                  }
                />
                <ModulePreview {...props} />
              </>
            )}
          </>
        )}
        {props.units()}
      </>
    );
  if (editor.implementation === "signal")
    return (
      <>
        <p>Uses the same Signal data as the order and Communications Cards.</p>
        {props.signal()}
      </>
    );
  if (c.type === "REPORT_CATALOG" || c.type === "DISTRIBUTION_LIST")
    return (
      <StructuredEditor
        op={op}
        content={c.data}
        onChange={(data) =>
          update((d) => {
            if (d.type === "REPORT_CATALOG" && data.kind === "reports")
              d.data = data;
            else if (
              d.type === "DISTRIBUTION_LIST" &&
              data.kind === "distribution"
            )
              d.data = data;
          })
        }
      />
    );
  return <p>{c.type === "UNSUPPORTED" ? c.message : "Unsupported module"}</p>;
}
function ModulePreview({
  module,
  op,
  config,
  assets,
}: Props & { module: ModuleInstance }) {
  let html = "";
  try {
    if (
      module.content.type === "TASK_ORGANIZATION" &&
      module.content.presentation &&
      module.content.presentation.mode !== "TABLE"
    ) {
      const profile = createExportProfile(op, "opord", uid());
      const graphic = taskOrganizationGraphic(op, module, profile);
      return (
        <GraphicalProductPreview
          view={{
            title: "Module preview",
            detail: "full",
            operationName: op.name,
            orderNumber: op.orderNumber,
            demo: op.demo,
            sections: [
              {
                title:
                  moduleDefinition(module, config)?.title ??
                  "Task Organization",
                graphic: graphic.request,
              },
              ...(module.content.presentation.mode === "BOTH"
                ? [
                    {
                      title: "Task Organization table",
                      moduleHtml: renderModule(
                        { ...module, content: { type: "TASK_ORGANIZATION" } },
                        op,
                        config,
                        [],
                      ),
                    },
                  ]
                : []),
            ],
          }}
          provenance="Live read-only preview"
          assets={assets}
        />
      );
    }
    html = renderModularHtml(
      {
        title: "Module preview",
        detail: "full",
        operationName: op.name,
        orderNumber: op.orderNumber,
        demo: op.demo,
        sections: [
          {
            title: moduleDefinition(module, config)?.title ?? "Module",
            moduleHtml: needsScheduledTimeline(module)
              ? renderScheduledTimeline(module, op)
              : renderModule(module, op, config, []),
          },
        ],
      },
      "Live read-only preview",
      undefined,
      assets,
    );
  } catch (e) {
    return <p>{String(e)}</p>;
  }
  return (
    <iframe
      className="module-preview"
      title="Live module preview"
      sandbox=""
      srcDoc={html}
    />
  );
}
