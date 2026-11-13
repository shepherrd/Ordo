import { ModalBackdrop } from "./ModalBackdrop";
import { FmDictionary } from "./FmDictionary";
import { createPortal } from "react-dom";
import { editorError } from "./editor-error";
import {
  useWorkspaceApi,
  useUnappliedSymbolEdits,
  UnappliedSymbolNotice,
} from "./WorkspaceContext";
import { useEffect, useState, type ReactNode } from "react";
import type { MilitarySymbolDefinition } from "../../domain/symbology";
import {
  editNumericSegment,
  numericSegment,
  legacySegments,
  type NumericSegment,
} from "../../domain/symbol-codes";
import type { SymbolCatalogCommand } from "../../application/symbol-catalog";
import { Field } from "./Fields";
import { GraphicPreview } from "./GraphicPreview";
import { LegacySymbolControls } from "./LegacySymbolControls";
import { echelonChoices, mobilityChoices } from "./symbol-size-choices";
import { SymbolThumbnail } from "./SymbolThumbnail";
import { beginSymbolDrag } from "./symbol-transfer";
import { resetSymbolDraft, changeSymbolSet } from "../../domain/symbol-editing";
type Choice = { id: string; name: string; note?: string; symbolSet?: string };
const identities = [
  "Pending",
  "Unknown",
  "Assumed friend",
  "Friend",
  "Neutral",
  "Suspect",
  "Hostile",
];
const statuses = [
  "Present",
  "Planned / anticipated",
  "Fully capable",
  "Damaged",
  "Destroyed",
  "Full to capacity",
];
const hqFlags = [
  "None",
  "Feint / dummy",
  "Headquarters",
  "Feint / dummy headquarters",
  "Task force",
  "Feint / dummy task force",
  "Task force headquarters",
  "Feint / dummy task force headquarters",
];
export function SymbolEditor({
  value,
  onChange,
  readonly = false,
  active = true,
  previewDefinition,
  hiddenAmplifiers = [],
  previewActions,
  previewHost,
  externalDictionary = false,
}: {
  value: MilitarySymbolDefinition;
  onChange: (d: MilitarySymbolDefinition) => void;
  readonly?: boolean;
  active?: boolean;
  previewDefinition?: MilitarySymbolDefinition;
  hiddenAmplifiers?: (keyof MilitarySymbolDefinition["amplifiers"])[];
  previewActions?: ReactNode;
  previewHost?: HTMLElement | null;
  externalDictionary?: boolean;
}) {
  const desktop = useWorkspaceApi();
  const unapplied = useUnappliedSymbolEdits();
  const [sets, setSets] = useState<Choice[]>([]),
    [flags, setFlags] = useState<Choice[]>([]),
    [error, setError] = useState("");
  const [pendingSet, setPendingSet] = useState<string | null>(null),
    [pendingMain, setPendingMain] = useState<string | null>(null),
    [pendingDialect, setPendingDialect] = useState<"NUMERIC" | "LETTER" | null>(
      null,
    ),
    [allSets, setAllSets] = useState(false),
    [resetArmed, setResetArmed] = useState(false);
  const [picker, setPicker] = useState<{
      field: Extract<SymbolCatalogCommand, { type: "metadata" }>["field"];
      segment: NumericSegment;
      title: string;
    } | null>(null),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [retry, setRetry] = useState(0);
  const [choicePage, setChoicePage] = useState<{
    key: string;
    choices: Choice[];
    total: number;
    error: string;
  } | null>(null);
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [previewContext, setPreviewContext] = useState<"SYMBOL" | "ORBAT_NODE">(
    "SYMBOL",
  );
  const set = numericSegment(value.code, "symbolSet") ?? "10";
  // Results belong to one exact request. A previous component's codes may have
  // a different width and must never be rendered with the next segment.
  const choiceKey = JSON.stringify([
    picker?.field,
    set,
    query,
    offset,
    allSets,
    retry,
  ]);
  const currentChoices = choicePage?.key === choiceKey ? choicePage : null;
  const choices = currentChoices?.choices ?? [];
  const total = currentChoices?.total ?? 0;
  const choicesLoading = currentChoices === null;
  const [selectedNames, setSelectedNames] = useState<Record<string, string>>(
    {},
  );
  const componentCodes = JSON.stringify([
    ["MAIN", numericSegment(value.code, "mainFunction")],
    ["MODIFIER_1", numericSegment(value.code, "modifier1")],
    ["MODIFIER_2", numericSegment(value.code, "modifier2")],
    ["COMMON_1", numericSegment(value.code, "commonModifier1")],
    ["COMMON_2", numericSegment(value.code, "commonModifier2")],
  ]);
  useEffect(() => {
    setSelectedNames({});
    if (!active || value.code.dialect !== "NUMERIC") return;
    let stopped = false;
    const parts = JSON.parse(componentCodes) as [
      NonNullable<typeof picker>["field"],
      string | null,
    ][];
    void Promise.all(
      parts.map(async ([field, code]) => {
        if (!code) return [field, "Unavailable"];
        if (field.startsWith("COMMON") && code[0] === "0")
          return [field, "Not selected"];
        if (field.startsWith("MODIFIER")) {
          const common = numericSegment(
            value.code,
            field === "MODIFIER_1" ? "commonModifier1" : "commonModifier2",
          );
          if (common && common[0] !== "0")
            return [
              field,
              `Using common modifier ${field.endsWith("1") ? "1" : "2"}`,
            ];
        }
        const result = await desktop.symbolCatalog({
          type: "metadata",
          field,
          set,
          search: code,
          offset: 0,
          limit: 50,
        });
        return [
          field,
          result.choices?.find((c) => c.id === code)?.name ?? `Code ${code}`,
        ];
      }),
    )
      .then((entries) => {
        if (!stopped) setSelectedNames(Object.fromEntries(entries));
      })
      .catch(() => {}); // The full picker still exposes the original code and any errors.
    return () => {
      stopped = true;
    };
  }, [componentCodes, set, active, value.code.dialect]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    Promise.all([
      desktop.symbolCatalog({ type: "sets" }),
      desktop.symbolCatalog({ type: "flags" }),
    ])
      .then(([a, b]) => {
        if (!stopped) {
          setSets(a.choices!);
          setFlags(b.choices!);
        }
      })
      .catch((e) => setError(editorError(e)));
    return () => {
      stopped = true;
    };
  }, [active]);
  useEffect(() => {
    if (!picker || !active) return;
    let stopped = false;
    void desktop
      .symbolCatalog(
        allSets && picker.field === "MAIN"
          ? { type: "main-search", search: query, offset, limit: 50 }
          : {
              type: "metadata",
              set,
              field: picker.field,
              search: query,
              offset,
              limit: 50,
            },
      )
      .then((r) => {
        if (!stopped) {
          setChoicePage({
            key: choiceKey,
            choices: r.choices!,
            total: r.total!,
            error: "",
          });
        }
      })
      .catch((e) => {
        if (!stopped)
          setChoicePage({
            key: choiceKey,
            choices: [],
            total: 0,
            error: editorError(e),
          });
      });
    return () => {
      stopped = true;
    };
  }, [picker, set, query, offset, active, allSets, choiceKey, desktop]);
  const change = (patch: Partial<MilitarySymbolDefinition>) =>
    onChange({ ...value, ...patch });
  const segment = (key: NumericSegment, v: string) => {
    if (key === "symbolSet" && v !== set) {
      setPendingMain(null);
      setPendingSet(v);
      return;
    }
    try {
      change({
        code: editNumericSegment(value.code, key, v),
        origin: { kind: "MANUAL" },
      });
      setError("");
      return true;
    } catch (e) {
      setError(editorError(e));
      return false;
    }
  };
  const select = (label: string, key: NumericSegment, items: Choice[]) => {
    const current = numericSegment(value.code, key);
    return (
      <label className="field">
        <span>{label}</span>
        <select
          aria-label={label}
          value={current ?? ""}
          disabled={current === null}
          onChange={(e) => segment(key, e.target.value)}
        >
          {!items.some((o) => o.id === current) && (
            <option value={current ?? ""}>
              {current === null
                ? "Not present in this code form"
                : `Unlisted value ${current}`}
            </option>
          )}
          {items.map((o) => (
            <option value={o.id} key={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
    );
  };
  const appearance = (patch: Partial<MilitarySymbolDefinition["appearance"]>) =>
    change({ appearance: { ...value.appearance, ...patch } });
  const compat = (patch: Partial<MilitarySymbolDefinition["compatibility"]>) =>
    change({ compatibility: { ...value.compatibility, ...patch } });
  const amplifier = (
    key: keyof MilitarySymbolDefinition["amplifiers"],
    text: string,
  ) => change({ amplifiers: { ...value.amplifiers, [key]: text } });
  const catalogButton = (
    title: string,
    field: NonNullable<typeof picker>["field"],
    key: NumericSegment,
  ) => (
    <button
      type="button"
      className="symbol-component-choice"
      aria-label={`${title}: ${selectedNames[field] ?? (numericSegment(value.code, key) === null ? "Unavailable" : "Choose…")}`}
      title={`${title}: ${selectedNames[field] ?? "Choose…"}`}
      disabled={unapplied || numericSegment(value.code, key) === null}
      aria-haspopup="dialog"
      onClick={() => {
        setChoicePage(null);
        setPicker({ title, field, segment: key });
        setQuery("");
        setOffset(0);
        setAllSets(false);
      }}
    >
      <span className="symbol-component-label">{title}</span>
      <strong>
        {selectedNames[field] ??
          (numericSegment(value.code, key) === null
            ? "Unavailable"
            : "Choose…")}
      </strong>
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="m3 6 5 5 5-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    </button>
  );
  const legacy = legacySegments(value.code);
  const preview = (
    <>
      <h3>Current symbol</h3>
      <div
        draggable={!unapplied}
        onDragStart={(e) => {
          if (unapplied) {
            e.preventDefault();
            return;
          }
          beginSymbolDrag(
            e.dataTransfer,
            JSON.stringify({ kind: "DEFINITION", definition: value }),
          );
        }}
        className="current-symbol-drag"
      >
        <GraphicPreview
          automaticFit={previewHost !== undefined}
          compactControls={previewHost !== undefined}
          key={previewHost !== undefined ? value.definitionId : undefined}
          fitToWidth
          fitToViewport={previewHost !== undefined}
          request={{
            kind: "SYMBOL",
            input: {
              definition: previewDefinition ?? value,
              size: 120,
              context: previewContext,
              labelSide: "RIGHT",
            },
          }}
          active={active}
        />
      </div>
    </>
  );
  return (
    <div
      className={`symbol-editor ${previewHost !== undefined ? "symbol-editor-external-preview" : ""}`}
    >
      <div className="symbol-controls">
        {!externalDictionary && (
          <button onClick={() => setDictionaryOpen(true)}>FM Dictionary</button>
        )}
        {dictionaryOpen && active && (
          <FmDictionary
            value={value}
            onChange={onChange}
            disabled={readonly || unapplied}
            onClose={() => setDictionaryOpen(false)}
          />
        )}
        <UnappliedSymbolNotice visible={unapplied} />
        {pendingDialect && (
          <ModalBackdrop>
            <section
              role="dialog"
              aria-label="Change symbol code form"
              className="modal"
            >
              <h2>Change symbol code form?</h2>
              <p>
                This starts a new{" "}
                {pendingDialect === "NUMERIC" ? "numeric" : "legacy letter"}{" "}
                infantry symbol. It does not convert the current symbol. Labels,
                appearance and label layout are retained.
              </p>
              <div className="button-row">
                <button
                  disabled={readonly || unapplied}
                  onClick={() => {
                    change({
                      code:
                        pendingDialect === "NUMERIC"
                          ? {
                              dialect: "NUMERIC",
                              sidc: "130310000012110000000000000000",
                              assertedStandard: "UNVERIFIED",
                              sourceConvention: "NATIVE",
                            }
                          : {
                              dialect: "LETTER",
                              sidc: "SFGPUCI-----",
                              assertedStandard: "UNVERIFIED",
                              sourceConvention: "NATIVE",
                            },
                      origin: { kind: "MANUAL" },
                    });
                    setPendingDialect(null);
                  }}
                >
                  Start new code
                </button>
                <button
                  autoFocus
                  data-dialog-cancel
                  onClick={() => setPendingDialect(null)}
                >
                  Keep current symbol
                </button>
              </div>
            </section>
          </ModalBackdrop>
        )}
        {pendingSet && (
          <ModalBackdrop>
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Change symbol set"
              className="modal"
            >
              <p>
                Change to {sets.find((s) => s.id === pendingSet)?.name}? The
                main icon, modifiers, and echelon/mobility will reset to
                unspecified. Labels and rendering profile are retained.
              </p>
              <button
                autoFocus
                disabled={readonly || unapplied}
                onClick={() => {
                  const next = changeSymbolSet(value, pendingSet);
                  onChange(
                    pendingMain
                      ? {
                          ...next,
                          code: editNumericSegment(
                            next.code,
                            "mainFunction",
                            pendingMain,
                          ),
                        }
                      : next,
                  );
                  setPendingSet(null);
                  setPendingMain(null);
                }}
              >
                Change set and reset components
              </button>
              <button data-dialog-cancel onClick={() => setPendingSet(null)}>
                Keep current set
              </button>
            </section>
          </ModalBackdrop>
        )}
        <fieldset disabled={readonly}>
          {value.code.dialect === "NUMERIC" ? (
            <>
              <div className="field-grid">
                {select(
                  "Identity",
                  "identity",
                  identities.map((name, i) => ({ id: String(i), name })),
                )}
                {select("Symbol set", "symbolSet", sets)}
                {select(
                  "Status",
                  "status",
                  statuses.map((name, i) => ({ id: String(i), name })),
                )}
                {select(
                  "HQ / task force / dummy",
                  "hqTaskForceDummy",
                  hqFlags.map((name, i) => ({ id: String(i), name })),
                )}
                {select("Echelon / mobility", "echelonMobility", [
                  ...echelonChoices,
                  ...mobilityChoices,
                ])}
                {select(
                  "Context",
                  "context",
                  ["Reality", "Exercise", "Simulation"].map((name, i) => ({
                    id: String(i),
                    name,
                  })),
                )}
              </div>
              <div className="symbol-main-choice">
                {catalogButton("Main icon", "MAIN", "mainFunction")}
              </div>
              <div className="button-row symbol-modifier-choices">
                {catalogButton(
                  "First icon modifier",
                  "MODIFIER_1",
                  "modifier1",
                )}
                {catalogButton(
                  "Second icon modifier",
                  "MODIFIER_2",
                  "modifier2",
                )}
                {catalogButton(
                  "Common modifier 1",
                  "COMMON_1",
                  "commonModifier1",
                )}
                {catalogButton(
                  "Common modifier 2",
                  "COMMON_2",
                  "commonModifier2",
                )}
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                Legacy code retained directly
                {legacy
                  ? `: scheme ${legacy.scheme}, identity ${legacy.identity}, dimension ${legacy.dimension}, status ${legacy.status}, function ${legacy.function}.`
                  : "; the current text has an unsupported form."}{" "}
                Numeric metadata does not convert legacy codes.
              </p>
              <LegacySymbolControls
                value={value}
                onChange={onChange}
                active={active}
              />
            </>
          )}
          <details open>
            <summary>Labels</summary>
            <div className="field-grid">
              {(
                [
                  ["uniqueDesignation", "Designation"],
                  ["additionalInformation", "Additional information"],
                  ["higherFormation", "Higher formation"],
                  ["quantity", "Quantity"],
                  ["dtg", "Date-time group"],
                ] as const
              )
                .filter(([key]) => !hiddenAmplifiers.includes(key))
                .map(([key, label]) => (
                  <Field
                    key={key}
                    label={label}
                    value={value.amplifiers[key] ?? ""}
                    onChange={(text) => amplifier(key, text)}
                  />
                ))}
            </div>
          </details>
          <details>
            <summary>Appearance and markings</summary>
            <div className="field-grid">
              <label className="field">
                <span>Convention</span>
                <select
                  value={value.appearance.convention}
                  onChange={(e) =>
                    appearance({
                      convention: e.target.value as "2525" | "APP6",
                    })
                  }
                >
                  <option value="2525">2525</option>
                  <option value="APP6">APP-6</option>
                </select>
              </label>
              <label className="field">
                <span>Color palette</span>
                <select
                  value={value.appearance.colorMode}
                  onChange={(e) =>
                    appearance({
                      colorMode: e.target.value as "Light" | "Medium" | "Dark",
                    })
                  }
                >
                  {["Light", "Medium", "Dark"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <Field
                label="Stroke width"
                type="number"
                value={String(value.appearance.strokeWidth)}
                onChange={(v) => appearance({ strokeWidth: Number(v) })}
              />
              <Field
                label="Outline width"
                type="number"
                value={String(value.appearance.outlineWidth)}
                onChange={(v) => appearance({ outlineWidth: Number(v) })}
              />
              <Field
                label="Stack count"
                type="number"
                value={String(value.compatibility.stack)}
                onChange={(v) => compat({ stack: Number(v) })}
              />
              <Field
                label="General stars"
                type="number"
                value={String(value.compatibility.generalStars)}
                onChange={(v) => compat({ generalStars: Number(v) })}
              />
              <label className="field">
                <span>Reinforcement</span>
                <select
                  value={value.compatibility.reinforced}
                  onChange={(e) =>
                    compat({
                      reinforced: e.target.value as "" | "+" | "-" | "±",
                    })
                  }
                >
                  <option value="">None</option>
                  <option value="+">Reinforced (+)</option>
                  <option value="-">Reduced (−)</option>
                  <option value="±">Reinforced and reduced (±)</option>
                </select>
              </label>
              <label className="field">
                <span>Signature</span>
                <select
                  value={value.compatibility.signature}
                  onChange={(e) => compat({ signature: e.target.value })}
                >
                  <option value="">None</option>
                  <option value="!">!</option>
                </select>
              </label>
              <Field
                label="Special headquarters"
                value={value.compatibility.specialHeadquarters}
                onChange={(v) => compat({ specialHeadquarters: v })}
              />
              <label className="field">
                <span>Flag</span>
                <select
                  value={value.compatibility.flagId ?? ""}
                  onChange={(e) => compat({ flagId: e.target.value || null })}
                >
                  <option value="">None</option>
                  {flags.map((f) => (
                    <option value={f.id} key={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Flag display</span>
                <select
                  value={value.compatibility.flagMode}
                  onChange={(e) =>
                    compat({
                      flagMode: e.target.value as "SMALL" | "FULL_FRAME",
                    })
                  }
                >
                  <option value="SMALL">Small flag</option>
                  <option value="FULL_FRAME">Full frame where supported</option>
                </select>
              </label>
            </div>
            <div className="check-row">
              {(["fill", "frame", "icon", "infoFields"] as const).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={value.appearance[key]}
                    onChange={(e) => appearance({ [key]: e.target.checked })}
                  />
                  {
                    {
                      fill: "Fill",
                      frame: "Frame",
                      icon: "Icon",
                      infoFields: "Show information fields",
                    }[key]
                  }
                </label>
              ))}
            </div>
            <div className="field-grid">
              {(
                [
                  "fillColor",
                  "frameColor",
                  "iconColor",
                  "monoColor",
                  "outlineColor",
                ] as const
              ).map((key) => (
                <label className="field" key={key}>
                  <span>
                    {
                      {
                        fillColor: "Fill color",
                        frameColor: "Frame color",
                        iconColor: "Icon color",
                        monoColor: "Single color",
                        outlineColor: "Outline color",
                      }[key]
                    }
                  </span>
                  <div className="button-row">
                    <input
                      type="color"
                      aria-label={key}
                      value={value.appearance[key] ?? "#000000"}
                      onChange={(e) => appearance({ [key]: e.target.value })}
                    />
                    <button
                      onClick={() => {
                        const next = { ...value.appearance };
                        delete next[key];
                        change({ appearance: next });
                      }}
                    >
                      Use palette
                    </button>
                  </div>
                </label>
              ))}
            </div>
          </details>
          <details className="symbol-code-details">
            <summary>Advanced: symbol code</summary>
            <fieldset disabled={unapplied} className="field-grid">
              <label className="field">
                <span>Code form</span>
                <select
                  aria-label="Code form"
                  value={value.code.dialect}
                  onChange={(e) =>
                    setPendingDialect(e.target.value as "NUMERIC" | "LETTER")
                  }
                >
                  <option value="NUMERIC">Numeric SIDC</option>
                  <option value="LETTER">Legacy letter SIDC</option>
                </select>
              </label>
              <Field
                label="SIDC"
                value={value.code.sidc}
                onChange={(sidc) =>
                  change({
                    code: { ...value.code, sidc },
                    origin: { kind: "MANUAL" },
                  })
                }
              />
            </fieldset>
            <p className="muted">
              Changing code form starts a new code example. It does not
              translate the current symbol.
            </p>
          </details>
          <details>
            <summary>Advanced amplifiers</summary>
            <div className="field-grid">
              {(
                [
                  ["staffComments", "Staff comments"],
                  ["evaluationRating", "Evaluation rating"],
                  ["combatEffectiveness", "Combat effectiveness"],
                  ["hostile", "Hostile text"],
                  ["type", "Type label"],
                  ["altitudeDepth", "Altitude / depth"],
                  ["location", "Location"],
                  ["speed", "Speed label"],
                  ["engagementBar", "Engagement bar"],
                ] as const
              ).map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={value.amplifiers[key] ?? ""}
                  onChange={(text) => amplifier(key, text)}
                />
              ))}
              {(["direction", "speedLeader"] as const).map((key) => (
                <Field
                  key={key}
                  type="number"
                  label={
                    key === "direction"
                      ? "Direction (degrees)"
                      : "Speed leader length"
                  }
                  value={String(value.amplifiers[key] ?? "")}
                  onChange={(v) => {
                    const next = { ...value.amplifiers };
                    if (v === "") delete next[key];
                    else next[key] = Number(v);
                    change({ amplifiers: next });
                  }}
                />
              ))}
              <label className="field">
                <span>Engagement type</span>
                <select
                  value={value.amplifiers.engagementType ?? "TARGET"}
                  onChange={(e) =>
                    change({
                      amplifiers: {
                        ...value.amplifiers,
                        engagementType: e.target.value as
                          "TARGET" | "NON-TARGET" | "EXPIRED",
                      },
                    })
                  }
                >
                  {["TARGET", "NON-TARGET", "EXPIRED"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </fieldset>
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {picker && active && (
          <ModalBackdrop>
            <section
              className="modal catalog-picker"
              role="dialog"
              aria-label={picker.title}
            >
              <div className="button-row">
                <h3>{picker.title}</h3>
                <button data-dialog-cancel onClick={() => setPicker(null)}>
                  Close selector
                </button>
              </div>
              <label className="field">
                <span>Search choices</span>
                <input
                  data-dialog-initial
                  value={query}
                  maxLength={200}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              {picker.field === "MAIN" && (
                <label>
                  <input
                    type="checkbox"
                    checked={allSets}
                    onChange={(e) => {
                      setAllSets(e.target.checked);
                      setOffset(0);
                    }}
                  />{" "}
                  Search all symbol sets
                </label>
              )}
              <p className="muted">
                {sets.find((s) => s.id === set)?.name ?? `Symbol set ${set}`}
                {picker.field !== "MAIN" &&
                  ". An icon modifier and its common modifier share the same position. Choosing one replaces the other."}
              </p>
              {choicesLoading && <p role="status">Loading choices…</p>}
              {currentChoices?.error && (
                <div className="notice error" role="alert">
                  <p>{currentChoices.error}</p>
                  <button onClick={() => setRetry((v) => v + 1)}>
                    Retry choices
                  </button>
                </div>
              )}
              {!choicesLoading && !currentChoices?.error && !total && (
                <p role="status">
                  {query
                    ? "No matching choices. Try another name or code."
                    : "No choices are available for this symbol set."}
                </p>
              )}
              <div
                className="catalog-results"
                aria-busy={choicesLoading}
                onKeyDown={(e) => {
                  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
                    return;
                  const buttons = [
                    ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ];
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? buttons.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              buttons.length - 1,
                              index + (e.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                  if (buttons[next]) {
                    e.preventDefault();
                    buttons[next].focus();
                  }
                }}
              >
                {choices.map((o, i) => (
                  <button
                    disabled={readonly || unapplied}
                    key={o.id + ":" + i}
                    data-component-code={o.id}
                    aria-pressed={
                      numericSegment(value.code, picker.segment) === o.id &&
                      (!o.symbolSet || o.symbolSet === set) &&
                      (!picker.field.startsWith("MODIFIER") ||
                        !numericSegment(
                          value.code,
                          picker.field === "MODIFIER_1"
                            ? "commonModifier1"
                            : "commonModifier2",
                        )?.match(/^[1-9]/))
                    }
                    onClick={() => {
                      if (o.symbolSet && o.symbolSet !== set) {
                        setPendingSet(o.symbolSet);
                        setPendingMain(o.id);
                      } else if (!segment(picker.segment, o.id)) return;
                      setPicker(null);
                    }}
                  >
                    <SymbolThumbnail
                      active={active}
                      iconOnly
                      definition={{
                        ...value,
                        code: editNumericSegment(
                          o.symbolSet && o.symbolSet !== set
                            ? changeSymbolSet(value, o.symbolSet).code
                            : value.code,
                          picker.segment,
                          o.id,
                        ),
                      }}
                    />
                    <span className="component-choice-name">
                      {o.name}
                      <small>
                        {o.id}
                        {o.note && ` · ${o.note}`}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="button-row">
                <button
                  disabled={choicesLoading || !offset}
                  onClick={() => setOffset((o) => Math.max(0, o - 50))}
                >
                  Previous
                </button>
                <span>
                  {total
                    ? `${offset + 1}–${Math.min(offset + 50, total)} of ${total}`
                    : "0 choices"}
                </span>
                <button
                  disabled={choicesLoading || offset + 50 >= total}
                  onClick={() => setOffset((o) => o + 50)}
                >
                  Next
                </button>
                <button
                  disabled={readonly || unapplied}
                  onClick={() => {
                    const current = numericSegment(value.code, picker.segment);
                    if (
                      current &&
                      segment(picker.segment, "0".repeat(current.length))
                    )
                      setPicker(null);
                  }}
                >
                  Clear selection
                </button>
              </div>
            </section>
          </ModalBackdrop>
        )}
      </div>
      <div className="symbol-preview-column">
        {previewHost === undefined
          ? preview
          : active && previewHost
            ? createPortal(preview, previewHost)
            : null}
        <button
          disabled={readonly || unapplied}
          onClick={() => setResetArmed(true)}
        >
          Reset symbol…
        </button>
        {resetArmed && (
          <ModalBackdrop>
            <section className="modal" role="dialog" aria-label="Reset symbol">
              <p>
                Reset the symbol components, labels, and appearance? The code
                prefix and selected label layout will stay the same.
              </p>
              <button
                disabled={readonly || unapplied}
                onClick={() => {
                  onChange(resetSymbolDraft(value));
                  setResetArmed(false);
                }}
              >
                Reset symbol
              </button>
              <button
                autoFocus
                data-dialog-cancel
                onClick={() => setResetArmed(false)}
              >
                Cancel reset
              </button>
            </section>
          </ModalBackdrop>
        )}
        <details className="symbol-preview-options">
          <summary>Preview and label layout</summary>
          <label className="field">
            <span>ORBAT label layout</span>
            <select
              aria-label="ORBAT label layout"
              disabled={readonly || unapplied}
              value={String(value.renderProfile.version)}
              onChange={(e) =>
                change({
                  renderProfile: {
                    id: "ordo-symbol",
                    version: Number(e.target.value),
                  },
                })
              }
            >
              <option value="1">Classic placement</option>
              <option value="2">Separated labels</option>
            </select>
          </label>
          <p className="muted">
            Separated labels leave space beside small flags and signature marks.
            Choose how labels are arranged around this symbol.
          </p>
          <label className="field">
            <span>Preview as</span>
            <select
              aria-label="Symbol preview context"
              value={previewContext}
              onChange={(e) =>
                setPreviewContext(e.target.value as "SYMBOL" | "ORBAT_NODE")
              }
            >
              <option value="SYMBOL">Standalone symbol</option>
              <option value="ORBAT_NODE">Unit in an ORBAT</option>
            </select>
          </label>
        </details>
        <button
          onClick={() =>
            void desktop
              .copySidc(value.code.sidc)
              .catch((e) => setError(editorError(e)))
          }
        >
          Copy SIDC
        </button>
        <details>
          <summary>Technical details</summary>
          <small>
            Definition {value.definitionId}
            <br />
            Render profile {value.renderProfile.id} v
            {value.renderProfile.version}
            <br />
            Source: {value.origin.kind}
          </small>
        </details>
        {previewActions}
      </div>
    </div>
  );
}
