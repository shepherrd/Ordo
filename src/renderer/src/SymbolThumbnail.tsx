import { useWorkspaceApi } from "./WorkspaceContext";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MilitarySymbolDefinition } from "../../domain/symbology";
import { queueThumbnail } from "./thumbnail-queue";

/** Fetch visible saved cards only; browsing never creates a consumption snapshot. */
export function SavedSymbolThumbnail({
  id,
  contentVersion,
  active = true,
  iconOnly = false,
}: {
  id: string;
  contentVersion: number;
  active?: boolean;
  iconOnly?: boolean;
}) {
  const desktop = useWorkspaceApi();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  // One completed version per mounted card; no cross-workspace/global cache.
  const [loaded, setLoaded] = useState<{
    id: string;
    contentVersion: number;
    definition: MilitarySymbolDefinition;
  } | null>(null);
  const definition =
    loaded?.id === id && loaded.contentVersion === contentVersion
      ? loaded.definition
      : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((e) => e.isIntersecting)),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setFailed(false);
    if (!active || !visible || definition) return;
    let stopped = false;
    void desktop
      .symbols({ type: "get", kind: "SYMBOL", id })
      .then((r) => {
        if (!stopped)
          setLoaded({ id, contentVersion, definition: r.symbol!.definition });
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
    };
  }, [id, contentVersion, active, visible, definition, desktop]);
  return (
    <div className="saved-symbol-thumbnail" ref={ref} aria-hidden="true">
      {definition ? (
        <SymbolThumbnail
          definition={definition}
          active={active}
          iconOnly={iconOnly}
        />
      ) : (
        <span className="thumbnail-placeholder">
          {failed ? "Preview unavailable" : "…"}
        </span>
      )}
    </div>
  );
}

/** Retain the current completed thumbnail; render new artwork only when visible. */
export function SymbolThumbnail({
  definition,
  active = true,
  iconOnly = false,
}: {
  definition: MilitarySymbolDefinition;
  active?: boolean;
  iconOnly?: boolean;
}) {
  const desktop = useWorkspaceApi();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failure, setFailure] = useState<{ key: string; error: string } | null>(
    null,
  );
  const [completed, setCompleted] = useState<{
    key: string;
    svg: string;
  } | null>(null);
  const key = useMemo(
    () =>
      JSON.stringify(
        iconOnly
          ? {
              ...definition,
              appearance: { ...definition.appearance, infoFields: false },
            }
          : definition,
      ),
    [definition, iconOnly],
  );
  const svg = completed?.key === key ? completed.svg : "";
  const error = failure?.key === key ? failure.error : "";
  useEffect(() => {
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((e) => e.isIntersecting)),
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active || !visible || completed?.key === key) return;
    setFailure(null);
    let stopped = false,
      sent = false;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void queueThumbnail(() => {
        sent = true;
        return desktop.renderGraphic(id, {
          kind: "SYMBOL",
          input: {
            definition: JSON.parse(key),
            size: 35,
            context: "SYMBOL",
            labelSide: "RIGHT",
          },
        });
      }, controller.signal)
        .then((r) => {
          sent = false;
          if (!stopped) setCompleted({ key, svg: r.result.svg });
        })
        .catch((e) => {
          sent = false;
          if (!stopped) setFailure({ key, error: String(e) });
        });
    }, 180);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      if (sent) void desktop.cancelGraphic(id).catch(() => {});
    };
  }, [key, active, visible, completed, desktop]);
  return (
    <div ref={ref} className="symbol-thumbnail" title={error || undefined}>
      {error ? (
        <small>Preview unavailable</small>
      ) : (
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}
