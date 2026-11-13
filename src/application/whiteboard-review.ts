import type { Operation } from "../domain/model";
import type { WhiteboardItem } from "../domain/whiteboards";
import { canonical } from "../export/projection";
export function whiteboardChanges(before: Operation, after: Operation) {
  const changes: {
    entityId: string;
    label: string;
    field: string;
    before: string;
    after: string;
  }[] = [];
  const old = new Map(before.whiteboards?.boards.map((b) => [b.id, b])),
    next = new Map(after.whiteboards?.boards.map((b) => [b.id, b]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id),
      b = next.get(id),
      label = b?.name ?? a!.name;
    const add = (field: string, x: unknown, y: unknown, entityId = id) => {
      if (canonical(x) !== canonical(y))
        changes.push({
          entityId,
          label,
          field,
          before: typeof x === "string" ? x : canonical(x),
          after: typeof y === "string" ? y : canonical(y),
        });
    };
    add("Whiteboard", a?.name ?? "Not present", b?.name ?? "Not present");
    add(
      "Canvas",
      a ? { width: a.width, height: a.height, background: a.background } : null,
      b ? { width: b.width, height: b.height, background: b.background } : null,
    );
    add(
      "Layer order",
      a?.items.map((i) => i.id) ?? [],
      b?.items.map((i) => i.id) ?? [],
    );
    const aa = new Map(a?.items.map((i) => [i.id, i])),
      bb = new Map(b?.items.map((i) => [i.id, i]));
    const readable = (i: WhiteboardItem | undefined) =>
      !i
        ? "Not present"
        : i.kind === "symbol"
          ? { ...i, pin: { name: i.label, definition: i.pin.definition } }
          : i;
    for (const itemId of new Set([...aa.keys(), ...bb.keys()]))
      add("Item", readable(aa.get(itemId)), readable(bb.get(itemId)), itemId);
    const ac = new Map(a?.connectors.map((c) => [c.id, c])),
      bc = new Map(b?.connectors.map((c) => [c.id, c]));
    for (const cid of new Set([...ac.keys(), ...bc.keys()]))
      add(
        "Visual connector",
        ac.get(cid) ?? "Not present",
        bc.get(cid) ?? "Not present",
        cid,
      );
  }
  return { schemaVersion: 1 as const, changes };
}
