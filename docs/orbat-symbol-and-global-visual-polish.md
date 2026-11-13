# ORBAT, military symbols and application-wide visual polish

9 October 2026. Current **0.6.5 development build**. This pass does not create an installer, change the application version or qualify a release.

The user approved a complete ORBAT/military-symbol polish pass and requested the application-wide visual consistency review during it. The prior document/interaction sweep had not established full application-wide visual coverage. Functional improvements came first; the shared layout and final screen review followed.

## ORBAT and symbol editing

- Saved-symbol lists and selection dialogs show lazy-loaded thumbnails, clear selection, empty-state guidance and readable long names. Browsing does not create consumption snapshots. The selection dialog discards stale asynchronous replies and disables confirmation until the current selection has loaded.
- Everyday numeric controls show verified component names rather than requiring the drafter to read raw codes. Code form and SIDC are under **Advanced: symbol code**. Changing code form explicitly explains that a new example starts, with labels, appearance and render profile retained. Cancel preserves the current symbol; reset has a separate confirmation.
- Appearance labels use ordinary language and consistent field structure. Existing echelon, mobility, symbol-set, legacy and dictionary behavior remains available.
- The diagram has clearer selected-unit/focus markers, **Show selected unit**, predictable fit/reset behavior and a full-window **Expand diagram** view. **Compact diagram** or Escape returns to the editor and restores keyboard focus. These controls change presentation only; retained SVGs and canonical unit relationships are untouched.
- **Change parent** explains the subtree move. Select, move, pan, fold, layout undo/redo and cycle prevention retain their existing protections. Unapplied symbol fields must still be applied or discarded before conflicting actions.
- Imports show a concise summary of the resulting editable copies, dependencies and losses. Required acknowledgement and blockers remain visible; the complete field-by-field report and original values remain available. Unsupported conversions are not silently accepted.

## Shared visual consistency, performed last

- Standardized label markup and grid alignment fixes the reported **Organizations → Sort organizations** offset and equivalent filter rows.
- Shared fields, responsive grids, headings, toolbars, focus states and long text use consistent alignment and wrapping.
- The symbol/organization selection dialogs have enough width for long names and previews. The operation header no longer wastes vertical space at narrower widths. Export studio stacks its controls and document preview when side-by-side display would be too narrow.
- Organization update dates and retained graphic dates are readable and explicitly UTC; exact timestamps remain accessible.

The screen matrix covers eight global destinations; six organization editor tabs; four doctrine editor tabs; all three built-in symbol catalog collections; symbol editing, appearance and reset; saved ORBAT and symbol selection; the operation workspace destinations and configuration; all 26 top-level annex entry screens; and a 50-unit canonical operation diagram in compact and expanded views. Captures use 1,500- and 1,120-pixel content widths, with additional bottom-of-editor captures. This is a defined review matrix, not a claim that every possible record, nested annex, dialog or display size has been exercised.

## Verification and retained boundaries

See the evidence manifest for the exact build, workflow reports, captures and review results.

- Build and type checking passed; the architecture check passed across 995 module references.
- 593 automated tests passed across 31 files. The only subsequent product change was the saved-symbol gallery CSS, covered by the fresh build and desktop sequence below.
- All 57 desktop checks passed in six fresh workflows on the current compiled build: documents, the visual matrix, catalogs/import/restore, pending symbol edits, ORBAT interaction and whole compositions. Normal offline startup, clean exit and reopen passed.
- The final screen matrix contains 149 distinct captures with no detected page/control overflow or filter misalignment. The complete initial matrix was visually reviewed; affected screens were reviewed again after the final gallery correction.
- All 18 profile-1, profile-2 and mixed-profile compositions passed SVG/PNG retention and reopen checks. Their final PNG bytes match the 18 visually reviewed compositions exactly.
- 92 overlapping frozen-file hash checks passed, covering migration and historical-engine baselines. These are checks, not 92 unique files.
- Clipboard verification checked the actual SVG/text/PNG handoff against retained bytes using an isolated in-memory sink. It did not replace the user's clipboard or claim external-application paste coverage.

The document workflow waits for a completed save before inspecting the replacement preview frame and checks actual visible-window rendering. Earlier attempts that inspected an unsettled frame remain failed diagnostic evidence. No product startup flags, security settings, service handling or lifecycle timeout were changed to make those checks pass.

Historical profile 1 remains default and byte-stable; profile 2 remains explicit opt-in; mixed diagrams retain exact per-symbol identities. Known profile-1 crowding, replacement text metrics, viewport differences and NATO artwork differences remain documented. The five unsupported square-canvas cases and unresolved reference conversions remain explicit limitations. No overall reference parity claim is made.

All tests use isolated fictional workspaces. The personal workspace, existing reference operation, installed binary and retained release evidence remain untouched. The current build can be started with `npm start` from the repository.

The next step is hands-on user review and any resulting corrections. Exact-build development/packaged qualification remains necessary before a final release; these polish checks do not substitute for it. FRAGOs and other deferred major features remain outside this work.

## Text-pointer visibility follow-up — 9 October 2026

The user reported that the mouse pointer disappears immediately on hovering over text boxes. The isolated diagnostic confirmed that Ordo requested the native text cursor on plain and rich fields; no hiding rule or `none` cursor event was found. The original disappearance was not visually confirmed, and no operating-system cause was established.

Text-capable inputs, textareas and editable rich text now request a locally bundled, dark I-beam with a white outline and a native text fallback. Disabled controls, dropdowns and other pointer types are unchanged; forced-color accessibility mode retains its native cursor. Windows pointer settings were read only and not changed.

Build/type checks pass. The normal offline desktop check confirmed that Electron received the custom cursor for both tested field types, correctly scaled to 30 × 40 pixels with hotspot 15 × 20 at 125% scaling. Typing, selection, saving and clean exit passed. Before/after observations are in `.test-data/text-cursor-1ad6cca9-ec6a-420e-a6ee-35eb661f2d5b/cursor.json` and `.test-data/text-cursor-148581d1-86a9-45ef-b39f-aae891ffacfc/cursor.json`. This is a visibility correction in the development build, not a new release qualification or proof of the underlying native-cursor cause.

Following feedback that the initial cursor was too large, its source size was reduced from 24 × 32 to 16 × 20 pixels, with a thinner I-beam and a centered 8 × 10 hotspot. The rebuilt development app delivers a 20 × 25 cursor at 125% scaling, with a 10 × 13 hotspot. The repeated isolated offline check passed typing, selection, saving and clean exit for plain and rich text fields; observations are retained in `.test-data/text-cursor-fff7d324-a611-402f-afdc-1044a2a8e11b/cursor.json`. Build/type checks and CSS formatting checks also passed. The earlier larger-cursor evidence above remains historical.

## Symbol editing workflow — 9 October 2026

This historical workflow pass was implemented in the **0.6.5 development build**. Its evidence is recorded separately in reference workflow evidence; the earlier application-wide review above remains historical.

- Military Symbols opens directly into the editor, with one live, fitted preview beside common symbol controls. Main function is prominent; labels remain visible; additional modifiers, appearance and technical options are grouped into disclosures. Save, Delete, Undo and Redo stay together. Permanent deletion confirmation remains in place.
- New, Open, built-in catalog, Import JSON, Export and Saved exports are on the workspace toolbar. Forms and galleries open when needed rather than occupying the editing area. Saved-symbol cards show thumbnails above readable names. Dialogs retain keyboard focus and restore it on dismissal.
- Saved ORBAT editing gives the diagram the main area and places selected-unit actions in a compact inspector beside it. The same existing node handlers supply hierarchy and layout controls; there is no second organizational model. Edit unit symbol opens the shared symbol editor. Saving preserves the selected unit, and fine-position offsets are available under a disclosure.
- In 1.0, Ordo JSON previews the editable symbol or hierarchy before import. A map opens in the ORBAT editor.
- Import graphics are presentation-only, limited to previews of the first twelve targets; all valid targets still import. Tests confirm that altering a returned preview cannot alter the committed data or original retained source. Import rules, receipts, unsupported conversions and provenance decisions are unchanged.

The visual pass was performed after interaction changes. It corrected fitted-preview overflow, an old gallery-column constraint, narrow saved-symbol cards and inherited dialog spacing. Editor, chooser, catalog, import and selected-unit dialog captures were reviewed at 1,500- and 1,120-pixel widths. This review is scoped to these workflows, not a new claim of complete application-wide coverage.

Verification:

- Build/type checking, formatting and architecture checks pass (1,008 module references). The full automated suite passed **603 tests** after the import-preview and component changes; later presentation refinements were verified in fresh desktop runs.
- The final compiled build passed **9 reference workflow checks** and **21 retained composition checks**, covering all 18 profile-1/profile-2/mixed compositions, export handoff, clean exit and reopen. The final nine editor/dialog captures are retained. Each of the 18 exported SVG and PNG pairs exactly matches the previously reviewed bytes.
- **9 selector checks** and **6 operation-ORBAT interaction checks** passed before the final chooser-card/dialog-spacing CSS correction. Their separate build evidence is retained; these results are not presented as a combined release-acceptance sequence. Script updates only open the new dialogs/disclosures; assertions, fixtures and lifecycle limits remain intact.
- All 92 overlapping frozen-file checks match the preceding immutable baselines. No migration, historical projection/review implementation, render profile or renderer resource changed. React DOM portals are allowed only in the renderer boundary.
- Tests used isolated fictional workspaces. Normal offline startup, exit-code-zero shutdown and reopen passed; the new workflow additionally confirms that the preceding process tree has exited. Earlier locator/disclosure-navigation failures remain diagnostic evidence, not passing checks.

Profile 1 remains the historical default; profile 2 remains explicit opt-in, including in mixed diagrams. Known graphic differences and unsupported conversions remain documented. This pass creates no installer, version bump or release qualification, and leaves the personal workspace untouched. Restart the development app with `npm start` to use the changes.

### Symbol terminology follow-up — 9 October 2026

The shared symbol editor, selector dialog titles/help and numeric catalog display now use **Main icon**, **First icon modifier** and **Second icon modifier**, matching the user's reference. Symbol set retains its existing label. Display aliases leave catalog records, stable identifiers, stored codes, source citations and reference JSON conversion unchanged; common modifiers remain separately identified where Ordo presents those additional choices.

The rebuilt 0.6.5 development app passes type checking, formatting, architecture checks and all nine retained symbol-selector desktop checks, including shared ORBAT editing and normal offline clean exit/reopen. The main-icon dialog at 1,500 pixels and first-icon-modifier dialog at 1,120 pixels were visually checked. Exact compiled hashes and checks are in `.test-data/symbol-selectors-0d1c0b7c-37c5-4d9a-9739-3ea3d4948596/acceptance.json`. No installer or new release was created.

## Combined Symbols & ORBATs workspace — 9 October 2026

The two global destinations are now one **Symbols & ORBATs** page. This supersedes the separate Open dialogs described in the earlier workflow entry. Combined workspace evidence records this build separately.

- One persistent saved military symbols list remains on the left, with searchable thumbnails and pagination. **Symbol editor** and **ORBAT maps** switch the right-hand view. An inline map selector opens saved ORBATs without a separate gallery dialog.
- Clicking a diagram unit displays its resolved symbol and unit name above the saved-symbol list. **Edit selected unit symbol** opens the shared editor for that unit. The preview uses the diagram's existing name binding and symbol resolution; selecting a unit creates no library item.
- Saved symbols can be dragged from the persistent list onto an ORBAT unit. Existing independent consumption snapshots and unit overrides remain authoritative. Editing an ORBAT unit leaves the original saved symbol and unit hierarchy unchanged.
- Both editors remain mounted when switching views, preserving unsaved work and undo history. Save/discard guards still protect replacement actions. Leaving the combined page and returning preserves the current view and map. reference and native JSON imports, conversion reports, permanent deletion confirmation and export history remain available.
- The map retains the main editing area; selected-unit name and annotation sit above it, with additional actions/layout controls below. The left preview/list and view tabs remain available while scrolling. The map's initial fit is constrained to a readable viewport; graphic definitions, rendering profiles and retained exports are unchanged.

Build/type checking, formatting and architecture checks pass (1,017 module references). On the final compiled build, **11 combined-workflow checks**, **9 selector checks** and **21 composition checks** pass, including normal offline startup, clean exit and reopen. Direct diagram clicks, saved-symbol drag/drop, independent unit edits, unsaved edits across views, reference symbol/tree imports and all 18 retained compositions are covered. A separate visual-navigation check confirms saved-map switching, persistent selection after visiting Dashboard and exit code zero.

The combined page, selected-unit dialog and import flows were reviewed at 1,500- and 1,120-pixel widths. Eleven captures are retained, including the map selector at the top of the page. Sticky-tab background, thumbnail readability and map-toolbar spacing were corrected during the pass. All 18 final composition SVG/PNG pairs exactly match the previously reviewed bytes, and all 92 overlapping frozen-file checks match their baselines.

An earlier drag/drop test compared an editable library identifier with an immutable consumption-snapshot identifier. Its corrected assertion verifies the exact existing `symbol-pin` result; no product snapshot behavior changed. That failed attempt remains diagnostic evidence and is excluded from the passing counts.

This is targeted development verification, not a full automated-suite rerun or packaged release qualification. No schema migration, historical engine, renderer resource, version, installed binary or personal workspace changed. Known reference conversion and rendering differences remain documented. Restart the development app with `npm start` to use the combined page.

### Current-symbol sizing correction — 9 October 2026

The reported 38th MID preview issue was reproduced using a read-only copy of its saved symbol definition in an isolated workspace. At a 1,500-pixel window width, 60 successive frame samples showed continuous alternation between 100% and approximately 93% zoom. Width-only fitting exceeded the compact canvas height; the resulting vertical scrollbar reduced the available width, and shrinking the symbol removed the scrollbar again.

The compact preview now has a fixed-height viewport and fits both dimensions using the actual padding. It centers the complete fitted graphic without scrollbars. Manual zoom still allows scrolling, **Fit symbol** restores the full view, and selecting a different symbol or ORBAT unit starts its preview fitted. SVG bounds are measured before painting. The larger editor/diagram previews retain their existing fit behavior.

The exact copied 38th MID definition remains stable for all 60 observed frames at both 1,500 and 1,120 pixels, with no scroll overflow. The five new preview checks cover repeated resizing, long labels, stacking, manual zoom/refit, view switching, ORBAT selection, saved-data integrity and normal offline exit/reopen. Eleven combined-workspace checks and six operation-ORBAT checks also pass on the current compiled build. Build/type checking, formatting and architecture checks pass. The 92 overlapping frozen-file checks and all six main/preload compiled-file hashes match the preceding build.

Before/after measurements, screenshots and exact build evidence are retained in preview sizing evidence. Personal records, saved definitions, rendering profiles and renderer output were not changed. This remains a 0.6.5 development correction; no installer or new release qualification was produced.

### Saved-symbol rail and unit task groups — 9 October 2026

The ordinary reference ORBAT export stores the command-level radio control's value as text. Ordo previously rejected `"1"` before checking its valid range. The importer now explicitly accepts decimal integer text as well as numbers within 1–64, retaining the exact original JSON and reporting the conversion. Blank, fractional, out-of-range, hexadecimal, exponent and nonnumeric inputs remain invalid. The import report uses **Converted** for conversions rather than incorrectly calling every conversion a new identifier. No symbol crosswalk or unsupported-content policy changed.

The **Preview details** disclosure and clipped instruction below the saved symbols have been removed. Actual rendering errors and retained diagnostic records remain available. The saved-symbol list scrolls independently and can receive keyboard focus; the current preview, search and count stay in place. The global and operation branding now read **Libertas Optima Rerum**.

Task Organization now has one navigation destination under **Annexes**, with the same canonical units and Tree/ORBAT views. Existing unit shortcuts resolve to that destination. Legacy starter operations retain their annex editor; profiles without a Task Organization product retain unit access under the annex section. Navigation does not include or omit a product, change the hierarchy, or save an operation revision. Retained workflow selectors were adapted to the annex destination without changing their authoring assertions or lifecycle limits.

**Tasks & objectives** groups tasks by unit with individual collapse/expand and all-unit controls. A task created within a unit starts assigned to that unit; reassignment moves it to its destination group. Shared objectives appear with the units whose tasks reference them and edit the same canonical record. Unassigned tasks and objectives remain visible. Assignment fields stack in narrow workspaces. Grouping adds no operation fields or secondary ownership model.

The final compiled 0.6.5 development build passes 66 targeted import/catalog tests and 28 desktop checks across four isolated workflows: six requested-interaction checks, five preview-sizing checks, eleven combined reference-workspace checks and six operation-ORBAT checks. Normal offline startup, clean exit/reopen, independent symbol snapshots, saved assignments and import hierarchy are covered. Six current screenshots were visually reviewed at desktop and narrow widths. Build/type checking, formatting, architecture boundaries (1,022 module references) and diff whitespace checks pass. All 92 protected migration, historical-engine and renderer-resource hashes match the preceding baseline.

Current evidence records exact compiled/source hashes, screenshots and workflow results. Two failed harness attempts remain diagnostic evidence: an incomplete fictional task fixture and an overly broad SVG capture selector. Neither is counted as a pass. This is targeted development verification, not a full milestone sequence or packaged release qualification. No installed binary, personal workspace, database schema or application version was changed. Save and restart the development app with `npm start` to load the changes.

### Empty new ORBATs and an explicit first unit — 9 October 2026

**Create ORBAT** now saves an empty map with no placeholder unit. The full-width canvas invites the planner to drag a saved military symbol into it. That first drop creates the root unit with an independent, verified symbol snapshot and the symbol's designation or saved name. **Choose root symbol** provides the same behavior without dragging. Unit controls appear after the first unit exists. Undo returns to the empty map, redo restores the same root, and ordinary subordinate authoring then works as before. Existing compositions and imports are unchanged.

The editable catalog accepts an explicit empty composition with a reserved root identifier and zero nodes. Empty maps can be named, saved, reopened and backed up; layout references to absent units remain invalid. Recovery accepts an empty source with an unsaved first-root edit. The historical complete-tree schema is unchanged, and consumption boundaries reject empty maps with a clear instruction to add a root. No database migration was needed. The saved-symbol picker passes its chosen display name with the already-verified pin instead of treating an immutable snapshot ID as an editable catalog ID.

The final current build passes **141 targeted tests** covering catalog validation, backup/recovery, imports, lifecycle and retained graphical orders, plus **30 desktop checks** across empty-map creation, the combined reference workflow, preview sizing and shared symbol selectors. Normal offline clean exit/reopen passes. All 92 protected hashes match; type checking, build, architecture boundaries and formatting pass. The empty canvas at 1,500 and 1,120 pixels and the first dragged root were visually reviewed. Current workflow fixtures that previously assumed an automatic root now add their test unit explicitly.

Empty ORBAT evidence retains the exact build, source hashes and screenshots. This remains a 0.6.5 development change, with no installer, release qualification or personal-workspace modification.

### Direct ORBAT dragging and placement preview — 12 October 2026

The shared saved/operation ORBAT canvas now supports dragging in its default selection mode. Dropping on the centre of a unit moves the dragged subtree under that unit; the outer edges insert it before or after the target. A translucent symbol card shows the destination using the same projected data and versioned layout renderer as the committed move, including canonical parent-bound labels. Existing keyboard selection and explicit parent controls remain available.

**Move position** remains a separate presentation-only action, with a live card calculated in SVG coordinates so zoom and scrolling do not change the intended displacement. Dropping outside the canvas, Escape, pointer cancellation, capture loss, window blur, inactive/read-only state or a changed source cancels the transient gesture. Release revalidates its current target. Cycles, self-drops and moving the declared saved root remain blocked. Completed moves use the existing single history action and save/revision path.

The overlay is editor-only DOM: it has no selectable unit identity, namespaces copied SVG resource IDs, and is removed when the drag ends. Other units beneath the card fade temporarily to keep labels readable. Folded destinations state that the unit will be inside a folded branch. Expanded diagrams intercept Escape for an active drag without dismissing the diagram. No database field, migration, rendering engine, saved artifact, symbol profile, application version or personal workspace changes.

The final compiled 0.6.5 development build passes **66 targeted tests** and **31 desktop checks**: eight dedicated drag checks, seven operation-ORBAT checks, five empty-map checks and eleven retained reference workflows. The drag workflow compares prospective and committed coordinates, retains complete subtrees and mixed symbol profiles, checks cancellation and invalid targets, and verifies normal offline exit/reopen. Seven current captures were visually reviewed. All 92 frozen hashes and six main/preload compiled files match their prior baseline; build/type checking, formatting, architecture boundaries (1,044 references) and whitespace checks pass.

Drag-and-drop evidence records exact source/build hashes, measurements, screenshots and the four complete current runs. Earlier diagnostic attempts are excluded. The new gesture runner uses the existing hidden test-window option after a visible-window trace showed pointer-capture interruption; this changes only test-window visibility, with no startup flags or timeout changes. This is targeted development verification, with no installer or release qualification. Save and restart the development app with `npm start` to load the changes.

### Saved-symbol drops create subordinates — 12 October 2026

Dropping a saved military symbol onto the centre of an existing unit now creates a new subordinate in both saved and operation ORBATs. Edge drops still insert siblings. Hover feedback and the operation's saved-symbol tray describe these actions. The new unit receives its own identity and the exact independent symbol snapshot through the existing creation path; the parent and its existing descendants stay unchanged. Undo/redo treats the addition as one edit.

Canvas symbol transfers no longer support implicit replacement. **Replace symbol only** in a saved ORBAT and **Choose saved symbol** in an operation unit's editor remain explicit replacement actions. Empty-map root creation is unchanged. No domain, persistence, historical engine or renderer-resource changes are required.

Verification on the current compiled 0.6.5 development build: **32 focused tests and 25 desktop checks pass**, including saved/operation subordinate drops, exact snapshots, unchanged existing units, explicit saved-ORBAT replacement, undo/redo, empty-map root creation and normal offline clean exit/reopen. Build/type checking and architecture checks pass. All 92 frozen-file hashes and six main/preload files remain unchanged. Saved-symbol subordinate evidence records the exact build and complete passing runs. Two failed harness attempts remain excluded: an accidentally collapsed control section and a map-creation helper returning the previous empty map's ID before creation completed. Both helpers were corrected and their complete workflows rerun. No product rebuild was needed for those test corrections, and no installer was produced.

### Saved-symbol placement preview and unit symbol copies — 12 October 2026

Dragging a saved symbol onto an existing saved/operation ORBAT unit now shows a translucent symbol card at the proposed subordinate position. Edge placement still previews a sibling. The preview and insertion call the same local insertion function and existing layout renderer, with the same new unit ID. The preview reads the library definition without creating a stored consumption snapshot or changing the map. A short-lived in-app transfer supplies the source while Chromium protects native drag payloads during hover; drop, drag end, Escape and focus loss clear it. Leaving the canvas, invalid destinations, changing drafts and late render responses cannot leave a stale placement card.

Folded destinations retain their folded state and display the incoming symbol at the fold marker with **Inside folded unit**. The new symbol's artwork is rendered separately only when the folded projection has no visible source node to copy. This remains an editor overlay; exports, retained SVGs and renderer profiles are unchanged.

**Save to symbols** appears below the selected saved-ORBAT symbol preview and beside operation-unit actions. It opens a naming dialog and uses the existing atomic symbol-creation command to save an independent copy. The copy retains the displayed labels, saved-ORBAT annotation, operation override and exact render profile, with a new library/definition identity. It does not copy the hierarchy or change the selected unit, source symbol or operation revision. Cancel creates nothing; a successful save refreshes the saved list/tray. Invalid or unapplied symbol edits must be resolved before copying.

On the final development build, **37 focused tests and 39 desktop checks pass**. Native Chromium dragover is explicitly verified with an empty/protected payload, and the preview's SVG position and unit ID match the committed insertion. Coverage includes both ORBAT editors, mixed profiles, folded/SIMPLE destinations, cancel, undo/redo, independent copies and subsequent library edits, existing subtree/position dragging, reference import, empty-map roots and normal offline clean exit/reopen. Six current screenshots were reviewed. Build/type checking, formatting, whitespace and architecture checks (1,052 references) pass; all 92 frozen hashes and six main/preload files remain unchanged. Placement-preview and symbol-copy evidence retains exact build/source fingerprints and complete passing runs. Earlier diagnostic/staged runs are excluded. Ordo remains 0.6.5; no installer or release qualification was produced.
