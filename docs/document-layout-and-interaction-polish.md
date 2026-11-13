# Document layout and interaction polish — 9 October 2026

The 0.6.5 development build now supports the drafter's requested document header and footer. This pass also completes the initial shared interaction, keyboard, editing-comfort and visual-consistency sweep. It is development evidence, not packaged qualification or a 1.0 release.

## Configuring a document

Open an operation, then **Configuration → Document header & footer**. Set the centered document title, bold unit/first line, organization/second line, location/third line, entered date/time/fourth line, and right-side classification label. Choose, change or remove a managed PNG, JPEG, GIF or WebP logo. Blank lines are omitted. The preview shows the actual header composition.

The footer has left, centre and right text and an optional page-number control. PDF output repeats these fields on each page, with page and total-page counts on the right. HTML displays footer text at the end; it does not invent pagination. Save the operation before generating a new export. Existing retained documents do not change.

Configuration is explicit: an existing operation does not silently acquire this layout. Header/footer edits participate in operation revisioning and are frozen with publications. Text is escaped, logo ownership and bytes are verified, and exact layout dependencies determine whether a generated document is stale. Full export provenance remains available in Ordo rather than in the printed footer.

## Interaction improvements

- Rich-text editing keeps the selection during formatting and link editing. The toolbar shows active formatting and provides clear formatting, undo/redo, safe link editing, expand/collapse and Alt+F10 keyboard access.
- Shared dialogs contain keyboard focus, honor enabled Cancel actions on Escape, and return focus to the opener. This includes asynchronously opened operation dialogs.
- Catalog editors show consistent working, unsaved, saved and correction-needed feedback. Document selection ignores stale asynchronous results from the previous selection.
- ORBAT editing starts in Select mode. Diagram units support keyboard selection; move mode remains a deliberate action. Accidental click-sized drags do not move units. Reparent choices exclude the selected unit and its descendants, and unavailable order/reset actions are disabled.
- The last implementation step aligned shared focus/pressed states, toolbar wrapping, modal scrolling, long-editor sizing and responsive document settings. Retained SVG bytes and canonical unit relationships are not changed by accessibility or navigation behavior.

## Compatibility and persistence

Additive migration **014** supports the new schema-6 / `html-v6` export envelope. Configured PDF output uses schema 2 / `ordo-print-v2`; older sources still dispatch through the unchanged print implementation. Header/footer review effects use a separate document-presentation receipt and `review-html-v5` report composition, preserving the original comparison and impact engines.

Migrations 001–013 and all checked historical projection, comparison, impact, report and renderer implementations match their frozen baselines. The 91 checks include overlapping historical and pre-pass baseline entries; they are not a claim of 91 distinct files. No existing data is rewritten to adopt the new presentation.

## Verification

- Build and typecheck passed; architecture boundaries passed for 991 module references.
- The full regression suite passed **593 tests across 31 files**, including seven document-layout cases covering escaping, historical dispatch, exact staleness, logo validation/restore, publication immutability, review evidence and retained PDFs. Two subsequent UI fixes for focus return and rich-text selection were compiled and exercised in the fresh complete desktop workflows below.
- The new document/editor desktop workflow passed all **6 checks**. It covers normal dialogs, configured text/logo/footer, rich-text links and selection, multipage HTML/PDF generation, layout-only staleness, and normal offline clean exit/reopen with process timestamps and retained settings.
- The retained catalog desktop workflow passed all **13 checks**, including symbol selectors, staff editing, assets, independent snapshots, native JSON import, deletion, backup/restore and reopen.
- The current operation ORBAT workflow passed all **6 checks**, covering keyboard/pointer interaction, layout undo/redo, subtree-preserving reparenting, cycle prevention, synthetic folds and normal reopen.
- Visual review inspected all **19 PDF pages**: eight A4 portrait pages and eleven Letter landscape pages. The requested header, selected logo, all three footer fields and correct page counters are legible and unclipped. Text extraction independently checked the footer and exact page counter on every page. Catalog symbol, ORBAT tray, organization description and doctrine staff captures were also reviewed.

The successful desktop runs use the current compiled development build and isolated fictional workspaces. Earlier failed attempts remain separate. They exposed focus-return and rich-text selection defects that were corrected; an obsolete navigation locator and a hidden-window layout measurement were also corrected in the new test. No partial attempt counts toward the 25 passing desktop checks. Cleanup used normal application close/dialog actions, not forced termination or service changes.

See the evidence manifest for exact paths and hashes. The personal workspace, existing installer and version number remain untouched. The test document named Operation Testify is an isolated fixture, not an edit of the user's reference operation.

## Remaining polish and release work

1. User hands-on review of the current development build, followed by fixes to the reported wording, workflow and presentation issues.
2. A final coverage review of complete realistic orders, remaining screen sizes and less common editing states. The focused sweep does not establish exhaustive 1.0 usability or visual coverage.
3. Final visual consistency review after any resulting functional changes, followed by complete development and packaged qualification of the exact intended release build. The existing installer does not include this pass.

Deferred major features, including FRAGO authoring, remain outside this polish scope.

## Icon toolbar follow-up — 9 October 2026

At the user's request, the shared rich-text toolbar now uses compact SVG icons. Every button retains its exact action name as a native hover tooltip and accessible label. Active/disabled states, keyboard shortcuts and the underlying editing commands are unchanged. Link/edit/remove, expand/collapse and optional managed-image actions use the same icon treatment.

The development build and type check pass, as does the architecture check (997 references). A focused normal Electron check in an isolated fictional organization verified formatting, lists, quotes, clearing, undo/redo, links, expansion and keyboard toolbar focus, with no renderer errors and normal exit code zero. Captures at 1500 and 1120 pixels were visually reviewed. Evidence: `.test-data/rich-toolbar-d03c61ef-9fa0-42a8-a910-e15006467a98/review.json` and the adjacent toolbar PNGs.

The broader document workflow attempt at `.test-data/polish-desktop-9891274b-5170-444b-898b-eb4f7e8d1542` timed out waiting for its configured header preview to become visible, before reaching the toolbar; it remains failed evidence, with no cause attributed. The focused check does not qualify that workflow or the current installer. This follow-up changes renderer presentation only; the application stays at 0.6.5, with personal data and the installed binary untouched.

## Overview order-progress correction — 9 October 2026

The overview previously counted only legacy paragraph summaries, leaving a structured five-paragraph order at zero even after writing all five paragraphs. It now derives “sections started” from the configured paragraph identities, legacy narrative, current structured narrative and end-state values, valid selected references, and canonical tasks displayed by the base-order editor. Each paragraph counts once. Empty formatting, default entry labels, and unrelated annex/Signal content do not count. This is writing progress, not a completeness or publication-readiness assessment; no stored content, migrations, or historical export semantics changed.

Eight focused regression tests passed, along with build/type checking, formatting, and architecture boundaries (1002 references). `scripts/smoke-order-progress.cjs` passed six checks in an isolated fictional offline workspace: zero on a blank order, immediate updates through all five structured paragraphs including rich text, decrement on clearing a paragraph, save without populating legacy summaries, normal reopen with the correct count, and clean exit without renderer errors. The final card capture was visually reviewed. Evidence: `.test-data/order-progress-99f8296f-2404-4b89-bfd5-484a35240f82/result.json` and `five-sections.png`. This qualifies the focused development correction only; the application remains 0.6.5 and the installed binary and personal workspace were not changed.
