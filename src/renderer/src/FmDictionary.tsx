import { useEffect, useState } from "react";
import type { MilitarySymbolDefinition } from "../../domain/symbology";
import type { SymbolCatalogResult } from "../../application/symbol-catalog";
import { BuilderDialog } from "./BuilderDialog";
import { Field } from "./Fields";
import { editorError } from "./editor-error";
import { useWorkspaceApi, useEditorProtection } from "./WorkspaceContext";

export function FmDictionary({
  value,
  onChange,
  onClose,
  disabled = false,
  targetName,
}: {
  value?: MilitarySymbolDefinition;
  onChange: (value: MilitarySymbolDefinition) => void;
  onClose: () => void;
  disabled?: boolean;
  targetName?: string;
}) {
  const desktop = useWorkspaceApi();
  const [dictionary, setDictionary] =
    useState<SymbolCatalogResult["dictionary"]>();
  const [dictQuery, setDictQuery] = useState(""),
    [category, setCategory] = useState(""),
    [dictOffset, setDictOffset] = useState(0);
  const [loadedKey, setLoadedKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const key = JSON.stringify([dictQuery, category, dictOffset]);
  const loading = loadedKey !== key;
  const current = loading ? undefined : dictionary;
  useEditorProtection({ name: "FM Dictionary", dirty: false, busy });
  useEffect(() => {
    let stopped = false;
    setError("");
    void desktop
      .symbolCatalog({
        type: "dictionary",
        search: dictQuery,
        category,
        offset: dictOffset,
        limit: 20,
      })
      .then((r) => {
        if (!stopped) {
          setDictionary(r.dictionary);
          setLoadedKey(key);
        }
      })
      .catch((e) => {
        if (!stopped) {
          setError(editorError(e));
          setDictionary(undefined);
          setLoadedKey(key);
        }
      });
    return () => {
      stopped = true;
    };
  }, [key, desktop]);
  const applyEntry = async (
    entryId: string,
    action: "OPEN_EXAMPLE" | "APPLY_COMPONENT",
  ) => {
    if (!value || disabled || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await desktop.symbolCatalog({
        type: "dictionary-apply",
        entryId,
        action,
        definition: value,
      });
      onChange(result.definition!);
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <BuilderDialog title="FM Dictionary" busy={busy} onClose={onClose}>
      {targetName && (
        <p>
          Apply entries to <strong>{targetName}</strong>.
        </p>
      )}
      {!value && (
        <p>Open or create a symbol in the Symbol editor to use an entry.</p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {loading && <p role="status">Loading dictionary…</p>}

      <section className="fm-dictionary">
        <p>
          Curated FM mappings. Source differences and unavailable symbols are
          retained.
        </p>
        <Field
          label="Search FM dictionary"
          value={dictQuery}
          onChange={(v) => {
            setDictQuery(v);
            setDictOffset(0);
          }}
        />
        <label className="field">
          <span>Category</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setDictOffset(0);
            }}
          >
            <option value="">All categories</option>
            {current?.categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {current?.entries.map((e) => (
          <article className="dictionary-entry" key={e.entryId}>
            <h4>
              {e.term} <small>{e.availability}</small>
            </h4>
            <p>{e.description}</p>
            {e.notes.filter(Boolean).map((note, i) => (
              <p key={i}>{note}</p>
            ))}
            {e.editorialIssues.map((i) => (
              <p key={i}>{i}</p>
            ))}
            <small>
              {e.citation.publicationIdentifier} · {e.citation.provenanceClass}{" "}
              · source {e.citation.table}/{e.citation.section}/{e.citation.row}{" "}
              · edition {e.citation.editionDate ?? "not supplied"}
            </small>
            <div className="button-row">
              <button
                disabled={disabled || busy || !value || !e.sidc}
                onClick={() => void applyEntry(e.entryId, "OPEN_EXAMPLE")}
              >
                Open Example
              </button>
              <button
                disabled={
                  disabled ||
                  busy ||
                  !value ||
                  !e.sidc ||
                  value?.code.dialect !== "NUMERIC"
                }
                onClick={() => void applyEntry(e.entryId, "APPLY_COMPONENT")}
              >
                Apply component
              </button>
            </div>
          </article>
        ))}
        <div className="button-row">
          <button
            disabled={loading || !dictOffset}
            onClick={() => setDictOffset((v) => Math.max(0, v - 20))}
          >
            Previous entries
          </button>
          <span>{current?.total ?? 0} entries</span>
          <button
            disabled={loading || dictOffset + 20 >= (current?.total ?? 0)}
            onClick={() => setDictOffset((v) => v + 20)}
          >
            Next entries
          </button>
        </div>
      </section>
    </BuilderDialog>
  );
}
