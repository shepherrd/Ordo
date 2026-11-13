import { Field } from "./Fields";
import { roleLabel } from "./ui-text";
import { functionalRoles, type UnitProfile } from "../../domain/unit-profiles";
import {
  StaffDisclosure,
  StaffSectionTitle,
  StaffPositionTitle,
  type StaffDisclosureState,
} from "./OrganizationStaffView";
const uid = () => crypto.randomUUID();
export function OrganizationStaffEditor({
  draft,
  edit,
  disclosure,
}: {
  draft: Pick<UnitProfile, "staff">;
  edit: (fn: (value: Pick<UnitProfile, "staff">) => void) => void;
  disclosure: StaffDisclosureState;
}) {
  const move = <T,>(items: T[], index: number, direction: number) => {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
  };
  const movePosition = (positionId: string, direction: number) =>
    edit((d) => {
      const index = d.staff.positions.findIndex(
        (p) => p.positionId === positionId,
      );
      const sectionId = d.staff.positions[index].sectionId;
      let target = index + direction;
      while (target >= 0 && target < d.staff.positions.length) {
        if (d.staff.positions[target].sectionId === sectionId) {
          [d.staff.positions[index], d.staff.positions[target]] = [
            d.staff.positions[target],
            d.staff.positions[index],
          ];
          return;
        }
        target += direction;
      }
    });
  return (
    <>
      <p className="hint">
        Choose a functional role to match a position to order responsibilities.
        If several positions share a role, choose one as the default.
      </p>
      <fieldset>
        {draft.staff.sections.map((s, si) => (
          <StaffDisclosure
            className="staff-section"
            key={s.sectionId}
            sourceId={s.sectionId}
            title={
              <StaffSectionTitle
                section={s}
                positions={draft.staff.positions.filter(
                  (p) => p.sectionId === s.sectionId,
                )}
              />
            }
            open={disclosure.isOpen(`section:${s.sectionId}`, true)}
            onToggle={() =>
              disclosure.setOpen(
                `section:${s.sectionId}`,
                !disclosure.isOpen(`section:${s.sectionId}`, true),
              )
            }
          >
            <div className="button-row staff-section-tools">
              <Field
                label={`Section name ${si + 1}`}
                value={s.name}
                onChange={(v) => edit((d) => (d.staff.sections[si].name = v))}
              />
              <button
                disabled={si === 0}
                onClick={() => edit((d) => move(d.staff.sections, si, -1))}
              >
                Section up
              </button>
              <button
                disabled={si === draft.staff.sections.length - 1}
                onClick={() => edit((d) => move(d.staff.sections, si, 1))}
              >
                Section down
              </button>
              <button
                onClick={() =>
                  edit((d) => {
                    const sectionId = uid();
                    d.staff.sections.push({
                      ...s,
                      sectionId,
                      name: `${s.name} copy`,
                    });
                    d.staff.positions.push(
                      ...d.staff.positions
                        .filter((p) => p.sectionId === s.sectionId)
                        .map((p) => ({
                          ...p,
                          sectionId,
                          positionId: uid(),
                          defaultForRole: false,
                        })),
                    );
                  })
                }
              >
                Duplicate section
              </button>
              <button
                disabled={draft.staff.positions.some(
                  (p) => p.sectionId === s.sectionId,
                )}
                onClick={() =>
                  edit((d) => {
                    d.staff.sections.splice(si, 1);
                  })
                }
              >
                Remove empty section
              </button>
            </div>
            {draft.staff.positions
              .filter((p) => p.sectionId === s.sectionId)
              .map((p) => {
                const pi = draft.staff.positions.findIndex(
                  (x) => x.positionId === p.positionId,
                );
                return (
                  <StaffDisclosure
                    className="staff-position"
                    key={p.positionId}
                    sourceId={p.positionId}
                    title={<StaffPositionTitle position={p} />}
                    open={disclosure.isOpen(`edit-position:${p.positionId}`)}
                    onToggle={() =>
                      disclosure.setOpen(
                        `edit-position:${p.positionId}`,
                        !disclosure.isOpen(`edit-position:${p.positionId}`),
                      )
                    }
                  >
                    <div className="two-columns">
                      <Field
                        label="Position title"
                        value={p.title}
                        onChange={(v) =>
                          edit((d) => (d.staff.positions[pi].title = v))
                        }
                      />
                      <Field
                        label="Short title"
                        value={p.shortTitle}
                        onChange={(v) =>
                          edit((d) => (d.staff.positions[pi].shortTitle = v))
                        }
                      />
                      <label className="field">
                        <span>Functional role</span>
                        <select
                          aria-label="Functional role"
                          value={p.functionalRole ?? ""}
                          onChange={(e) =>
                            edit((d) => {
                              d.staff.positions[pi].functionalRole = (e.target
                                .value || null) as typeof p.functionalRole;
                              if (!e.target.value)
                                d.staff.positions[pi].defaultForRole = false;
                            })
                          }
                        >
                          <option value="">Unmapped</option>
                          {functionalRoles.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Staff section</span>
                        <select
                          aria-label="Staff section"
                          value={p.sectionId}
                          onChange={(e) =>
                            edit(
                              (d) =>
                                (d.staff.positions[pi].sectionId =
                                  e.target.value),
                            )
                          }
                        >
                          {draft.staff.sections.map((x) => (
                            <option key={x.sectionId} value={x.sectionId}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field
                        label="Rank / grade"
                        value={p.rankGrade}
                        onChange={(v) =>
                          edit((d) => (d.staff.positions[pi].rankGrade = v))
                        }
                      />
                      <Field
                        label="Person filling this role"
                        value={p.incumbent?.name ?? ""}
                        onChange={(v) =>
                          edit((d) => {
                            const position = d.staff.positions[pi];
                            position.incumbent = {
                              name: v,
                              rank: position.incumbent?.rank ?? "",
                              contact: position.incumbent?.contact ?? "",
                              notes: position.incumbent?.notes ?? "",
                            };
                          })
                        }
                      />
                      <Field
                        label="Position description"
                        area
                        value={p.description}
                        onChange={(v) =>
                          edit((d) => (d.staff.positions[pi].description = v))
                        }
                      />
                      <Field
                        label="Position notes"
                        area
                        value={p.notes}
                        onChange={(v) =>
                          edit((d) => (d.staff.positions[pi].notes = v))
                        }
                      />
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={p.defaultForRole}
                        disabled={!p.functionalRole}
                        onChange={(e) =>
                          edit(
                            (d) =>
                              (d.staff.positions[pi].defaultForRole =
                                e.target.checked),
                          )
                        }
                      />
                      Default position for this functional role
                    </label>

                    <details>
                      <summary>Personnel details</summary>
                      {(["rank", "contact", "notes"] as const).map((k) => (
                        <Field
                          key={k}
                          label={
                            k === "rank"
                              ? "Person’s rank"
                              : k === "contact"
                                ? "Contact"
                                : "Personnel notes"
                          }
                          area={k === "notes"}
                          value={p.incumbent?.[k] ?? ""}
                          onChange={(v) =>
                            edit((d) => {
                              const position = d.staff.positions[pi];
                              position.incumbent = {
                                name: "",
                                rank: "",
                                contact: "",
                                notes: "",
                                ...position.incumbent,
                                [k]: v,
                              };
                            })
                          }
                        />
                      ))}
                    </details>
                    <div className="button-row">
                      <button
                        disabled={
                          !draft.staff.positions
                            .slice(0, pi)
                            .some((x) => x.sectionId === p.sectionId)
                        }
                        onClick={() => movePosition(p.positionId, -1)}
                      >
                        Position up
                      </button>
                      <button
                        disabled={
                          !draft.staff.positions
                            .slice(pi + 1)
                            .some((x) => x.sectionId === p.sectionId)
                        }
                        onClick={() => movePosition(p.positionId, 1)}
                      >
                        Position down
                      </button>
                      <button
                        onClick={() => {
                          const positionId = uid();
                          edit((d) =>
                            d.staff.positions.splice(pi + 1, 0, {
                              ...p,
                              positionId,
                              title: `${p.title} copy`,
                              defaultForRole: false,
                            }),
                          );
                          disclosure.setOpen(
                            `edit-position:${positionId}`,
                            true,
                          );
                        }}
                      >
                        Duplicate position
                      </button>
                      <button
                        onClick={() =>
                          edit((d) => {
                            d.staff.positions.splice(pi, 1);
                          })
                        }
                      >
                        Remove position
                      </button>
                    </div>
                  </StaffDisclosure>
                );
              })}
            <button
              onClick={() => {
                const positionId = uid();
                edit((d) =>
                  d.staff.positions.push({
                    positionId,
                    sectionId: s.sectionId,
                    title: "New position",
                    shortTitle: "",
                    functionalRole: null,
                    defaultForRole: false,
                    description: "",
                    notes: "",
                    rankGrade: "",
                    incumbent: null,
                  }),
                );
                disclosure.setOpen(`edit-position:${positionId}`, true);
              }}
            >
              Add position to {s.name}
            </button>
          </StaffDisclosure>
        ))}
        <button
          onClick={() =>
            edit((d) =>
              d.staff.sections.push({
                sectionId: uid(),
                name: "New section",
                description: "",
              }),
            )
          }
        >
          Add staff section
        </button>
      </fieldset>
    </>
  );
}
