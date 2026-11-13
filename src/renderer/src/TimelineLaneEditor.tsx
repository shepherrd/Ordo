import { useState } from "react";
import { laneColors, type TimelineLane } from "../../domain/planning-schedule";
import { ModalBackdrop } from "./ModalBackdrop";

export function TimelineLaneEditor({
  lane,
  lanes,
  onSave,
  onRemove,
  onClose,
}: {
  lane: TimelineLane | null;
  lanes: TimelineLane[];
  onSave: (lane: TimelineLane) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(lane?.name ?? "");
  const [color, setColor] = useState<TimelineLane["color"]>(
    lane?.color ?? laneColors[lanes.length % laneColors.length],
  );
  const duplicate = lanes.some(
    (other) =>
      other.id !== lane?.id &&
      other.name.toLowerCase() === name.trim().toLowerCase(),
  );
  return (
    <ModalBackdrop>
      <form
        className="modal timeline-lane-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && !duplicate)
            onSave({
              id: lane?.id ?? crypto.randomUUID(),
              name: name.trim(),
              color,
            });
        }}
      >
        <h2>{lane ? "Edit lane" : "Add lane"}</h2>
        <label className="field">
          <span>Lane name</span>
          <input
            data-dialog-initial
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {duplicate && <p role="alert">A lane already has that name.</p>}
        <fieldset className="timeline-colors">
          <legend>Lane color</legend>
          {laneColors.map((tone) => (
            <label key={tone} data-tone={tone}>
              <input
                type="radio"
                name="lane-color"
                value={tone}
                checked={tone === color}
                onChange={() => setColor(tone)}
              />
              {tone}
            </label>
          ))}
        </fieldset>
        {lane && (
          <p className="hint">
            Removing this lane moves its events to Unsorted events.
          </p>
        )}
        <div className="button-row">
          <button
            className="primary"
            type="submit"
            disabled={!name.trim() || duplicate}
          >
            {lane ? "Save lane" : "Add lane"}
          </button>
          <button type="button" data-dialog-cancel onClick={onClose}>
            Cancel
          </button>
          {lane && (
            <button
              type="button"
              className="text-button danger"
              onClick={onRemove}
            >
              Remove lane
            </button>
          )}
        </div>
      </form>
    </ModalBackdrop>
  );
}
