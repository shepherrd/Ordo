import type { RichNode } from "../modules";
import { canonicalValue, equalValue, type Hash } from "./model";
export type RichDelta = {
  key: string;
  summary: string;
  before: unknown;
  after: unknown;
  kind: "ADDED" | "REMOVED" | "MODIFIED" | "RELINKED";
};
type Block = {
  kind: string;
  node: RichNode;
  text: string;
  images: string[];
  links: { href: string; start: number; end: number }[];
  formatting: unknown[];
};
function blocks(doc: RichNode): Block[] {
  const result: Block[] = [];
  function walk(n: RichNode, context = "", listDepth = 0) {
    if (["paragraph", "heading", "image"].includes(n.type)) {
      const b: Block = {
        kind:
          n.type === "heading"
            ? `Heading ${n.attrs?.level}`
            : context || (n.type === "image" ? "Image" : "Paragraph"),
        node: n,
        text: "",
        images: [],
        links: [],
        formatting: [],
      };
      const inline = (v: RichNode) => {
        const start = b.text.length;
        if (v.type === "text") {
          b.text += v.text ?? "";
          const marks = (v.marks ?? [])
            .filter((m) => m.type !== "link")
            .map((m) => m.type)
            .sort();
          const last = b.formatting.at(-1) as
            { text: string; marks: string[] } | undefined;
          if (last && equalValue(last.marks, marks)) last.text += v.text ?? "";
          else b.formatting.push({ text: v.text, marks });
        }
        if (v.type === "hardBreak") b.text += "\n";
        if (v.type === "image") b.images.push(v.attrs!.assetId!);
        v.marks
          ?.filter((m) => m.type === "link")
          .forEach((m) => {
            const last = b.links.at(-1);
            if (last?.href === m.attrs!.href && last.end === start)
              last.end = b.text.length;
            else
              b.links.push({ href: m.attrs!.href, start, end: b.text.length });
          });
        v.content?.forEach(inline);
      };
      inline(n);
      result.push(b);
      return;
    }
    n.content?.forEach((v) =>
      walk(
        v,
        n.type === "bulletList"
          ? `Bullet list item${listDepth ? ` (level ${listDepth + 1})` : ""}`
          : n.type === "orderedList"
            ? `Ordered list item (start ${n.attrs?.start ?? 1}${listDepth ? `, level ${listDepth + 1}` : ""})`
            : n.type === "blockquote"
              ? "Quote"
              : context,
        listDepth + (["bulletList", "orderedList"].includes(n.type) ? 1 : 0),
      ),
    );
  }
  walk(doc);
  return result;
}
// Exact block anchors plus bounded alignment between anchors. No historical block IDs are invented.
export function richDiff(
  before: RichNode,
  after: RichNode,
  hash: Hash,
): RichDelta[] {
  const a = blocks(before),
    b = blocks(after),
    deltas: RichDelta[] = [],
    occurrences = new Map<string, number>();
  const emit = (
    summary: string,
    x: unknown,
    y: unknown,
    kind: RichDelta["kind"],
    context: string,
  ) => {
    const key = hash(canonicalValue({ context, summary, before: x, after: y }));
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    deltas.push({
      key: `${key}/${occurrence}`,
      summary,
      before: x,
      after: y,
      kind,
    });
  };
  const compare = (
    x: Block | undefined,
    y: Block | undefined,
    context: string,
  ) => {
    if (!x || !y) {
      emit(
        `${(y ?? x)!.kind} ${y ? "added" : "removed"}`,
        x?.node ?? null,
        y?.node ?? null,
        y ? "ADDED" : "REMOVED",
        context,
      );
      return;
    }
    if (x.kind !== y.kind)
      emit("Block style changed", x.kind, y.kind, "MODIFIED", context);
    if (x.text !== y.text)
      emit(`${y.kind} text modified`, x.text, y.text, "MODIFIED", context);
    if (!equalValue(x.links, y.links))
      emit("Link changed", x.links, y.links, "RELINKED", context);
    if (!equalValue(x.images, y.images))
      emit(
        "Inline image inserted, removed or replaced",
        x.images,
        y.images,
        "RELINKED",
        context,
      );
    const marks = (v: Block) =>
      v.text === x.text && v.text === y.text
        ? v.formatting
        : [
            ...new Set(
              v.formatting.flatMap((f) => (f as { marks: string[] }).marks),
            ),
          ].sort();
    if (!equalValue(marks(x), marks(y)))
      emit("Text formatting changed", marks(x), marks(y), "MODIFIED", context);
    if (
      equalValue(x.images, y.images) &&
      !equalValue(imageAttrs(x.node), imageAttrs(y.node))
    )
      emit(
        "Image description changed",
        imageAttrs(x.node),
        imageAttrs(y.node),
        "MODIFIED",
        context,
      );
  };
  const signatures = (xs: Block[]) =>
    xs.map((x) =>
      canonicalValue({ kind: x.kind, text: x.text, images: x.images }),
    );
  const sa = signatures(a),
    sb = signatures(b);
  // Linear memory and a bounded look-ahead prevent large documents from requiring a quadratic matrix.
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    const context = `${sa[i - 1] ?? "start"}|${sb[j - 1] ?? "start"}`;
    if (i >= a.length) {
      compare(undefined, b[j++], context);
      continue;
    }
    if (j >= b.length) {
      compare(a[i++], undefined, context);
      continue;
    }
    if (sa[i] === sb[j]) {
      compare(a[i++], b[j++], context);
      continue;
    }
    const find = (xs: string[], v: string, start: number) => {
      for (let k = start; k < Math.min(xs.length, start + 128); k++)
        if (xs[k] === v) return k;
      return -1;
    };
    const inB = find(sb, sa[i], j + 1),
      inA = find(sa, sb[j], i + 1);
    if (inB >= 0 && inB - j <= 128 && (inA < 0 || inB - j <= inA - i)) {
      while (j < inB) compare(undefined, b[j++], context);
    } else if (inA >= 0 && inA - i <= 128) {
      while (i < inA) compare(a[i++], undefined, context);
    } else compare(a[i++], b[j++], context);
  }
  return deltas;
}
function imageAttrs(node: RichNode): unknown[] {
  return [
    ...(node.type === "image" ? [node.attrs] : []),
    ...(node.content ?? []).flatMap(imageAttrs),
  ];
}
