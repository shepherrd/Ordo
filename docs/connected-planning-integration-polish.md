# Connected planning integration polish

19 October 2026. Follow-up to all six deliveries in the [implementation plan](connected-planning-implementation-plan.md). The functional changes were completed before the final visual consistency pass.

## Completed changes

- Independent planning-card copies retain the source operation across alternatives, including nested alternatives. Existing revisions are resolved through immutable baseline and identity metadata rather than rewritten. New alternative records capture that origin mapping, so later source deletion does not redirect a copied card to an unrelated local record. Copy origins are historical provenance and do not block deletion as live links.
- Alternative comparison resolves names only for typed references. Ordinary writing that happens to equal an internal ID remains unchanged. Fields have readable labels, revision controls show save dates, and available changed records offer **Open current source** in the correct alternative.
- **Used in** includes saved references across operations as well as applied open drafts. Retained orders, briefing PDFs, whiteboard snapshots, and Office exports open directly in a source preview. Saved PDF, PNG, and Office bytes can be copied from there. Historical dependency coverage is labeled where exact source IDs were not retained.
- Office history reports **Current**, **Outdated**, **Source unavailable**, and **Superseded** against the saved operation. PPTX freshness includes presenter notes. Removing the editable briefing preserves its retained file and frozen source preview. Previewing and saving a retained file do not regenerate it. The Office preview explicitly identifies source content; Office pagination may differ.
- Ready products reopen when their writing or linked information changes, with **Writing changed** or **Linked information changed** shown as the reason. Unrelated facts and unselected card values do not reset readiness. Audience/phase changes and generated collections are tracked. Explicit re-attestation clears the reason; formal approval remains separate.
- The final visual pass sizes retained previews to the available window, separates saved-output records and actions, aligns revision/date controls, and improves Office history spacing. Native-save focus recovery allows Escape to dismiss the top preview and restores focus to its opener. Errors remain visible inside the preview.
- Delivery documentation now distinguishes implemented features from separately deferred milestones.

## Qualification

The pre-change working tree is preserved in `.test-data/connected-polish-baseline-2026-10-19T23-11-06-993Z`. Existing uncommitted development work and the retained 0.6.5 release are preserved. Exact source/build hashes and qualification runs are recorded in [integration evidence](connected-planning-integration-polish-evidence.json).

The full automated suite passes **721 tests**. Six targeted integration cases cover literal comparison values, legacy and nested copy origins, original-operation deletion, selective readiness, revision/source navigation, and retained DOCX/PPTX freshness, publication supersession, and immutable bytes. Typecheck, build, unused-code, architecture, formatting, and frozen-file verification are part of the final checks.

All six original desktop workflows and the new integration workflow pass on the same development build and packaged candidate: **53 development checks and 52 packaged checks**, with **36 clean desktop exits** and no renderer errors. The additional development check is the combined eight-theme/narrow-window capture. The existing delivery scripts also exercise their theme views in both runtimes. All **16 compiled files match** the candidate and all **69 frozen historical files remain unchanged**. The unused-code check retains the same nine diagnostics confined to those frozen files.

Visual inspection covers Forest, Ocean, Sand, Pine, Midnight, Charcoal, Plum, and Ember at 1600×1100, plus 1050×850 layouts. All two pages of the Word fixture, four PowerPoint slides, and four original briefing PDF pages were rendered and inspected. Office rendering used LibreOffice and Poppler; native Microsoft Office was not used. No clipping or overlap was found in these fixtures.

The tested candidate is `.test-data/connected-polish-candidate/win-unpacked/Ordo.exe`. It is a separate test package, not a new installer release.

With **55,455 indexed entries**, 50 operations, 1,000 catalog items, and 10 dirty open operation tabs, warm search p95 is **138.8 ms development / 137.9 ms packaged**, below the 200 ms target. Median is **21.2 / 21.9 ms**. The separate 1,000-definition / 2,000-placement editor opens in **129 / 149 ms** and renders 20 cards per page. Measurements use isolated fictional fixtures on this machine and exclude the search debounce.

The expanded **56,506-entry** index rebuild completes in **11.0 / 10.7 seconds** after launch. The shell appears in **1.72 / 1.33 seconds**, explicitly reports incomplete coverage during rebuilding, and typing-to-frame samples remain below 17 ms. Canonical operation and catalog hashes remain unchanged in both runtimes.

`scripts/qualify-connected-planning.cjs [packaged-executable]` runs the six original desktop acceptance scripts followed by `scripts/smoke-connected-polish.cjs`. Every run uses a separate fictional offline workspace, validates normal process exits, and checks that the compiled build does not change between deliveries. Set `ORDO_POLISH_VISUAL=1` to include the eight-theme integration captures and 1050×850 layout checks.

## Boundaries

Alternative merging, general extraction from arbitrary Office documents, graphical card payloads, cross-operation live synchronization, offline maps, simultaneous editing, and optional AI remain separately scoped. No installer publication is part of this pass. Historical documents and renderers remain immutable.
