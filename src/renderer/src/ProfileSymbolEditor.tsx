import { useState } from "react";
import { profileSymbol, type UnitProfile } from "../../domain/unit-profiles";
import { SavedSymbolPicker } from "./SavedSymbolPicker";
import { GraphicPreview } from "./GraphicPreview";
import "./symbology.css";
export default function ProfileSymbolEditor({
  profile,
  onChange,
  active,
}: {
  profile: UnitProfile;
  onChange: (p: UnitProfile) => void;
  active: boolean;
}) {
  const [picker, setPicker] = useState(false),
    pin = profileSymbol(profile);
  return (
    <section>
      <h3>Default military symbol</h3>
      <p>
        Choose the symbol that represents this organization. Existing operations
        keep the symbol they started with.
      </p>
      {pin ? (
        <>
          <GraphicPreview
            active={active}
            request={{
              kind: "SYMBOL",
              input: {
                definition: pin.definition,
                size: 100,
                context: "SYMBOL",
                labelSide: "RIGHT",
              },
            }}
          />
        </>
      ) : (
        <p>No default symbol assigned.</p>
      )}
      <div className="button-row">
        <button onClick={() => setPicker(true)}>
          {pin ? "Change symbol" : "Choose symbol"}
        </button>
        <button
          disabled={!pin}
          onClick={() =>
            onChange({ ...profile, schemaVersion: 2, defaultSymbol: null })
          }
        >
          Remove default symbol
        </button>
      </div>
      {picker && (
        <SavedSymbolPicker
          onCancel={() => setPicker(false)}
          onSelect={(defaultSymbol) => {
            onChange({ ...profile, schemaVersion: 2, defaultSymbol });
            setPicker(false);
          }}
        />
      )}
    </section>
  );
}
