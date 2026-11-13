import { useState } from "react";

export function useTimelineSources(operationId: string) {
  const key = "ordo.timeline.hiddenSources." + operationId;
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
      return new Set(
        Array.isArray(saved)
          ? saved.filter((id): id is string => typeof id === "string")
          : [],
      );
    } catch {
      return new Set();
    }
  });
  return {
    hidden,
    setVisible: (ids: string[], visible: boolean) => {
      const next = new Set(hidden);
      for (const id of ids)
        if (visible) next.delete(id);
        else next.add(id);
      setHidden(next);
      try {
        sessionStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* The view still works without session storage. */
      }
    },
  };
}

export function TimelineSources({
  sources,
  hidden,
  setVisible,
}: {
  sources: { id: string; name: string }[];
  hidden: Set<string>;
  setVisible: (ids: string[], visible: boolean) => void;
}) {
  const shown = sources.filter((s) => !hidden.has(s.id)).length;
  return (
    <details className="timeline-sources">
      <summary>
        Synced timelines · {shown} of {sources.length} shown
      </summary>
      <div className="button-row">
        <button
          disabled={shown === 0}
          onClick={() =>
            setVisible(
              sources.map((s) => s.id),
              false,
            )
          }
        >
          Hide all synced timelines
        </button>
        <button
          disabled={shown === sources.length}
          onClick={() =>
            setVisible(
              sources.map((s) => s.id),
              true,
            )
          }
        >
          Show all synced timelines
        </button>
      </div>
      {sources.map((s) => (
        <label key={s.id}>
          <input
            type="checkbox"
            checked={!hidden.has(s.id)}
            onChange={(e) => setVisible([s.id], e.target.checked)}
          />
          {s.name}
        </label>
      ))}
    </details>
  );
}
