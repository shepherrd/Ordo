import { useId, type ReactNode } from "react";
import type { UnitProfile } from "../../domain/unit-profiles";
import { NarrativeContent } from "./NarrativeContent";

type Staff = UnitProfile["staff"];
export type StaffDisclosureState = {
  isOpen: (key: string, initiallyOpen?: boolean) => boolean;
  setOpen: (key: string, open: boolean) => void;
};

export function StaffDisclosure({
  title,
  open,
  onToggle,
  children,
  className = "",
  sourceId,
}: {
  title: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  sourceId?: string;
}) {
  const id = useId();
  return (
    <section
      className={`staff-disclosure ${className}`}
      data-staff-id={sourceId}
    >
      <button
        type="button"
        className="staff-disclosure-heading"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span className="staff-disclosure-arrow" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {title}
      </button>
      <div id={id} hidden={!open} className="staff-disclosure-body">
        {open && children}
      </div>
    </section>
  );
}

export function StaffSectionTitle({
  section,
  positions,
}: {
  section: Staff["sections"][number];
  positions: Staff["positions"];
}) {
  const filled = positions.filter((p) => p.incumbent?.name.trim()).length;
  return (
    <>
      <strong>{section.name || "Unnamed section"}</strong>
      <span className="staff-summary-count">
        {filled} of {positions.length} filled
      </span>
    </>
  );
}

export function StaffPositionTitle({
  position: p,
}: {
  position: Staff["positions"][number];
}) {
  return (
    <span className="staff-position-summary">
      <strong>{p.title || "Untitled role"}</strong>
      <span>{p.incumbent?.rank.trim() || p.rankGrade || "—"}</span>
      <span className={p.incumbent?.name.trim() ? "" : "staff-vacant"}>
        {p.incumbent?.name.trim() || "Vacant"}
      </span>
    </span>
  );
}

export function OrganizationStaffView({
  staff,
  disclosure,
}: {
  staff: Staff;
  disclosure: StaffDisclosureState;
}) {
  return (
    <div className="organization-staff-view" aria-label="Staff overview">
      {!staff.sections.length && <p>No staff roles assigned to this unit.</p>}
      {staff.sections.map((section) => {
        const positions = staff.positions.filter(
          (p) => p.sectionId === section.sectionId,
        );
        const key = `section:${section.sectionId}`;
        const open = disclosure.isOpen(key, true);
        return (
          <StaffDisclosure
            key={section.sectionId}
            className="staff-section"
            title={
              <StaffSectionTitle section={section} positions={positions} />
            }
            open={open}
            onToggle={() => disclosure.setOpen(key, !open)}
          >
            {section.description && (
              <NarrativeContent value={section.description} />
            )}
            {!positions.length && <p>No roles in this section.</p>}
            {positions.map((p) => {
              const detailKey = `view-position:${p.positionId}`;
              const expanded = disclosure.isOpen(detailKey);
              const details = [
                ["Description", p.description],
                ["Role notes", p.notes],
                ["Contact", p.incumbent?.contact],
                ["Personnel notes", p.incumbent?.notes],
              ].filter(([, value]) => value?.trim());
              return details.length ? (
                <StaffDisclosure
                  key={p.positionId}
                  className="staff-position"
                  title={<StaffPositionTitle position={p} />}
                  open={expanded}
                  onToggle={() => disclosure.setOpen(detailKey, !expanded)}
                >
                  <dl className="staff-role-details">
                    {details.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          <NarrativeContent value={value!} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </StaffDisclosure>
              ) : (
                <div
                  className="staff-position staff-readonly-row"
                  key={p.positionId}
                >
                  <StaffPositionTitle position={p} />
                </div>
              );
            })}
          </StaffDisclosure>
        );
      })}
    </div>
  );
}
