import { useEffect, useRef, useState } from "react";
import type { BriefingView } from "../../export/briefing-v1";
import { renderBriefing } from "../../export/briefing-v1";
import { ModalBackdrop } from "./ModalBackdrop";

export function BriefingPreview({
  view,
  index,
}: {
  view: BriefingView;
  index: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(640),
    [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = host.current!;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      {overflow && (
        <p role="status" className="notice warning">
          This slide is too full. Use fewer fields, shorten the text, or split
          it across slides.
        </p>
      )}
      <div
        className="briefing-preview"
        ref={host}
        style={{ height: (width * 720) / 1280 }}
      >
        <iframe
          title="Briefing slide preview"
          sandbox="allow-same-origin"
          onLoad={(event) => {
            const doc = event.currentTarget.contentDocument;
            const s = doc?.querySelector<HTMLElement>(".brief-slide"),
              c = doc?.querySelector<HTMLElement>(".brief-content"),
              f = doc?.querySelector<HTMLElement>(".brief-footer");
            setOverflow(
              !!(
                s &&
                c &&
                f &&
                (c.scrollHeight > c.clientHeight + 2 ||
                  c.getBoundingClientRect().bottom >
                    f.getBoundingClientRect().top + 2 ||
                  s.scrollHeight > s.clientHeight + 2)
              ),
            );
          }}
          srcDoc={renderBriefing(view, index)}
          style={{
            width: 1280,
            height: 720,
            transform: `scale(${width / 1280})`,
          }}
          tabIndex={-1}
        />
      </div>
    </>
  );
}
export function BriefingPresentation({
  view,
  notes = [],
  onClose,
}: {
  view: BriefingView;
  notes?: string[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0),
    [showNotes, setShowNotes] = useState(false);
  const move = (delta: number) =>
    setIndex((i) => Math.max(0, Math.min(view.slides.length - 1, i + delta)));
  return (
    <ModalBackdrop>
      <div
        className="modal briefing-presentation"
        aria-label={view.name + " presentation"}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "PageDown") {
            e.preventDefault();
            move(1);
          }
          if (e.key === "ArrowLeft" || e.key === "PageUp") {
            e.preventDefault();
            move(-1);
          }
          if (e.key === "Home") {
            e.preventDefault();
            setIndex(0);
          }
          if (e.key === "End") {
            e.preventDefault();
            setIndex(view.slides.length - 1);
          }
        }}
      >
        <div className="button-row">
          <strong>{view.name}</strong>
          <span aria-live="polite">
            Slide {index + 1} of {view.slides.length}
          </span>
          <button disabled={!index} onClick={() => move(-1)}>
            Previous slide
          </button>
          <button
            disabled={index === view.slides.length - 1}
            onClick={() => move(1)}
          >
            Next slide
          </button>
          {!!notes.length && (
            <button
              aria-pressed={showNotes}
              onClick={() => setShowNotes((v) => !v)}
            >
              Presenter notes
            </button>
          )}
          <button data-dialog-cancel onClick={onClose}>
            End presentation
          </button>
        </div>
        <div className="briefing-stage">
          <BriefingPreview view={view} index={index} />
        </div>
        {showNotes && (
          <p className="briefing-notes">
            {notes[index] || "No notes for this slide."}
          </p>
        )}
      </div>
    </ModalBackdrop>
  );
}
