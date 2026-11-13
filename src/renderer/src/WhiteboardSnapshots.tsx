import { useEffect, useState } from "react";
import type { Operation, Publication } from "../../domain/model";
import type { WhiteboardSummary } from "../../application/whiteboard-service";
import { insertWhiteboardImage } from "../../domain/whiteboard-embedding";
import { useWorkspaceApi } from "./WorkspaceContext";
import { ModalBackdrop } from "./ModalBackdrop";
import { editorError } from "./editor-error";
export function WhiteboardSnapshots({
  op,
  boardId,
  publications,
  dirty,
  change,
  onBusy,
}: {
  op: Operation;
  boardId?: string;
  publications: Publication[];
  dirty: boolean;
  change: (fn: (o: Operation) => void) => void;
  onBusy: (busy: boolean) => void;
}) {
  const api = useWorkspaceApi(),
    [records, setRecords] = useState<WhiteboardSummary[]>([]),
    [offset, setOffset] = useState(0),
    [source, setSource] = useState("revision"),
    [revision, setRevision] = useState(op.revision),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<{ name: string; data: string } | null>(
      null,
    ),
    [target, setTarget] = useState(op.orderId);
  const refresh = async (at = offset) => {
    const r = await api.whiteboards({
      type: "list",
      operationId: op.id,
      offset: at,
    });
    setRecords(r.records ?? []);
    setOffset(at);
  };
  useEffect(() => {
    setRevision(op.revision);
    void refresh(0).catch((e) => setError(editorError(e)));
  }, [op.id, op.revision, api]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    onBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError(editorError(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <section
      className="whiteboard-snapshots"
      aria-label="Saved whiteboard snapshots"
    >
      <h3>Saved snapshots</h3>
      <p>
        Capture a saved revision for an order. Inserted images keep this
        snapshot even when the board changes.
      </p>
      <div className="whiteboard-topbar">
        <label className="field">
          Source
          <select
            aria-label="Whiteboard snapshot source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="revision">Saved revision</option>
            {publications.map((p) => (
              <option key={p.id} value={p.id}>
                Publication {p.version} · {p.orderNumber}
              </option>
            ))}
          </select>
        </label>
        {source === "revision" && (
          <label className="field">
            Revision
            <input
              aria-label="Whiteboard snapshot revision"
              type="number"
              min={1}
              max={op.revision}
              value={revision}
              onChange={(e) => setRevision(Number(e.target.value))}
            />
          </label>
        )}
        <button
          disabled={busy || dirty || !boardId}
          onClick={() =>
            void run(async () => {
              const r = await api.whiteboards({
                type: "generate",
                operationId: op.id,
                boardId: boardId!,
                expectedRevision: op.revision,
                revision:
                  source === "revision"
                    ? revision
                    : publications.find((p) => p.id === source)!.sourceRevision,
                publicationId: source === "revision" ? null : source,
              });
              await refresh(0);
              setMessage(`Saved snapshot: ${r.record!.name}.`);
            })
          }
        >
          Create snapshot
        </button>
      </div>
      {dirty && (
        <p className="muted">Save the operation before creating a snapshot.</p>
      )}
      <label className="field">
        Insert snapshot into
        <select
          aria-label="Snapshot destination"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value={op.orderId}>Base order</option>
          {op.attachments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.kind} {a.code} · {a.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="whiteboard-snapshot-list">
        {records.slice(0, 30).map((r) => (
          <article key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <small>
                Saved snapshot · revision {r.sourceRevision} ·{" "}
                {new Date(r.generatedAt).toLocaleString()} · {r.status}
                {r.sourcePublicationId ? " · Published source" : ""}
              </small>
            </div>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const p = await api.whiteboards({
                      type: "preview",
                      id: r.id,
                    });
                    setPreview({ name: r.name, data: p.data! });
                  })
                }
              >
                Preview snapshot
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const image = await api.whiteboards({
                      type: "image",
                      id: r.id,
                    });
                    const caption = `${r.name} — saved whiteboard snapshot · revision ${r.sourceRevision} · ${new Date(r.generatedAt).toISOString()}`;
                    change((o) => {
                      insertWhiteboardImage(
                        o,
                        image.asset!,
                        caption,
                        { kind: "order", productId: target },
                        () => crypto.randomUUID(),
                        new Date().toISOString(),
                      );
                    });
                    setMessage(
                      "Snapshot inserted. Save the operation to keep the new image.",
                    );
                  })
                }
              >
                Insert snapshot
              </button>
              {(["PNG", "SVG"] as const).map((format) => (
                <button
                  key={format}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api.whiteboards({
                        type: "save",
                        id: r.id,
                        format,
                      });
                      if (result.path) setMessage(`Saved ${format}.`);
                    })
                  }
                >
                  Save {format}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
      {!records.length && <p>No saved snapshots yet.</p>}
      {(offset > 0 || records.length > 30) && (
        <div className="button-row">
          <button
            disabled={busy || !offset}
            onClick={() => void run(() => refresh(Math.max(0, offset - 30)))}
          >
            Previous snapshots
          </button>
          <button
            disabled={busy || records.length <= 30}
            onClick={() => void run(() => refresh(offset + 30))}
          >
            More snapshots
          </button>
        </div>
      )}
      {preview && (
        <ModalBackdrop>
          <section
            className="modal whiteboard-snapshot-preview"
            role="dialog"
            aria-label="Whiteboard snapshot preview"
          >
            <h2>{preview.name} · saved snapshot</h2>
            <img src={preview.data} alt={preview.name + " saved snapshot"} />
            <button data-dialog-cancel onClick={() => setPreview(null)}>
              Close preview
            </button>
          </section>
        </ModalBackdrop>
      )}
    </section>
  );
}
