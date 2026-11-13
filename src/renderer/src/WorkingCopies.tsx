import { editorError } from "./editor-error";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { canonical } from "../../export/projection";
import type {
  DraftKey,
  DraftSummary,
  RecoveryResult,
  WorkingDraft,
} from "../../application/working-drafts";
import {
  useEditorProtection,
  useWorkspaceApi,
  useWorkspaceSession,
} from "./WorkspaceContext";

export function useRecoveryOpen(
  kind: DraftKey["kind"],
  open: (draft: DraftSummary) => void,
  ready = true,
) {
  const session = useWorkspaceSession(),
    callback = useRef(open);
  callback.current = open;
  useSyncExternalStore(session.subscribe, session.getRevision);
  const target = session.recoveryTarget;
  useEffect(() => {
    if (ready && target?.kind === kind) callback.current(target);
  }, [kind, target?.nonce, ready]);
}

export function useWorkingCopy<T>({
  kind,
  id,
  scope = null,
  label,
  source,
  value,
  dirty,
  busy,
  apply,
}: {
  kind: DraftKey["kind"];
  id: string | undefined;
  scope?: string | null;
  label: string;
  source: unknown;
  value: T;
  dirty: boolean;
  busy: boolean;
  apply: (value: T) => void;
}) {
  const api = useWorkspaceApi();
  const [offer, setOffer] = useState<WorkingDraft | null>(null),
    [compatible, setCompatible] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [savedAt, setSavedAt] = useState(""),
    [loaded, setLoaded] = useState("");
  const [retry, setRetry] = useState(0);
  const [writeRetry, setWriteRetry] = useState(0);
  const identity = id ? `${kind}:${id}` : "";
  const current = useRef({
    token: "",
    sequence: 0,
    source: "",
    value: "",
    identity: "",
  });
  const queue = useRef(Promise.resolve());
  const generation = useRef(0);
  const pendingCount = useRef(0);
  const sourceText = useMemo(() => canonical(source), [source]),
    valueText = useMemo(() => canonical(value), [value]);
  const latest = useRef({ sourceText, valueText, dirty });
  latest.current = { sourceText, valueText, dirty };
  useEditorProtection({
    name: `${label} recovery`,
    dirty: false,
    busy: pending,
  });
  useEffect(() => {
    const gen = ++generation.current;
    pendingCount.current = 0;
    setOffer(null);
    setError("");
    setSavedAt("");
    setLoaded("");
    setPending(false);
    current.current = {
      token: "",
      sequence: 0,
      source: "",
      value: "",
      identity,
    };
    if (!id) return;
    const key = { kind, id, scope };
    const read = async (): Promise<RecoveryResult> => {
      try {
        return await api.recovery({ type: "get", key });
      } catch (e) {
        if (
          gen === generation.current &&
          /Workspace work is in progress/.test(editorError(e))
        ) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (gen === generation.current) return read();
        }
        throw e;
      }
    };
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        const r = await read();
        if (generation.current !== gen) return;
        current.current = {
          token: r.token,
          sequence: r.draft?.sequence ?? 0,
          source: r.draft?.source ?? "",
          value: r.draft?.value ?? "",
          identity,
        };
        setOffer(r.draft ?? null);
        setCompatible(!!r.compatible);
        setLoaded(identity);
      })
      .catch((e) => {
        if (generation.current === gen)
          setError(`Recovery could not open: ${editorError(e)}`);
      });
    return () => {
      ++generation.current;
    };
  }, [identity, api, retry]);
  useEffect(() => {
    if (!id || loaded !== identity || offer || busy) return;
    const gen = generation.current,
      key = { kind, id, scope };
    const state = current.current;
    if (dirty && state.value === valueText && state.source === sourceText)
      return;
    if (!dirty && !state.sequence) return;
    setPending(true);
    pendingCount.current++;
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        if (gen !== generation.current) return;
        if (
          sourceText !== latest.current.sourceText ||
          valueText !== latest.current.valueText ||
          dirty !== latest.current.dirty
        )
          return;
        const previous = current.current;
        let r: RecoveryResult;
        if (dirty)
          r = await api.recovery({
            type: "put",
            token: previous.token,
            key,
            source: sourceText,
            value: valueText,
            label,
            expected: previous.sequence,
          });
        else if (previous.sequence)
          r = await api.recovery({
            type: "remove",
            token: previous.token,
            key,
            expected: previous.sequence,
          });
        else return;
        if (gen !== generation.current) return;
        current.current = {
          token: r.token,
          sequence: r.draft?.sequence ?? 0,
          source: r.draft?.source ?? "",
          value: r.draft?.value ?? "",
          identity,
        };
        setSavedAt(r.draft?.updatedAt ?? "");
        setError("");
      })
      .catch((e) => {
        if (
          gen === generation.current &&
          sourceText === latest.current.sourceText
        )
          setError(
            `Recovery copy was not saved. Keep this editor open and save your work: ${editorError(e)}`,
          );
        if (
          gen === generation.current &&
          /Workspace work is in progress/.test(editorError(e))
        ) {
          setTimeout(() => {
            if (gen === generation.current) setWriteRetry((n) => n + 1);
          }, 500);
        }
      })
      .finally(() => {
        if (gen === generation.current) {
          pendingCount.current--;
          setPending(pendingCount.current > 0);
        }
      });
  }, [
    identity,
    loaded,
    sourceText,
    valueText,
    dirty,
    busy,
    offer,
    api,
    writeRetry,
  ]);
  const choose = async (recover: boolean) => {
    if (!offer || !id) return;
    setPending(true);
    setError("");
    try {
      const key = { kind, id, scope },
        r = await api.recovery({ type: "get", key });
      if (!r.draft || r.draft.sequence !== offer.sequence)
        throw Error(
          "This recovery copy changed. Reopen the item to review the latest copy.",
        );
      if (recover) {
        if (dirty || !r.compatible || r.draft.source !== sourceText)
          throw Error(
            "The saved item must match the recovery copy. Save or discard any new edits before recovering.",
          );
        await api.recovery({
          type: "recover",
          token: r.token,
          key,
          expected: r.draft.sequence,
        });
        apply(JSON.parse(r.draft.value) as T);
        current.current = {
          token: r.token,
          sequence: r.draft.sequence,
          source: r.draft.source,
          value: r.draft.value,
          identity,
        };
        setSavedAt(r.draft.updatedAt);
      } else {
        await api.recovery({
          type: "remove",
          token: r.token,
          key,
          expected: r.draft.sequence,
        });
        current.current = {
          token: r.token,
          sequence: 0,
          source: "",
          value: "",
          identity,
        };
      }
      setOffer(null);
    } catch (e) {
      setError(editorError(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="working-copy-status" data-recovery-kind={kind}>
      {offer && (
        <div className="notice" role="status">
          <strong>Unfinished working copy: {offer.label}</strong>
          <p>
            Saved locally {new Date(offer.updatedAt).toLocaleString()}. This is
            not a saved revision or publication.
          </p>
          {!compatible && (
            <p>
              The source changed or is unavailable. This copy is retained for
              inspection; it cannot replace the current source.
            </p>
          )}
          {dirty && (
            <p>
              Save or discard the new edits in this editor before recovering the
              earlier copy.
            </p>
          )}
          <div className="button-row">
            <button
              disabled={!compatible || dirty || busy || pending}
              onClick={() => void choose(true)}
            >
              Recover working copy
            </button>
            <button
              disabled={busy || pending}
              onClick={() => void choose(false)}
            >
              Discard recovery copy
            </button>
            <button onClick={() => downloadWorkingCopy(offer)}>
              Save recovery file
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
          <button
            disabled={pending || busy}
            onClick={() =>
              loaded === identity
                ? setWriteRetry((n) => n + 1)
                : setRetry((n) => n + 1)
            }
          >
            Retry recovery
          </button>
        </p>
      )}
      {!offer && dirty && (
        <small role="status">
          {pending
            ? "Saving local recovery copy…"
            : savedAt
              ? "Recovery copy saved locally · save your edits to finish"
              : "Recovery copy pending"}
        </small>
      )}
    </div>
  );
}

function downloadWorkingCopy(draft: WorkingDraft) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `Ordo-working-copy-${draft.kind}-${draft.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkingCopies() {
  const api = useWorkspaceApi(),
    session = useWorkspaceSession();
  const [drafts, setDrafts] = useState<DraftSummary[]>([]),
    [error, setError] = useState("");
  const refresh = () =>
    api
      .recovery({ type: "list" })
      .then((r) => {
        setDrafts(r.drafts ?? []);
        setError("");
      })
      .catch((e) => setError(editorError(e)));
  useEffect(() => {
    void refresh();
  }, [api]);
  return (
    <section className="panel" aria-label="Recover unfinished work">
      <div className="panel-heading">
        <h2>Recover unfinished work</h2>
        <button onClick={() => void refresh()}>Refresh working copies</button>
      </div>
      <p>
        Recovery copies are kept with this workspace and its backups. Open an
        item to review and recover unfinished edits, then save them. Recovery
        does not approve or publish an order.
      </p>
      {error && <p role="alert">{error}</p>}
      {!drafts.length && <p>No unfinished working copies.</p>}
      {drafts.map((d) => (
        <div className="browse-row" key={`${d.kind}:${d.id}`}>
          <strong>{d.label}</strong>
          <small>
            {d.kind} · {new Date(d.updatedAt).toLocaleString()} ·{" "}
            {d.compatible
              ? "Source unchanged"
              : "Source changed or unavailable"}
          </small>
          <div className="button-row">
            <button onClick={() => session.openRecovery(d)}>
              Open item to recover
            </button>
            <button
              onClick={() =>
                void api
                  .recovery({
                    type: "get",
                    key: { kind: d.kind, id: d.id, scope: d.scope },
                  })
                  .then((r) => {
                    if (r.draft) downloadWorkingCopy(r.draft);
                  })
                  .catch((e) => setError(editorError(e)))
              }
            >
              Save recovery file
            </button>
            <button
              onClick={() =>
                void api
                  .recovery({
                    type: "get",
                    key: { kind: d.kind, id: d.id, scope: d.scope },
                  })
                  .then(async (r) => {
                    if (r.draft)
                      await api.recovery({
                        type: "remove",
                        token: r.token,
                        key: { kind: d.kind, id: d.id, scope: d.scope },
                        expected: d.sequence,
                      });
                    await refresh();
                  })
                  .catch((e) => setError(editorError(e)))
              }
            >
              Discard recovery copy
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
