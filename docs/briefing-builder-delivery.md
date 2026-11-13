# Briefing builder

Deferred from 1.0.0. This is the original delivery record for a future revision. Existing decks, briefing PDFs, and PowerPoint files remain in the workspace and backups.

Delivery 3 of the connected planning implementation plan. Implemented and qualified on 16 October 2026. See [qualification evidence](briefing-builder-evidence.json).

## Authoring and presentation

Open an operation and choose **Briefings**. Create a briefing, edit its name and footer, and add slides. Four layouts cover title slides, text, planning cards, and graphics. Slides can be reordered, duplicated, or removed. Layout and card selections are stored separately from their source facts. Each operation supports up to 12 briefings, each with up to 40 slides; a card slide supports up to four cards.

The card picker searches existing operation facts and narrative fields. Choose the displayed fields to create a linked card or reuse an existing definition. Linked values follow the operation's working state. **Open source** navigates to the authoritative editor. **Make independent copy** detaches only the selected slide's card, preserves its origin, and exposes its copied values for editing. Removing a source uses the existing dependency decision and includes affected briefing slides. Unresolved sources remain visible and prevent export of affected slides.

Graphic slides use verified retained SVG/PNG military graphics or operation-owned imported images. Graphics retain their exact content; a later ORBAT change does not silently replace a previously selected export. The live preview uses the same deterministic slide renderer as PDF output. Long content shows a fit warning. PDF generation rejects overflow rather than retaining a clipped slide; shorten the content, select fewer fields, or split the slide.

**Present briefing** opens a full-window view of the current resolved briefing. Previous/Next, arrow keys, Page Up/Page Down, Home/End, and Escape provide navigation. Optional presenter notes remain outside the slide and PDF. Presentation captures the content at opening, and workspace replacement is protected while it is open.

## Saved sources and retained output

Save the operation revision before generating a PDF. Select an exact saved revision or publication containing the briefing. **Preview saved source** shows that frozen source, using its own configuration and graphics. It never mixes current facts with an older source. The PDF is retained before **Save PDF** writes a copy outside the workspace.

Retained records include exact HTML and PDF hashes, source revision/publication, source hash, renderer version, and rendering environment. Their history reports Current, Outdated, or Source unavailable by comparing resolved slide content. Speaker-note changes do not make the audience PDF outdated. Retained PDFs remain available after removing the editable briefing. Source/card **Used in** includes relevant retained briefings and identifies the bounded recent-history coverage.

The output is 16:9, with a consistent white page and green accent independent of the application's eight interface themes. The drafter's briefing footer and page number appear on each slide. Editable PPTX output is available through [Office exchange, delivery 4](office-exchange-delivery.md).

## Integration and compatibility

Briefings use an optional versioned extension of the revisioned operation aggregate. Older operation JSON is not populated with empty briefing data. Explicit saves, undo/redo, recoverable working copies, publications, and verified workspace backup/restore include the extension. Migration **017** adds immutable retained briefing PDFs; previous migrations and frozen renderer implementations remain unchanged. Managed image references are verified in current and historical revisions. Deleting referenced graphics or files remains protected.

Unified search indexes briefing names, slide titles, text, and presenter notes, with stable targets opening the exact slide. The derived search index format advances to 2 and rebuilds existing data. New history comparisons include briefing layout/content changes through the versioned `review-html-v8` supplement. Verification recomputes that supplement from retained endpoints; prior report engines are preserved.

The actual pre-delivery development tree is preserved in `.test-data/briefing-baseline-2026-10-16T20-48-35-271Z`, including earlier uncommitted work. The qualified application remains version 0.6.5 and the existing release directory is not replaced. The separate candidate is `.test-data/briefing-candidate/win-unpacked/Ordo.exe`.

## Qualification

- Build and TypeScript checks pass. Lint passes formatting, unused-code checks, and 1,351 architecture references. The nine pre-existing unused diagnostics are confined to frozen historical implementations.
- All **675 tests pass**, including nine briefing tests covering legacy JSON, bounds, duplicate identities, linked/independent resolution, source deletion, exact search targets, inactive layouts, image ownership, retained source verification, staleness, publication sources, revision conflicts, versioned history, backup reopening, and permanent operation deletion.
- All **69 frozen implementation hashes** match. The packaged application contains the same 17 compiled files as the qualified development build. Exact hashes, source changes relative to the actual-tree baseline, and desktop run paths are recorded in the evidence file.
- `scripts/smoke-briefings.cjs` exercises normal offline development and packaged startup with fictional isolated data. Both runtimes pass authoring, source navigation through search, presentation, real PDF generation, explicit working-copy recovery after an injected renderer failure, undo/redo, overflow rejection, backup/restore, and retained-output access after editable-briefing removal. Each final run has three normal zero-code exits and no page errors.
- The existing timeline/progress desktop regression also passes all eight groups on this build, including its 1,000-event fixture, readiness reopening, recovery, search, retained order output, and backup/restore.
- Visual inspection covers Forest, Ocean, Sand, Pine, Midnight, Charcoal, Plum, and Ember at 1600×1100, plus 1050×850 and presentation mode. Control alignment, selected-slide contrast, wrapping, and page-level horizontal overflow were checked. Preview capture allows Chromium's previously hidden iframe to repaint before taking the screenshot.
- A real four-page PDF was produced in both runtimes. All four layouts were rendered to PNG and inspected. Every page measures 960×540 points, graphics remain embedded, and presenter notes are absent. Retained PDF bytes survive backup/restore unchanged.

Early development/test-harness failures are excluded from qualification and listed in the evidence record. These included a title-layout overflow corrected before the final build, an ambiguous presenter-note locator, and an unsupported animation-frame wait inside the script-disabled preview. A separate read-only theme probe confirmed the later blank capture was a repaint timing issue; the final harness waits for that repaint.
