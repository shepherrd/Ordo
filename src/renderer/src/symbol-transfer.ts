import {
  militarySymbolDefinitionSchema,
  symbolId,
  type SymbolSnapshot,
} from "../../domain/symbology";
import type { DesktopApi } from "../../application/bridge";

export const symbolTransferType = "application/x-ordo-symbol";
export const symbolDragEnded = "ordo-symbol-drag-ended";
type DragSession = {
  text: string;
  nodeId: string;
  preview?: Promise<SymbolSnapshot>;
};
let session: DragSession | undefined;
let removeListeners: (() => void) | undefined;

export function endSymbolDrag() {
  session = undefined;
  removeListeners?.();
  removeListeners = undefined;
  window.dispatchEvent(new Event(symbolDragEnded));
}

function startSession(text: string) {
  endSymbolDrag();
  session = { text, nodeId: crypto.randomUUID() };
  const escape = (e: KeyboardEvent) => {
    if (e.key === "Escape") endSymbolDrag();
  };
  for (const event of ["dragend", "drop", "blur"])
    window.addEventListener(event, endSymbolDrag);
  window.addEventListener("keydown", escape, true);
  removeListeners = () => {
    for (const event of ["dragend", "drop", "blur"])
      window.removeEventListener(event, endSymbolDrag);
    window.removeEventListener("keydown", escape, true);
  };
  return session;
}

/** Browsers hide DataTransfer contents during native dragover. Retain only the
 * current in-app transfer, and discard it on drop, cancellation or focus loss. */
export function beginSymbolDrag(transfer: DataTransfer, text: string) {
  transfer.setData(symbolTransferType, text);
  transfer.effectAllowed = "copy";
  startSession(text);
}

export function symbolDragPreview(transfer: DataTransfer, desktop: DesktopApi) {
  const text = transfer.getData(symbolTransferType);
  const current = text && text !== session?.text ? startSession(text) : session;
  if (!current) return undefined;
  // Preview reads the editable source; it does not create a consumption snapshot.
  current.preview ??= readSymbolTransfer(current.text, desktop, true);
  return { nodeId: current.nodeId, snapshot: current.preview };
}

export function symbolDragNodeId() {
  return session?.nodeId;
}

export async function readSymbolTransfer(
  text: string,
  desktop: DesktopApi,
  preview = false,
): Promise<SymbolSnapshot> {
  if (text.length > 65536)
    throw Error("Symbol transfer exceeds the size limit");
  const data = JSON.parse(text);
  if (data.kind === "CATALOG") {
    if (preview) {
      const result = await desktop.symbols({
        type: "get",
        kind: "SYMBOL",
        id: symbolId.parse(data.id),
      });
      return {
        definition: militarySymbolDefinitionSchema.parse(
          result.symbol!.definition,
        ),
        source: null,
      };
    }
    const result = await desktop.symbols({
      type: "symbol-pin",
      id: symbolId.parse(data.id),
    });
    const { definition, definitionHash: _hash, ...source } = result.pin!;
    return { definition, source };
  }
  if (data.kind !== "DEFINITION") throw Error("Unsupported symbol transfer");
  return {
    definition: militarySymbolDefinitionSchema.parse(data.definition),
    source: null,
  };
}
