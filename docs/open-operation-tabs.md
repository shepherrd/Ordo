# Open operation workspace tabs

This navigation update is included in the 0.6.1 build; see the release notes for qualification status. The qualified 0.6.0 installer, unpacked application, compiled output, and M6 evidence are preserved separately. No migration, domain model, historical engine, or import behavior changed.

## Behavior

- **Open operations** replaces **Return to operation** in the global sidebar. Each row has the operation's current name, an active marker, an unsaved indicator, and a close button.
- Opening an operation from the catalog, Dashboard, or creation dialog adds one editor keyed by its stable operation ID. Opening it again selects the existing editor.
- Switching between open operations or visiting global pages preserves each editor's planning draft, export-profile draft, selected page, and local undo history. Switching does not save a revision.
- Closing a clean editor removes its row. Closing an edited editor offers **Save and close**, **Discard changes and close**, and **Cancel**. A failed save keeps the editor and its content open.
- Closing the active editor selects an adjacent open operation. Closing the last editor returns to the Operations catalog. Closing an inactive editor leaves the current page in place.
- The saved operation always remains in the catalog. Closing an editor never deletes, archives, or publishes it. Choosing Save uses the existing revision and workflow rules; closing alone adds no domain state.
- Only the ordered list of stable IDs is retained in local renderer storage. Normal restart opens Dashboard and restores the list against saved operation data. Draft content remains in memory until explicitly saved; existing window-close protection covers every open draft.
- Workspace restore requires edited operations to be saved or closed first and clears the old list after a successful restore.

## Implementation

`ApplicationShell` owns the open list and close dialog. Each keyed `App` instance owns its editor state and exposes its existing save behavior through a renderer-only handle. Closing uses a functional state update so an asynchronous save cannot replace another editor's newer status.

The list and persistence live in the renderer, outside operation revisioning and publication. Existing global-navigation test adapters now select visible editors and named operation rows. Their authoring, provenance, and restore assertions are retained.

## Initial development verification

The focused `scripts/smoke-open-operations.cjs` workflow covers independent drafts, duplicate opens, page/undo retention, both window widths, inactive close/cancel/discard/save, revision conflicts, export-profile drafts, and normal offline restart. The retained navigation and global-workspace workflows provide regression coverage.

The final isolated build passed **90 checks**: 7 focused tab checks, 6 retained navigation checks, and 77 retained global-workspace checks, including backup/restore. Type checking, formatting, and architecture boundaries passed. Both sidebar layouts and the close dialog were visually reviewed.

Final evidence is recorded separately in [open-operation-tabs-evidence.json](open-operation-tabs-evidence.json). Earlier failed selector attempts and the old restore workflow's failure to close retained drafts remain in their original folders and are not counted as passes. The revised workflow explicitly verifies the restore guard and closes its fictional drafts first. This development verification does not requalify or replace the frozen M6 release.
