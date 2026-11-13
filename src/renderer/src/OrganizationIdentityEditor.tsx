import { Field } from "./Fields";
import type { UnitProfile } from "../../domain/unit-profiles";
export function OrganizationIdentityEditor({
  identity,
  onChange,
}: {
  identity: UnitProfile["identity"];
  onChange: (identity: UnitProfile["identity"]) => void;
}) {
  return (
    <div className="two-columns">
      {Object.entries(identity).map(([key, value]) => (
        <Field
          key={key}
          area={key === "description" || key === "notes"}
          label={key
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (s) => s.toUpperCase())}
          value={value}
          onChange={(v) => onChange({ ...identity, [key]: v })}
        />
      ))}
    </div>
  );
}
