import { SaveStatus } from "./SaveStatus";
import {
  useCatalogSearch,
  useSearchOpen,
  focusSearchField,
} from "./SearchProvider";
import { editorError, fieldIssue } from "./editor-error";
import { DeleteItemButton } from "./DeleteItemButton";
import {
  BusyBoundary,
  useWorkspaceApi,
  useEditorProtection,
} from "./WorkspaceContext";
import { useState, useEffect } from "react";
import { Panel, Field, Select, Checks } from "./Fields";
import { DefinitionEditor } from "./ModuleFields";
import {
  doctrineVersionSchema,
  syncDoctrineIndex,
  type DoctrineVersion,
} from "../../domain/doctrine-builder";
import { newModuleDefinition } from "../../domain/modules";
import { moduleOptions } from "./editorRegistry";
import { type DoctrineNode } from "../../domain/doctrine";
import { canonical } from "../../export/projection";
import { useWorkingCopy, useRecoveryOpen } from "./WorkingCopies";
import type { AppState, Command } from "../../application/service";
const uid = () => crypto.randomUUID();
const sections = [
  "General",
  "Structure",
  "Products / Modules",
  "Staff",
] as const;
export function DoctrineBuilder({
  state,
  onState,
}: {
  state: AppState;
  onState: (s: AppState) => void;
}) {
  const desktop = useWorkspaceApi();
  const [id, setId] = useState(state.doctrines[0]?.doctrineVersionId ?? ""),
    [draft, setDraft] = useState<DoctrineVersion | null>(null),
    [tab, setTab] = useState<(typeof sections)[number]>("General"),
    [product, setProduct] = useState(""),
    [moduleType, setModuleType] = useState("RICH_TEXT"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [copyName, setCopyName] = useState("My Orders"),
    [switchTarget, setSwitchTarget] = useState("");
  const saved = state.doctrines.find((v) => v.doctrineVersionId === id),
    dirty = !!draft && !!saved && canonical(draft) !== canonical(saved);
  useCatalogSearch("DOCTRINE", draft);
  useSearchOpen("catalog", (target) => {
    if (target.area !== "catalog" || target.catalogKind !== "DOCTRINE") return;
    if (id !== target.catalogId && dirty) {
      setError(
        "Save or discard these doctrine edits before opening another doctrine.",
      );
      return;
    }
    if (id !== target.catalogId) {
      setId(target.catalogId);
      setDraft(
        structuredClone(
          state.doctrines.find(
            (d) => d.doctrineVersionId === target.catalogId,
          ) ?? null,
        ),
      );
    }
    setTab("General");
    focusSearchField(
      target.field === "description" ? "Doctrine description" : "Doctrine name",
    );
  });
  const recovery = useWorkingCopy({
    kind: "doctrine",
    id: saved?.doctrineVersionId,
    label: saved?.displayName ?? "Doctrine",
    source: saved ?? null,
    value: draft,
    dirty,
    busy,
    apply: setDraft,
  });
  useRecoveryOpen("doctrine", (d) => {
    if (dirty)
      setError(
        "Save or discard these doctrine edits before opening a recovery copy.",
      );
    else {
      setId(d.id);
      setDraft(
        structuredClone(
          state.doctrines.find((v) => v.doctrineVersionId === d.id) ?? null,
        ),
      );
    }
  });
  useEditorProtection({ name: "Doctrine Builder", dirty, busy });
  useEffect(() => {
    if (saved && !dirty) setDraft(structuredClone(saved));
  }, [id, saved?.contentVersion, saved?.status]);

  const accept = (next: AppState, newId = id) => {
    onState(next);
    setId(newId);
    setDraft(
      structuredClone(
        next.doctrines.find((v) => v.doctrineVersionId === newId) ?? null,
      ),
    );
  };
  const run = async (fn: () => Promise<void>) => {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  const execute = async (command: Command) => {
    const next = await desktop.execute(command);
    accept(next, next.selectedDoctrineId ?? id);
    return next;
  };
  const edit = (fn: (v: DoctrineVersion) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const d = structuredClone(current);
      fn(d);
      syncDoctrineIndex(d);
      return d;
    });
  };
  const save = async () => {
    if (!draft || !saved) return;
    if (!doctrineVersionSchema.safeParse(draft).success)
      throw Error("Review the highlighted doctrine fields before saving.");
    return execute({
      type: "doctrine-save",
      doctrine: draft,
      expectedContentVersion: saved.contentVersion,
    });
  };
  const nodes = draft?.config.doctrine.catalog?.nodes ?? [],
    node = nodes.find((n) => n.id === product),
    layout = draft?.config.doctrine.modules?.layouts.find(
      (l) => l.productId === (product || null),
    );
  const nodeEdit = (fn: (n: DoctrineNode) => void) =>
    edit((v) => {
      const n = v.config.doctrine.catalog!.nodes.find((n) => n.id === product)!;
      fn(n);
    });
  const addNode = (child: boolean) =>
    edit((v) => {
      const parent = child ? node : null;
      if (parent?.nodeType === "EXHIBIT")
        throw Error("Exhibits cannot have children");
      if (!v.config.doctrine.catalog) {
        setError(
          "This starter doctrine does not support adding nested products. Duplicate US Army Orders or create a new doctrine instead.",
        );
        return;
      }
      const id = uid(),
        stableKey = `product-${id}`,
        nodeType = parent
          ? ({ ANNEX: "APPENDIX", APPENDIX: "TAB", TAB: "EXHIBIT" } as const)[
              parent.nodeType as "ANNEX" | "APPENDIX" | "TAB"
            ]
          : "ANNEX";
      const n: DoctrineNode = {
        id,
        stableKey,
        nodeType,
        code: `NEW-${v.config.doctrine.catalog.nodes.length + 1}`,
        canonicalTitle: "New product",
        aliases: [],
        parentStableKey: parent?.stableKey ?? null,
        sourceClass: "ORGANIZATION_OVERRIDE",
        sourceReferences: [
          {
            title: "User-created doctrine",
            publicationIdentifier: "LOCAL",
            editionDate: new Date().toISOString().slice(0, 10),
            changeNumber: 0,
            changeDate: null,
            locator: "Doctrine Builder",
          },
        ],
        sourceNotes: "User-defined product; no external doctrine claim.",
        status: "ACTIVE",
        formatType: "CUSTOM",
        responsibleStaff: [],
        supportingStaff: [],
        ownerBehavior: parent ? "INHERIT_PARENT" : "EXPLICIT",
        defaultApplicability: "AS_REQUIRED",
        purpose: "",
        normalApplicabilityNotes: "",
        echelonNotes: "",
        editorHint: "GENERIC_STRUCTURED_PRODUCT",
        editorSourceClass: "ORDO_DEFAULT",
        expectedContentTypes: [],
        primaryInputs: [],
        primaryOutputs: [],
        crossReferences: [],
        specialistDoctrineSources: [],
        organizationExtensionAllowed: true,
        canonicalTableD2: false,
        sourceVariants: [],
      };
      v.config.doctrine.catalog.nodes.push(n);
      setProduct(id);
    });
  const validation = draft ? doctrineVersionSchema.safeParse(draft) : null;
  return (
    <BusyBoundary busy={busy} className="doctrine-builder" inert={busy}>
      {recovery}
      <Panel
        title="Doctrine Builder"
        subtitle="Define the structure, products and staff roles used by your orders."
      >
        <label className="field">
          <span>Doctrine</span>
          <select
            aria-label="Doctrine"
            value={id}
            onChange={(e) => {
              if (dirty) setSwitchTarget(e.target.value);
              else {
                setId(e.target.value);
                setDraft(
                  structuredClone(
                    state.doctrines.find(
                      (v) => v.doctrineVersionId === e.target.value,
                    )!,
                  ),
                );
                setProduct("");
              }
            }}
          >
            {(["BUNDLED", "USER_CREATED", "IMPORTED"] as const).map((kind) => (
              <optgroup
                key={kind}
                label={
                  {
                    BUNDLED: "Bundled",
                    USER_CREATED: "My doctrines",
                    IMPORTED: "Imported",
                  }[kind]
                }
              >
                {state.doctrines
                  .filter((v) => v.sourceKind === kind)
                  .map((v) => (
                    <option
                      key={v.doctrineVersionId}
                      value={v.doctrineVersionId}
                    >
                      {v.displayName}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {switchTarget && (
          <div role="dialog" aria-label="Unsaved doctrine">
            <p>Save these edits before opening another doctrine?</p>
            <button
              onClick={() =>
                run(async () => {
                  await save();
                  const next = state.doctrines.find(
                    (v) => v.doctrineVersionId === switchTarget,
                  )!;
                  setId(switchTarget);
                  setDraft(structuredClone(next));
                  setSwitchTarget("");
                })
              }
            >
              Save and open
            </button>
            <button
              onClick={() => {
                setId(switchTarget);
                setDraft(
                  structuredClone(
                    state.doctrines.find(
                      (v) => v.doctrineVersionId === switchTarget,
                    )!,
                  ),
                );
                setSwitchTarget("");
              }}
            >
              Discard edits and open
            </button>
            <button onClick={() => setSwitchTarget("")}>Keep editing</button>
          </div>
        )}
        <div className="two-columns">
          <Field
            label="New doctrine name"
            value={copyName}
            onChange={setCopyName}
          />
        </div>
        <div className="button-row">
          <button
            disabled={busy || dirty}
            onClick={() =>
              run(async () => {
                const source = state.doctrines.find(
                  (v) => v.config.doctrine.catalog,
                );
                await execute({
                  type: "doctrine-create",
                  sourceId: source?.doctrineVersionId,
                  name: copyName,
                  versionLabel: "1.0.0",
                  newFamily: true,
                  empty: true,
                });
              })
            }
          >
            New doctrine
          </button>
          <button
            disabled={busy || dirty || !draft}
            onClick={() =>
              run(async () => {
                await execute({
                  type: "doctrine-create",
                  sourceId: id,
                  name: copyName,
                  versionLabel: "1.0.0",
                  newFamily: true,
                });
              })
            }
          >
            Duplicate doctrine
          </button>

          <button
            disabled={busy || !dirty || validation?.success === false}
            onClick={() =>
              run(async () => {
                await save();
                setMessage("Doctrine saved.");
              })
            }
          >
            Save doctrine
          </button>
          <SaveStatus busy={busy} dirty={dirty} />
          <button
            disabled={busy || !dirty}
            onClick={() => saved && setDraft(structuredClone(saved))}
          >
            Discard doctrine edits
          </button>

          <DeleteItemButton
            target={{ kind: "doctrine", id }}
            label="Delete doctrine"
            disabled={busy || dirty || !saved}
            onDeleted={async () => {
              const next = await desktop.execute({ type: "load" });
              accept(next, next.doctrines[0]?.doctrineVersionId ?? "");
            }}
          />
          <button
            disabled={busy || dirty}
            onClick={() =>
              run(async () => {
                await desktop.files({ type: "doctrine-export", id });
                setMessage("Doctrine package exported.");
              })
            }
          >
            Export doctrine package
          </button>
          <button
            disabled={busy || dirty}
            onClick={() =>
              run(async () => {
                const result = await desktop.files({
                  type: "doctrine-import",
                });
                if (result?.state) accept(result.state, result.doctrineId);
              })
            }
          >
            Import doctrine package
          </button>
        </div>
        {dirty && <p className="notice">Unsaved doctrine changes</p>}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <div className="builder-tabs" role="tablist">
          {sections.map((t) => (
            <button
              role="tab"
              aria-selected={tab === t}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </Panel>
      {validation && !validation.success && (
        <div role="alert" className="notice error">
          <ul>
            {[...new Set(validation.error.issues.map(fieldIssue))].map(
              (message) => (
                <li key={message}>{message}</li>
              ),
            )}
          </ul>
        </div>
      )}
      {draft && (
        <>
          {tab === "General" && (
            <Panel title="Doctrine general settings">
              <fieldset>
                <Field
                  label="Doctrine name"
                  value={draft.displayName}
                  onChange={(v) => edit((d) => (d.displayName = v))}
                />
                <Field
                  label="Doctrine description"
                  area
                  value={draft.description}
                  onChange={(v) => edit((d) => (d.description = v))}
                />

                <Field
                  label="Author"
                  value={draft.author}
                  onChange={(v) => edit((d) => (d.author = v))}
                />
              </fieldset>
            </Panel>
          )}
          {(tab === "Structure" || tab === "Products / Modules") && (
            <div className="builder-layout">
              <Panel title="Products">
                <button onClick={() => setProduct("")}>Base order</button>
                <div className="builder-product-list">
                  {nodes.map((n) => (
                    <button
                      aria-pressed={product === n.id}
                      key={n.id}
                      onClick={() => setProduct(n.id)}
                      style={{
                        paddingLeft: {
                          ANNEX: 8,
                          APPENDIX: 20,
                          TAB: 32,
                          EXHIBIT: 44,
                        }[n.nodeType],
                      }}
                    >
                      {n.code} · {n.canonicalTitle}
                    </button>
                  ))}
                </div>
                <div className="button-row">
                  <button onClick={() => addNode(false)}>Add annex</button>
                  <button
                    disabled={!node || node.nodeType === "EXHIBIT"}
                    onClick={() => addNode(true)}
                  >
                    Add child product
                  </button>
                </div>
              </Panel>
              <Panel
                title={
                  node ? `${node.code} · ${node.canonicalTitle}` : "Base order"
                }
              >
                {tab === "Structure" && node && (
                  <fieldset>
                    <Field
                      label="Product title"
                      value={node.canonicalTitle}
                      onChange={(v) => nodeEdit((n) => (n.canonicalTitle = v))}
                    />
                    <Field
                      label="Product code"
                      value={node.code}
                      onChange={(v) => nodeEdit((n) => (n.code = v))}
                    />
                    <Field
                      label="Product purpose"
                      area
                      value={node.purpose}
                      onChange={(v) => nodeEdit((n) => (n.purpose = v))}
                    />
                    <Select
                      label="Parent product"
                      value={node.parentStableKey}
                      options={nodes
                        .filter(
                          (n) =>
                            n.nodeType ===
                            (
                              {
                                APPENDIX: "ANNEX",
                                TAB: "APPENDIX",
                                EXHIBIT: "TAB",
                              } as Record<string, string>
                            )[node.nodeType],
                        )
                        .map((n) => ({
                          id: n.stableKey,
                          name: `${n.code} ${n.canonicalTitle}`,
                        }))}
                      empty="Base order (annexes only)"
                      onChange={(v) => nodeEdit((n) => (n.parentStableKey = v))}
                    />
                    <Select
                      label="Responsible staff assignment"
                      value={node.ownerBehavior}
                      options={[
                        { id: "EXPLICIT", name: "Doctrine default" },
                        {
                          id: "INHERIT_PARENT",
                          name: "Use parent product’s assignment",
                        },
                      ]}
                      onChange={(v) =>
                        nodeEdit(
                          (n) =>
                            (n.ownerBehavior = (v ?? "EXPLICIT") as "EXPLICIT"),
                        )
                      }
                    />
                    <Checks
                      label="Responsible staff defaults"
                      options={draft.config.doctrine.staff}
                      values={node.responsibleStaff}
                      onChange={(v) =>
                        nodeEdit((n) => (n.responsibleStaff = v))
                      }
                    />
                    <Checks
                      label="Supporting staff"
                      options={draft.config.doctrine.staff}
                      values={node.supportingStaff}
                      onChange={(v) => nodeEdit((n) => (n.supportingStaff = v))}
                    />
                    <Select
                      label="Suggested inclusion"
                      value={node.defaultApplicability}
                      options={[
                        "AS_REQUIRED",
                        "AVAILABLE",
                        "DEFAULT_INCLUDED",
                        "DEFAULT_OMITTED",
                      ].map((id) => ({ id, name: id }))}
                      onChange={(v) =>
                        nodeEdit(
                          (n) =>
                            (n.defaultApplicability = (v ??
                              "AS_REQUIRED") as "AS_REQUIRED"),
                        )
                      }
                    />
                    <div className="button-row">
                      {[-1, 1].map((dir) => (
                        <button
                          key={dir}
                          onClick={() =>
                            edit((d) => {
                              const list = d.config.doctrine.catalog!.nodes,
                                siblings = list.filter(
                                  (n) =>
                                    n.parentStableKey === node.parentStableKey,
                                ),
                                at = siblings.findIndex(
                                  (n) => n.id === node.id,
                                ),
                                other = siblings[at + dir];
                              if (other) {
                                const a = list.findIndex(
                                    (n) => n.id === node.id,
                                  ),
                                  b = list.findIndex((n) => n.id === other.id);
                                [list[a], list[b]] = [list[b], list[a]];
                              }
                            })
                          }
                        >
                          Move product {dir === -1 ? "up" : "down"}
                        </button>
                      ))}
                      <button
                        onClick={() =>
                          edit((d) => {
                            const copy = structuredClone(node);
                            copy.id = uid();
                            copy.stableKey = `product-${copy.id}`;
                            copy.code = `${copy.code}-COPY`;
                            copy.canonicalTitle += " copy";
                            copy.sourceClass = "ORGANIZATION_OVERRIDE";
                            copy.canonicalTableD2 = false;
                            delete copy.alternativeToStableKey;
                            d.config.doctrine.catalog!.nodes.push(copy);
                            const existing =
                              d.config.doctrine.modules!.layouts.find(
                                (l) => l.productId === node.id,
                              );
                            if (existing)
                              d.config.doctrine.modules!.layouts.push({
                                productId: copy.id,
                                definitions: existing.definitions.map(
                                  (def) => ({
                                    ...structuredClone(def),
                                    moduleDefinitionId: uid(),
                                    stableKey: `module-${uid()}`,
                                  }),
                                ),
                              });
                            setProduct(copy.id);
                          })
                        }
                      >
                        Duplicate product
                      </button>
                      <button
                        disabled={nodes.some(
                          (n) => n.parentStableKey === node.stableKey,
                        )}
                        onClick={() =>
                          edit((d) => {
                            d.config.doctrine.catalog!.nodes =
                              d.config.doctrine.catalog!.nodes.filter(
                                (n) => n.id !== node.id,
                              );
                            d.config.doctrine.modules!.layouts =
                              d.config.doctrine.modules!.layouts.filter(
                                (l) => l.productId !== node.id,
                              );
                            setProduct("");
                          })
                        }
                      >
                        Remove product
                      </button>
                    </div>
                  </fieldset>
                )}
                {tab === "Structure" && (
                  <details>
                    <summary>Source and technical details</summary>
                    <pre>
                      {JSON.stringify(
                        node ?? {
                          baseOrder: draft.config.doctrine.paragraphs,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
                {tab === "Products / Modules" && (
                  <>
                    <p className="hint">
                      Choose the sections each product will contain. Write the
                      order content in an operation.
                    </p>
                    {layout?.definitions.map((def, i) => (
                      <div className="module-card" key={def.moduleDefinitionId}>
                        <h3>
                          {def.title} <small>{def.moduleType}</small>
                        </h3>
                        <fieldset>
                          <DefinitionEditor
                            definition={def}
                            onChange={(next) =>
                              edit((d) => {
                                d.config.doctrine.modules!.layouts.find(
                                  (l) => l.productId === (product || null),
                                )!.definitions[i] = next;
                              })
                            }
                          />
                          <div className="button-row">
                            <button
                              disabled={!i}
                              onClick={() =>
                                edit((d) => {
                                  const list =
                                    d.config.doctrine.modules!.layouts.find(
                                      (l) => l.productId === (product || null),
                                    )!.definitions;
                                  [list[i - 1], list[i]] = [
                                    list[i],
                                    list[i - 1],
                                  ];
                                })
                              }
                            >
                              Move module up
                            </button>
                            <button
                              disabled={i === layout.definitions.length - 1}
                              onClick={() =>
                                edit((d) => {
                                  const list =
                                    d.config.doctrine.modules!.layouts.find(
                                      (l) => l.productId === (product || null),
                                    )!.definitions;
                                  [list[i + 1], list[i]] = [
                                    list[i],
                                    list[i + 1],
                                  ];
                                })
                              }
                            >
                              Move module down
                            </button>
                            <button
                              onClick={() =>
                                edit((d) => {
                                  const list =
                                    d.config.doctrine.modules!.layouts.find(
                                      (l) => l.productId === (product || null),
                                    )!.definitions;
                                  list.push({
                                    ...structuredClone(def),
                                    moduleDefinitionId: uid(),
                                    stableKey: `module-${uid()}`,
                                    title: `${def.title} copy`,
                                  });
                                })
                              }
                            >
                              Duplicate module
                            </button>
                            <button
                              onClick={() =>
                                edit((d) =>
                                  d.config.doctrine
                                    .modules!.layouts.find(
                                      (l) => l.productId === (product || null),
                                    )!
                                    .definitions.splice(i, 1),
                                )
                              }
                            >
                              Remove section
                            </button>
                          </div>
                          {[
                            "IMAGE",
                            "IMAGE_GALLERY",
                            "FILE_ATTACHMENT",
                          ].includes(def.moduleType) && (
                            <>
                              <p>
                                Default doctrine files:{" "}
                                {def.configuration.defaultAssetIds?.length ?? 0}
                              </p>
                              <button
                                onClick={() =>
                                  run(async () => {
                                    const r = await desktop.files({
                                      type: "asset-import",
                                      owner: { kind: "doctrine", id },
                                    });
                                    if (r?.asset)
                                      edit((d) => {
                                        d.config.doctrine.modules!.assets.push(
                                          r.asset!,
                                        );
                                        const target =
                                          d.config.doctrine.modules!.layouts.find(
                                            (l) =>
                                              l.productId === (product || null),
                                          )!.definitions[i];
                                        (target.configuration.defaultAssetIds ??=
                                          []).push(r.asset!.assetId);
                                      });
                                  })
                                }
                              >
                                Import doctrine file
                              </button>
                            </>
                          )}
                        </fieldset>
                      </div>
                    ))}
                    <fieldset>
                      <Select
                        label="Section type"
                        value={moduleType}
                        options={moduleOptions}
                        onChange={(v) => setModuleType(v ?? "RICH_TEXT")}
                      />
                      <button
                        onClick={() =>
                          edit((d) => {
                            let l = d.config.doctrine.modules!.layouts.find(
                              (l) => l.productId === (product || null),
                            );
                            if (!l) {
                              l = {
                                productId: product || null,
                                definitions: [],
                              };
                              d.config.doctrine.modules!.layouts.push(l);
                            }
                            l.definitions.push(
                              newModuleDefinition(
                                moduleType,
                                uid(),
                                l.definitions.length,
                              ),
                            );
                          })
                        }
                      >
                        Add section
                      </button>
                    </fieldset>
                  </>
                )}
              </Panel>
            </div>
          )}
          {tab === "Staff" && (
            <Panel
              title="Staff roles"
              subtitle="Define roles for your organization. Names and responsibilities are yours to choose."
            >
              <fieldset>
                {draft.config.doctrine.staff.map((s, i) => (
                  <div className="button-row staff-role-row" key={s.id}>
                    <Field
                      label={`Role name ${i + 1}`}
                      value={s.name}
                      onChange={(v) =>
                        edit((d) => (d.config.doctrine.staff[i].name = v))
                      }
                    />
                    <button
                      className="danger"
                      onClick={() =>
                        edit((d) => {
                          d.config.doctrine.staff =
                            d.config.doctrine.staff.filter(
                              (role) => role.id !== s.id,
                            );
                          d.config.echelon.staffIds =
                            d.config.echelon.staffIds.filter(
                              (role) => role !== s.id,
                            );
                          for (const n of d.config.doctrine.catalog?.nodes ??
                            []) {
                            n.responsibleStaff = n.responsibleStaff.filter(
                              (role) => role !== s.id,
                            );
                            n.supportingStaff = n.supportingStaff.filter(
                              (role) => role !== s.id,
                            );
                          }
                          for (const a of d.config.doctrine.annexCatalog)
                            if (a.ownerId === s.id) a.ownerId = null;
                        })
                      }
                    >
                      Remove role
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    edit((d) => {
                      const id = uid();
                      d.config.doctrine.staff.push({
                        id,
                        name: "New staff role",
                      });
                      d.config.echelon.staffIds.push(id);
                    })
                  }
                >
                  Add staff role
                </button>
              </fieldset>
            </Panel>
          )}
        </>
      )}
    </BusyBoundary>
  );
}
