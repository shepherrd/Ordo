import { useEffect, useRef, useState } from "react";
import type { SymbolSnapshot } from "../../domain/symbology";
import { readSymbolTransfer, symbolTransferType } from "./symbol-transfer";
import { useWorkspaceApi } from "./WorkspaceContext";
import { editorError } from "./editor-error";

export function EmptyOrbatCanvas({
  id,
  active,
  disabled,
  onSymbol,
  onChoose,
  onBusy,
  onError,
}: {
  id: string;
  active: boolean;
  disabled: boolean;
  onSymbol: (snapshot: SymbolSnapshot, name: string) => void;
  onChoose: () => void;
  onBusy: (busy: boolean) => void;
  onError: (error: string) => void;
}) {
  const desktop = useWorkspaceApi(),
    generation = useRef(0),
    pending = useRef(false);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    generation.current++;
    setHover(false);
    return () => {
      generation.current++;
    };
  }, [id, active]);
  return (
    <section
      className={`empty-orbat-canvas ${hover ? "drag-over" : ""}`}
      aria-label="Empty ORBAT canvas"
      onDragOver={(e) => {
        if (
          !active ||
          disabled ||
          pending.current ||
          !e.dataTransfer.types.includes(symbolTransferType)
        )
          return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setHover(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setHover(false);
      }}
      onDrop={(e) => {
        if (
          !active ||
          disabled ||
          pending.current ||
          !e.dataTransfer.types.includes(symbolTransferType)
        )
          return;
        e.preventDefault();
        setHover(false);
        const text = e.dataTransfer.getData(symbolTransferType),
          token = generation.current;
        pending.current = true;
        onBusy(true);
        onError("");
        void (async () => {
          const snapshot = await readSymbolTransfer(text, desktop),
            data = JSON.parse(text);
          const name =
            data.kind === "CATALOG"
              ? (
                  await desktop.symbols({
                    type: "get",
                    kind: "SYMBOL",
                    id: data.id,
                  })
                ).symbol!.name
              : "Unit";
          if (token === generation.current) onSymbol(snapshot, name);
        })()
          .catch((e) => {
            if (token === generation.current) onError(editorError(e));
          })
          .finally(() => {
            pending.current = false;
            onBusy(false);
          });
      }}
    >
      <h3>Start your ORBAT</h3>
      <p>Drag a saved military symbol here to add the root unit.</p>
      <button disabled={disabled} onClick={onChoose}>
        Choose root symbol
      </button>
    </section>
  );
}
