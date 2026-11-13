import { useState } from "react";
import { Panel } from "./Fields";
import { themes, themeFromId, saveTheme } from "./themes";

export function ThemeSettings() {
  const [selected, setSelected] = useState(() =>
    themeFromId(document.documentElement.dataset.theme),
  );
  const [saved, setSaved] = useState(true);
  return (
    <Panel title="Appearance" subtitle="Choose the colors for your workspace.">
      <div className="theme-settings">
        <label className="field">
          <span>Color theme</span>
          <select
            aria-label="Color theme"
            aria-describedby="theme-description theme-saving"
            value={selected.id}
            onChange={(event) => {
              const next = themeFromId(event.target.value);
              setSelected(next);
              setSaved(saveTheme(next));
            }}
          >
            {(["light", "dark"] as const).map((mode) => (
              <optgroup
                key={mode}
                label={mode === "light" ? "Light themes" : "Dark themes"}
              >
                {themes
                  .filter((t) => t.mode === mode)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="theme-palette" aria-hidden="true">
          <span className="theme-swatch theme-swatch-nav" />
          <span className="theme-swatch theme-swatch-accent" />
          <span className="theme-swatch theme-swatch-surface" />
          <span className="theme-swatch theme-swatch-paper" />
        </div>
      </div>
      <p id="theme-description" className="theme-description">
        {selected.description}
      </p>
      <p
        id="theme-saving"
        className={saved ? "hint" : "notice error"}
        role="status"
      >
        {saved
          ? "Applies immediately and is saved on this computer. Document and military-symbol colors stay the same."
          : "Theme applied for this session. Ordo could not save the choice on this computer."}
      </p>
    </Panel>
  );
}
