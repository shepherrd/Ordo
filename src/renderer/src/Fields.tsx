import type { ReactNode } from "react";
import { RichEditor } from "./RichEditor";
import { readNarrative, writeNarrative } from "../../domain/narrative";
export function Field({
  label,
  value,
  onChange,
  area = false,
  type = "text",
  plain = false,
  contentId,
  hideLabel = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  area?: boolean;
  type?: string;
  plain?: boolean;
  contentId?: string;
  hideLabel?: boolean;
}) {
  if (area && !plain)
    return (
      <div className="field narrative-field" data-content-id={contentId}>
        {!hideLabel && <span>{label}</span>}
        <RichEditor
          label={label}
          value={readNarrative(value)}
          onChange={(v) => onChange(writeNarrative(v))}
        />
      </div>
    );
  return (
    <label className="field" data-content-id={contentId}>
      {!hideLabel && <span>{label}</span>}
      {area ? (
        <textarea
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      ) : (
        <input
          aria-label={label}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
  empty = "Unassigned",
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: { id: string; name: string }[];
  empty?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function Checks({
  label,
  options,
  values,
  onChange,
  hint,
}: {
  label: string;
  options: { id: string; name: string }[];
  values: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  return (
    <fieldset className="checks" aria-label={label} tabIndex={-1}>
      <legend>{label}</legend>
      {hint && <small>{hint}</small>}
      <div>
        {options.map((o) => (
          <label key={o.id}>
            <input
              type="checkbox"
              checked={values.includes(o.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...values, o.id]
                    : values.filter((v) => v !== o.id),
                )
              }
            />
            {o.name}
          </label>
        ))}
        {!options.length && <small>No records yet.</small>}
      </div>
    </fieldset>
  );
}
export function Panel({
  title,
  subtitle,
  children,
  action,
  paragraphId,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: ReactNode;
  paragraphId?: string;
}) {
  return (
    <section className="panel" data-paragraph-id={paragraphId}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Icon({ symbol }: { symbol: string }) {
  return (
    <span className="icon" aria-hidden="true">
      {symbol}
    </span>
  );
}
