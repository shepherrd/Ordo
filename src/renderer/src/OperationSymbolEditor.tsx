import { useState } from "react";
import { useUnappliedSymbolEdits } from "./WorkspaceContext";
import type { Unit } from "../../domain/model";
import {
  inheritedSymbol,
  newSymbolDefinition,
  resolveSymbol,
  type OperationSymbolState,
  type SavedSymbolPin,
} from "../../domain/symbology";
import { SavedSymbolPicker } from "./SavedSymbolPicker";
import { SymbolEditor } from "./SymbolEditor";
import { GraphicPreview } from "./GraphicPreview";
import { Field } from "./Fields";
import "./symbology.css";
export default function OperationSymbolEditor({
  unit,
  parentName,
  onChange,
  active,
}: {
  unit: Unit;
  parentName: string | null;
  onChange: (state: OperationSymbolState) => void;
  active: boolean;
}) {
  const unapplied = useUnappliedSymbolEdits();
  const [picker, setPicker] = useState(false),
    [editing, setEditing] = useState(false),
    state = unit.symbol;
  // A SIDC may be incomplete while typing. Keep authoring available until it is valid.
  let previewDefinition = state
    ? (state.override ?? state.base).definition
    : undefined;
  if (state) {
    try {
      previewDefinition = resolveSymbol(state, unit.name, parentName);
    } catch {
      /* The render boundary shows validation diagnostics for this draft. */
    }
  }
  const replace = (pin: SavedSymbolPin) => {
    if (!state) onChange(inheritedSymbol(pin));
    else {
      const { definition, definitionHash: _h, ...source } = pin;
      onChange({ ...state, override: { definition, source } });
    }
    setPicker(false);
  };
  const edit = () => {
    if (!state) {
      const definition = newSymbolDefinition(() => crypto.randomUUID());
      onChange({
        schemaVersion: 1,
        base: { definition, source: null },
        override: null,
        labels: {
          uniqueDesignation: { kind: "UNIT_NAME" },
          higherFormation: { kind: "DEFINITION" },
        },
      });
    } else if (!state.override) {
      const definition = structuredClone(state.base.definition);
      definition.definitionId = crypto.randomUUID();
      if (state.base.source)
        definition.origin = { kind: "SAVED_SYMBOL", source: state.base.source };
      onChange({ ...state, override: { definition, source: null } });
    }
    setEditing(true);
  };
  return (
    <section className="operation-symbol-editor">
      <p>
        Symbol for this operation:{" "}
        {state?.override
          ? "customized for this operation"
          : state
            ? "original symbol"
            : "unassigned"}
        . Unit identity and hierarchy are shared by both Task Organization
        views.
      </p>
      <div className="button-row">
        <button disabled={unapplied} onClick={() => setPicker(true)}>
          Choose saved symbol
        </button>
        <button disabled={unapplied} onClick={edit}>
          {state ? "Edit unit symbol" : "Create operation symbol"}
        </button>
        {state?.override && (
          <button
            disabled={unapplied}
            onClick={() => {
              onChange({ ...state, override: null });
              setEditing(false);
            }}
          >
            Restore original symbol
          </button>
        )}
      </div>
      {state && (
        <>
          <div className="field-grid">
            {(["uniqueDesignation", "higherFormation"] as const).map((key) => (
              <div key={key}>
                <label className="field">
                  <span>
                    {key === "uniqueDesignation"
                      ? "Designation label"
                      : "Higher formation label"}
                  </span>
                  <select
                    value={state.labels[key].kind}
                    onChange={(e) => {
                      const kind = e.target
                        .value as OperationSymbolState["labels"][typeof key]["kind"];
                      onChange({
                        ...state,
                        labels: {
                          ...state.labels,
                          [key]:
                            kind === "LITERAL" ? { kind, text: "" } : { kind },
                        },
                      });
                    }}
                  >
                    <option value="UNIT_NAME">Use unit name</option>
                    <option value="PARENT_UNIT_NAME">
                      Use parent unit name
                    </option>
                    <option value="DEFINITION">Use original symbol text</option>
                    <option value="LITERAL">Use custom text</option>
                  </select>
                </label>
                {state.labels[key].kind === "LITERAL" && (
                  <Field
                    label={
                      key === "uniqueDesignation"
                        ? "Custom designation"
                        : "Custom higher formation"
                    }
                    value={state.labels[key].text}
                    onChange={(text) =>
                      onChange({
                        ...state,
                        labels: {
                          ...state.labels,
                          [key]: { kind: "LITERAL", text },
                        },
                      })
                    }
                  />
                )}
              </div>
            ))}
          </div>
          {editing ? (
            <>
              <p className="muted">
                Use the label choices above to set the designation and higher
                formation.
              </p>
              <SymbolEditor
                value={(state.override ?? state.base).definition}
                previewDefinition={previewDefinition}
                hiddenAmplifiers={["uniqueDesignation", "higherFormation"]}
                active={active}
                onChange={(definition) =>
                  onChange({ ...state, override: { definition, source: null } })
                }
              />
              <button disabled={unapplied} onClick={() => setEditing(false)}>
                Close symbol editor
              </button>
            </>
          ) : (
            <GraphicPreview
              active={active}
              request={{
                kind: "SYMBOL",
                input: {
                  definition: previewDefinition!,
                  size: 80,
                  context: "SYMBOL",
                  labelSide: "RIGHT",
                },
              }}
            />
          )}
          <details>
            <summary>Original symbol details</summary>
            <p>Base definition {state.base.definition.definitionId}</p>
            {state.base.source && (
              <p>
                Saved Symbol family {state.base.source.familyId}
                <br />
                Exact version {state.base.source.versionId}
                <br />
                SHA-256 {state.base.source.contentHash}
              </p>
            )}
          </details>
        </>
      )}
      {picker && (
        <SavedSymbolPicker
          onCancel={() => setPicker(false)}
          onSelect={replace}
        />
      )}
    </section>
  );
}
