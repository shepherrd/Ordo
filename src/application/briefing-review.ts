import type { Repository } from "./ports";
import type { Operation } from "../domain/model";
import type { DocumentComparison } from "../domain/document-review";
import { canonical } from "../export/projection";
export function briefingChanges(before: Operation, after: Operation) {
  const changes: {
    entityId: string;
    label: string;
    field: string;
    before: string;
    after: string;
  }[] = [];
  const add = (
    entityId: string,
    label: string,
    field: string,
    a: string,
    b: string,
    force = false,
  ) => {
    if (a !== b || force)
      changes.push({
        entityId,
        label,
        field,
        before: a,
        after: a === b ? b + " (selection or order changed)" : b,
      });
  };
  const old = new Map(before.briefings?.decks.map((d) => [d.id, d])),
    next = new Map(after.briefings?.decks.map((d) => [d.id, d]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(id),
      b = next.get(id),
      label = b?.name ?? a!.name;
    add(
      id,
      label,
      "Briefing",
      a?.name ?? "Not present",
      b?.name ?? "Not present",
    );
    add(id, label, "Footer", a?.footer ?? "", b?.footer ?? "");
    add(
      id,
      label,
      "Slide order",
      a?.slides.map((s) => s.title || "Untitled slide").join("\n") ?? "",
      b?.slides.map((s) => s.title || "Untitled slide").join("\n") ?? "",
      canonical(a?.slides.map((s) => s.id)) !==
        canonical(b?.slides.map((s) => s.id)),
    );
    for (const sid of new Set(
      [...(a?.slides ?? []), ...(b?.slides ?? [])].map((s) => s.id),
    )) {
      const sa = a?.slides.find((s) => s.id === sid),
        sb = b?.slides.find((s) => s.id === sid),
        sl = label + " · " + (sb?.title ?? sa?.title ?? "Untitled slide");
      for (const field of [
        "title",
        "layout",
        "body",
        "notes",
        "cardIds",
        "graphic",
      ] as const) {
        const val = (s: typeof sa) =>
          !s
            ? "Not present"
            : field === "cardIds"
              ? s.cardIds
                  .map(
                    (id) =>
                      (s === sa
                        ? before
                        : after
                      ).planningCards?.definitions.find((c) => c.id === id)
                        ?.title ?? "Missing card",
                  )
                  .join("\n")
              : field === "graphic"
                ? s.graphic
                  ? s.graphic.kind === "image"
                    ? s.graphic.asset.originalFilename
                    : "Saved military graphic"
                  : "None"
                : s[field];
        // Identity changes matter even when two selected cards have the same name.
        if (canonical(sa?.[field]) !== canonical(sb?.[field]))
          add(
            sid,
            sl,
            {
              title: "Title",
              layout: "Layout",
              body: "Text",
              notes: "Presenter notes",
              cardIds: "Planning content",
              graphic: "Graphic",
            }[field],
            typeof val(sa) === "string"
              ? (val(sa) as string)
              : canonical(val(sa)),
            typeof val(sb) === "string"
              ? (val(sb) as string)
              : canonical(val(sb)),
            true,
          );
      }
    }
  }
  return { schemaVersion: 1 as const, changes };
}
export function briefingComparison(repo: Repository, c: DocumentComparison) {
  const resolve = (e: DocumentComparison["baseline"]) =>
    repo.resolveEndpoint(
      e.kind === "PUBLICATION"
        ? {
            kind: "PUBLICATION",
            operationId: e.operationId,
            publicationId: e.publicationId!,
          }
        : {
            kind: "REVISION",
            operationId: e.operationId,
            revisionId: e.revisionId,
          },
    ).operation;
  return briefingChanges(resolve(c.baseline), resolve(c.target));
}
