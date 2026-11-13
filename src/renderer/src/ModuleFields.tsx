import { Field, Select, Checks } from "./Fields";
import { RichEditor } from "./RichEditor";
import {
  fieldTypes,
  emptyRich,
  type FieldDefinition,
  type FieldValue,
  type ModuleDefinition,
} from "../../domain/modules";
import type { Operation, ResolvedConfig } from "../../domain/model";
import { factTargets } from "../../domain/authoring";
const uid = () => crypto.randomUUID();
export function FieldValueEditor({
  field,
  value,
  onChange,
  op,
  config,
  assets,
  importImage,
}: {
  field: FieldDefinition;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  op?: Operation;
  config?: ResolvedConfig;
  assets?: Record<string, string>;
  importImage?: () => Promise<string | null>;
}) {
  const name = field.label;
  if (field.type === "RICH_TEXT")
    return (
      <div className="field">
        <span>{name}</span>
        <RichEditor
          label={name}
          value={
            value && typeof value === "object" && !Array.isArray(value)
              ? value
              : emptyRich()
          }
          onChange={onChange}
          assets={assets}
          importImage={importImage}
        />
      </div>
    );
  if (field.type === "BOOLEAN")
    return (
      <label>
        <input
          aria-label={name}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {name}
      </label>
    );
  if (field.type === "SINGLE_SELECT")
    return (
      <Select
        label={name}
        options={field.options.map((o) => ({ id: o.id, name: o.label }))}
        value={typeof value === "string" ? value : null}
        onChange={onChange}
      />
    );
  if (field.type === "MULTI_SELECT")
    return (
      <Checks
        label={name}
        options={field.options.map((o) => ({ id: o.id, name: o.label }))}
        values={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    );
  if (field.type.endsWith("_REFERENCE")) {
    const kind = field.type.split("_")[0].toLowerCase();
    const options =
      kind === "staff"
        ? (config?.doctrine.staff ?? [])
        : !op
          ? []
          : kind === "product"
            ? [{ id: op.orderId, name: "Base order" }, ...op.attachments]
            : factTargets(op, kind as Parameters<typeof factTargets>[1]);
    return (
      <Select
        label={name}
        options={options}
        value={typeof value === "string" ? value : null}
        onChange={onChange}
      />
    );
  }
  const number = ["INTEGER", "DECIMAL", "DURATION"].includes(field.type),
    type = number
      ? "number"
      : ((
          {
            DATE: "date",
            TIME: "time",
            DATETIME: "datetime-local",
            URL: "url",
          } as Record<string, string>
        )[field.type] ?? "text");
  return (
    <Field
      label={name}
      area={field.type === "LONG_TEXT"}
      type={type}
      value={
        value === undefined || value === null
          ? ""
          : field.type === "DATETIME"
            ? String(value).slice(0, 16)
            : String(value)
      }
      onChange={(v) =>
        onChange(
          number
            ? v === ""
              ? null
              : Number(v)
            : field.type === "DATETIME" && v
              ? new Date(v + "Z").toISOString()
              : v,
        )
      }
    />
  );
}
export function DefinitionEditor({
  definition,
  onChange,
  inherited = false,
}: {
  definition: ModuleDefinition;
  onChange: (d: ModuleDefinition) => void;
  inherited?: boolean;
}) {
  const update = (fn: (d: ModuleDefinition) => void) => {
    const d = structuredClone(definition);
    fn(d);
    onChange(d);
  };
  const key = definition.moduleType === "KEY_VALUE" ? "fields" : "columns",
    fields = definition.configuration[key] ?? [];
  return (
    <div className="module-config">
      <fieldset disabled={inherited}>
        <Field
          label="Module title"
          value={definition.title}
          onChange={(v) => update((d) => (d.title = v))}
        />
        <Field
          area
          label="Module description"
          value={definition.description}
          onChange={(v) => update((d) => (d.description = v))}
        />
        <Field
          label="Authoring guidance"
          area
          value={definition.guidance}
          onChange={(v) => update((d) => (d.guidance = v))}
        />
        <label>
          <input
            type="checkbox"
            checked={definition.required}
            onChange={(e) => update((d) => (d.required = e.target.checked))}
          />
          Required module
        </label>
        <label>
          <input
            type="checkbox"
            checked={definition.defaultVisible}
            onChange={(e) =>
              update((d) => (d.defaultVisible = e.target.checked))
            }
          />
          Visible by default
        </label>
      </fieldset>
      {definition.moduleType === "PLAIN_TEXT" && (
        <label>
          <input
            type="checkbox"
            checked={definition.configuration.multiline !== false}
            onChange={(e) =>
              update((d) => (d.configuration.multiline = e.target.checked))
            }
          />
          Multiline
        </label>
      )}
      {["TABLE", "MATRIX"].includes(definition.moduleType) && (
        <label>
          <input
            type="checkbox"
            disabled={inherited}
            checked={!!definition.configuration.allowColumnOverride}
            onChange={(e) =>
              update(
                (d) => (d.configuration.allowColumnOverride = e.target.checked),
              )
            }
          />
          Allow operation column overrides
        </label>
      )}
      {definition.moduleType === "CHART" && (
        <Select
          label="Default chart type"
          value={definition.configuration.chartType ?? "BAR"}
          options={["BAR", "LINE", "PIE", "SCATTER"].map((id) => ({
            id,
            name: id,
          }))}
          onChange={(v) =>
            update((d) => (d.configuration.chartType = (v ?? "BAR") as "BAR"))
          }
        />
      )}
      {definition.moduleType === "TIMELINE" && (
        <Select
          label="Timeline modes"
          value={definition.configuration.timelineMode ?? "MIXED"}
          options={["MIXED", "ABSOLUTE", "RELATIVE"].map((id) => ({
            id,
            name: id,
          }))}
          onChange={(v) =>
            update(
              (d) => (d.configuration.timelineMode = (v ?? "MIXED") as "MIXED"),
            )
          }
        />
      )}
      {["KEY_VALUE", "TABLE", "MATRIX"].includes(definition.moduleType) && (
        <>
          <h4>{key === "fields" ? "Fields" : "Columns"}</h4>
          {fields.map((f, i) => (
            <div className="entity" key={f.id}>
              <div className="two-columns">
                <Field
                  label={`Field label ${i + 1}`}
                  value={f.label}
                  onChange={(v) =>
                    update((d) => (d.configuration[key]![i].label = v))
                  }
                />
                <Select
                  label={`Field type ${i + 1}`}
                  value={f.type}
                  options={fieldTypes.map((id) => ({
                    id,
                    name: id.replaceAll("_", " "),
                  }))}
                  onChange={(v) =>
                    update((d) => {
                      const field = d.configuration[key]![i];
                      field.type = (v ??
                        "SHORT_TEXT") as FieldDefinition["type"];
                      field.options = [
                        "SINGLE_SELECT",
                        "MULTI_SELECT",
                      ].includes(field.type)
                        ? [{ id: uid(), label: "Option 1" }]
                        : [];
                      delete field.defaultValue;
                    })
                  }
                />
              </div>
              <Field
                area
                label={`Field guidance ${i + 1}`}
                value={f.help}
                onChange={(v) =>
                  update((d) => (d.configuration[key]![i].help = v))
                }
              />
              <label>
                <input
                  type="checkbox"
                  checked={f.required}
                  onChange={(e) =>
                    update(
                      (d) =>
                        (d.configuration[key]![i].required = e.target.checked),
                    )
                  }
                />
                Required field
              </label>
              {["SINGLE_SELECT", "MULTI_SELECT"].includes(f.type) && (
                <Field
                  label={`Options ${i + 1}`}
                  value={f.options.map((o) => o.label).join(", ")}
                  onChange={(v) =>
                    update((d) => {
                      d.configuration[key]![i].options = v
                        .split(",")
                        .map((label, j) => ({
                          id: f.options[j]?.id ?? uid(),
                          label: label.trim(),
                        }));
                    })
                  }
                />
              )}
              {!f.type.endsWith("_REFERENCE") && (
                <details>
                  <summary>Default value</summary>
                  <FieldValueEditor
                    field={{ ...f, label: `Default ${f.label}` }}
                    value={f.defaultValue}
                    onChange={(v) =>
                      update((d) => (d.configuration[key]![i].defaultValue = v))
                    }
                  />
                </details>
              )}
              <div className="button-row">
                <button
                  disabled={!i}
                  onClick={() =>
                    update((d) => {
                      const list = d.configuration[key]!;
                      [list[i - 1], list[i]] = [list[i], list[i - 1]];
                    })
                  }
                >
                  Move field up
                </button>
                <button
                  onClick={() =>
                    update((d) => d.configuration[key]!.splice(i, 1))
                  }
                >
                  Remove field
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() =>
              update((d) => {
                const id = uid();
                (d.configuration[key] ??= []).push({
                  id,
                  stableKey: `field-${id}`,
                  label: `${key === "fields" ? "Field" : "Column"} ${fields.length + 1}`,
                  help: "",
                  type: "SHORT_TEXT",
                  required: false,
                  options: [],
                });
              })
            }
          >
            Add {key === "fields" ? "field" : "column"}
          </button>
        </>
      )}
      <details>
        <summary>Module provenance</summary>
        <p>{definition.provenance.sourceClass}</p>
        <p>{definition.provenance.notes}</p>
        {definition.provenance.sourceReferences.map((r, i) => (
          <p key={i}>
            {r.publicationIdentifier} · {r.editionDate} · {r.locator}
          </p>
        ))}
        <small>Stable ID: {definition.moduleDefinitionId}</small>
      </details>
    </div>
  );
}
