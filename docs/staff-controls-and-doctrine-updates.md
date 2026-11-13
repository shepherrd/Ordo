# Staff synchronization, focus preservation, and doctrine updates

20 October 2026 — current development build.

## Staff and organization controls

- Responsible Staff shows one default-source explanation. A separate doctrine-role line appears only when it differs from the displayed assignment and any already-shown default. The base-order panel does not repeat its own staff heading.
- **Collapse all** switches to **Expand all**, and back, in both the Staff & roles editor and the read-only ORBAT staff view. It affects all sections and nested positions of the selected unit without changing saved data.
- Organization validation appears once per distinct problem. Subordinate errors identify the affected unit; identical problems on different units remain separate. Invalid organizations cannot be saved.
- Refreshing a linked ORBAT after switching back from another desktop application retains the staff editor, scroll position, and keyboard focus. Search navigation does not replay merely because background loading finishes.

## Existing operations follow compatible doctrine changes

Operations remain linked to the specific saved doctrine they were created from. A duplicate doctrine is a separate source, even if it has the same name.

Ordo checks for changes when opening a saved operation, returning to its open tab, or saving it. A compatible draft receives a new operation revision using an immutable snapshot of the current saved doctrine. Existing authored content and operation-owned module definitions remain intact.

Compatible changes include renamed doctrine, paragraph and staff labels, updated product titles, added paragraphs, and added module definitions. Doctrine asset references are remapped to equivalent snapshot assets by content hash and MIME type.

Changes that remove existing fields or used modules, change content formats, invalidate existing values or staff references, remove used images, or move authored products into a different hierarchy are flagged for review. The operation keeps its previous doctrine and content. The notice explains the conflict and provides **Review doctrine**. Correct the conflicting doctrine edit and return to the operation or save it to retry.

Unsaved operation editors are not replaced when returning to a tab. Saving those edits checks the doctrine afterward in the same transaction. A stored recovery copy defers adoption until the unfinished edits are recovered and saved or discarded.

Operations outside the draft workflow retain their doctrine. If subsequent editing returns an operation to Draft, its next save checks for compatible updates. Previous operation revisions, approvals, publications, and retained export records continue to use their original exact configuration.

## Existing operations follow organization staff changes

The operation's organization binding now follows saved changes to its source organization's headquarters identity, staff sections, positions, incumbents, defaults, and doctrine role mappings at the same draft open/return/save boundaries. In particular, adding a **Command Staff** section with **Commanding General** and **Deputy Commanding General** makes both positions available to an existing draft. This closes a gap in the earlier doctrine-only update: it did not refresh organization staff.

The position selector groups roles under their actual staff section and uses readable functional-role labels. Assignments follow stable position IDs through renames, section moves, and role changes. A removed position that is still assigned to a product blocks the staff update and produces a review notice. Choose another existing position or restore the default, then save to retry. Identical names never link separate organizations or substitute a new position.

Unsaved writing is preserved; adoption happens after saving it. Recovery copies defer adoption. Approved operations, historical revisions, publications, and retained exports keep their exact staff. The operation's independently planned task-organization units and ORBAT structure are not replaced by this staff update.

## Additional interface audit

- Removed repeated order-field headings while retaining accessible field names.
- Removed duplicate inspector staff warnings and deduplicated repeated module/doctrine validation messages. Invalid doctrine saves are disabled.
- Import/export dialogs own their error message; the workspace behind them no longer repeats it. Unapplied symbol-field warnings appear in the symbol editor once.
- Modals remember the last focused control and restore focus without scrolling the page. Saving a retained preview does not take focus from another active control.
- Expanding an ORBAT reserves its inline space, preventing the page from jumping when the diagram moves into or out of a dialog.
- File search navigation applies once per result selection. Background file refreshes do not replay an old focus target; deliberate keyboard or pointer interaction cancels a delayed search jump.

## Verification

Regression coverage includes adoption on open and save, authored-content preservation, module additions and conflicts, doctrine-image remapping, recovery copies, stale-save rejection, transactional rollback, and unchanged historical revisions, publications and exports.

Desktop checks use isolated fictional workspaces and normal application navigation. They cover returning from the doctrine editor, the conflict notice, the default-staff explanation, warning deduplication, both staff views, section toggles, focus/scroll preservation, and offline save/reopen.

The earlier doctrine/control pass passed **735 tests across 44 suites**, build/type checking, and lint. Its organization desktop script passed **18 checks** and doctrine desktop script passed **5 checks**, with no renderer errors. Screenshots were inspected in Forest and Charcoal, including a 1000-pixel window width.

The additional staff synchronization regressions cover added sections and roles, stable assignments through renames/moves, removed-assignment conflicts, updated role mappings/defaults/incumbents, separate same-name organizations, recovery/save behavior, and exact historical records. The complete suite now passes **741 tests across 45 suites**, plus build/type checking and lint. `scripts/smoke-workspace-audit.cjs` passed **6 checks** for the organization-to-operation flow, validation, diagram scroll, dialog focus and responsive staff controls. `scripts/smoke-focus-notices.cjs` passed **3 checks** for Library search focus, duplicate dialog errors and unapplied symbol edits. Neither desktop run recorded renderer errors. Final staff-control screenshots were inspected in Forest at 1500 pixels and Charcoal at 1000 pixels.

Desktop evidence:

- `.test-data/organization-orbat-13119d1c-a18f-47c9-b5fc-cb1d8ad8b4d4/acceptance.json`
- `.test-data/doctrine-updates-d74368bf-fa46-4ca4-a229-e986469b47f2/acceptance.json`
- `.test-data/focus-notices-f4619a6a-1e5d-4bae-9049-22ae73405462/acceptance.json`
- `.test-data/workspace-audit-b3894930-fb5f-4b5e-b3bd-4d3da45e71e2/acceptance.json`

These changes are in the development build. The retained installer has not been replaced.
