# Ordo connected planning implementation plan

Scope for 1.0.0: search and planning cards, timeline and progress, Word export in Export Studio, and whiteboards. Spreadsheet import, delivery 3 (briefings), PowerPoint export, and inserting whiteboard snapshots into slides are deferred to a later revision. Existing briefing data stays in operations and backups. Delivery 6 (alternative plans) was retired; existing copies still open under Operations.

Historical status on 19 October 2026: deliveries 1–6 implemented and qualified, with a combined [integration polish and qualification record](connected-planning-integration-polish.md); separate major milestones remain planned. The first delivery is unified search and linked planning cards; subsequent deliveries extend those foundations into timelines, planning progress, briefings, and document exchange. See the [first delivery record](connected-planning-delivery.md), [first delivery evidence](connected-planning-evidence.json), [timeline/progress delivery record](timeline-progress-delivery.md), [briefing builder delivery record](briefing-builder-delivery.md), [Office exchange delivery record](office-exchange-delivery.md), [planning whiteboard delivery record](planning-whiteboard-delivery.md), and [alternative plans delivery record](alternative-plans-delivery.md).

The intended user experience is straightforward: find an existing fact, open its source, reuse it deliberately, and see which products depend on it. Ordo should keep its offline operation, explicit revision saves, independent reusable catalogs, and frozen publications and exports throughout these additions.

## Delivery sequence

| Delivery                                 | User outcome                                                                                       | Dependencies and boundary                                                                                                                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Search and linked planning cards      | Find planning information, reuse it in an order, and inspect where it is used.                     | Detailed below. Includes document output, history, recovery, and compatibility; those are completion requirements.                                                                                                                                                                |
| 2. Visual timeline and planning progress | View events by time and unit or staff section; identify unfinished products and responsible staff. | Reuse search targets and source navigation. Extend existing relative events, phases, responsible staff, and writing-progress indicators. Add durations, scheduling relationships, and due dates explicitly. Authoring progress remains separate from approval and task execution. |
| 3. Briefing builder                      | Assemble a briefing from selected operation information and graphics.                              | Reuse card resolution and frozen-source selection. Begin with a small template set, presentation mode, and retained PDF output. Keep slide layout separate from source content.                                                                                                   |
| 4. Office exchange                       | Produce editable DOCX orders and PPTX briefings; import tabular data through a mapping preview.    | Export from the same resolved product content. Record export provenance. An externally edited file is independent; importing changes requires explicit preview and acceptance. General document extraction comes after controlled table import.                                   |
| 5. Planning whiteboard                   | Arrange notes, shapes, symbols, connectors, and linked cards on a canvas.                          | Reuse card identities, search, graphics, and document embedding. Canvas arrangement must not silently change unit relationships or planning facts.                                                                                                                                |
| 6. Alternative plans                     | Create named alternatives from a saved baseline and compare their changes.                         | Define branching, identity remapping, and baseline provenance. Begin with independent alternatives and comparison; merging needs its own conflict-resolution design.                                                                                                              |
| Separate major milestones                | Offline maps, simultaneous editing, cross-operation synchronization, and optional AI assistance.   | Each requires a separate architecture and acceptance plan. None is a dependency of delivery 1.                                                                                                                                                                                    |

These are staged additions rather than a single release commitment. Complete each delivery's acceptance checks before broadening it. Retain the existing release qualification process and choose release numbers when integrating the work.

## Existing foundations

The current development tree already provides stable operation and entity identities, typed fact references, rich narratives, configurable product modules, relative timeline events, operation revisions, controlled reviews, retained exports, and recoverable working copies. Catalog items are edited directly and supply independent copies when consumed by operations.

Search currently exists in individual catalogs and selectors. A workspace-wide content search, reusable planning-card definition, and general card placement workflow are new work. Existing `CANONICAL_REFERENCES` modules and selected narrative references must keep their present meanings.

Relevant implementation boundaries are:

| Existing area                                                                                | Role in this delivery                                                                             |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/domain/model.ts`, `doctrine.ts`, `authoring.ts`, `modules.ts`                           | Operation facts, reference types, product ownership, stable field identities, and module schemas. |
| `src/domain/narrative.ts`                                                                    | Convert framed rich narratives into readable search text without indexing encoded payloads.       |
| `src/domain/catalog.ts`                                                                      | Saved reusable organizations, doctrines, symbols, and ORBATs.                                     |
| `src/renderer/src/ApplicationShell.tsx`, `App.tsx`, `validation-navigation.ts`               | Search entry points and navigation to the relevant editor and field.                              |
| `src/renderer/src/WorkspaceContext.tsx`, `workspace-session.ts`                              | Protection for dirty and hidden editors, pending operations, and workspace replacement.           |
| `src/application/bridge.ts`, `src/preload/index.ts`, `src/main/index.ts`                     | Narrow, validated desktop commands.                                                               |
| `src/persistence/repository.ts`, `catalog-store.ts`                                          | Saved source reads, atomic writes, additive migrations, and index maintenance.                    |
| `src/export/projection.ts`, `readable-order.ts`, `src/application/document-layout-export.ts` | Source selection, dependency tracking, explicit document content, and configured HTML output.     |
| `src/renderer/src/ReviewWorkspace.tsx`, `order-progress.ts`                                  | Existing change review and writing progress to extend without creating competing meanings.        |

Current migration registration ends at 020. Delivery 2 uses optional versioned fields in the existing operation aggregate and adds no database migration. Delivery 3 adds migration 017 for retained briefing PDFs and an optional versioned operation extension for authoring. Delivery 4 adds migration 018 for retained Office exports; spreadsheet imports use the existing operation entities. Delivery 5 adds migration 019 for immutable whiteboard snapshots and inserted-image origins, search format 3, and review renderer v9. Delivery 6 adds migration 020 for immutable alternative origins, baseline snapshots, and identity maps. Allocate the next available migration identifiers at implementation time. The working tree contains substantial development changes; establish a reproducible baseline of that actual tree before coding and preserve its existing modifications.

## First delivery user journeys

1. **Find and edit:** Open Search, enter a unit name or phrase, choose a result, and land on the matching field. A task's result displays its operation, type, and relevant context.
2. **Reuse a fact:** Find a task, choose Create linked card, select the fields to display, and insert it into an explicit Planning cards block in the base order or an authored product.
3. **Maintain a linked product:** Edit the task at its source. Every live placement in the operation reflects that draft edit; saving records the new state. Previously generated products remain unchanged and show an appropriate staleness result.
4. **Make an independent copy:** Choose Make independent copy on a card placement. The selected placement receives its own editable values and keeps a record of its origin. Other linked placements stay linked.
5. **Inspect usage:** Open Used in from a source or card. Follow an exact authored reference, inspect a card placement, or open a retained export that recorded a dependency on that source.

## Search behavior

### Scope and searchable content

Provide a visible Search action in the global shell and operation header, with Ctrl+K as the keyboard shortcut after checking existing bindings. Inside an operation, default to This operation. On a global page, default to Workspace. Remember an explicit scope choice for the session and always display it.

The first delivery searches:

- Operation names and identity fields; units, tasks, objectives, phases, timeline events, Signal narratives, radio nets, and PACE entries.
- Authored base-order fields, attachment narratives, product titles and codes, and textual content in modules, including tables and checklists.
- Saved organization identity and staff labels, doctrine titles and descriptions, saved symbol names and tags, and ORBAT names and unit labels.
- Managed-file names and descriptions. File bytes, OCR, PDF contents, and external folders are excluded.
- New card titles and independent-copy text. Linked source text resolves through the original source; it does not create an indistinguishable duplicate search result for every placement.

Workspace search covers current records. Historical revision contents, recovery copies that have not been recovered, and the complete built-in symbol dictionary remain outside this search. Keep their existing dedicated views. Search results do not instantiate unused doctrine products or include them in an order.

Filters are scope, result type, and operation; phase and responsible staff are offered where the target supports them. Display a title, readable excerpt, type, operation or catalog name, and working/saved state. Previewing a result is read-only.

### Draft and navigation rules

Maintain transient search documents for each loaded editor's applied working state, including hidden operation tabs. For an owner represented in that registry, replace its saved search documents as a group. This prevents a renamed or deleted draft item from reappearing through the saved index. Unapplied nested fields stay outside search until applied; search must never apply them implicitly.

Opening a saved result for an already open editor navigates within its working state. Re-resolve the target before navigation; show a clear unavailable/changed message if its identity no longer exists. Use existing editor protections for any action that would replace a source or discard pending fields. Searching and previewing alone must not force a save.

Register draft providers through a narrow session-owned interface. Clean up providers when an editor closes and clear every provider, query result, pending response, and navigation target after successful restore. Canceled or failed restore preserves the current session.

### Query and index design

Use deterministic lexical search. Match exact names and codes first, then title tokens and prefixes, then body text. Apply the same normalization and ranking rules to saved records and draft overlays. Preserve meaningful numbers and designations, support Unicode text, and use stable identities to break ties. Display match excerpts as escaped text.

Create a derived local search index in SQLite, scoped by workspace and source owner. Each entry carries a typed target, title, extracted text, filter metadata, source revision or edit token, and index-format version. Do not index arbitrary serialized JSON, internal hashes, credentials, or binary assets. Search is entirely local and records no query history by default.

The initial implementation spike must verify FTS5 in both the development and packaged SQLite runtime. Use FTS5 for candidate lookup when available. If it is unavailable, implement a normalized token table behind the same repository interface and require the same performance checks; do not substitute an unbounded full-database scan per keystroke. User input is literal search text, not raw MATCH or SQL syntax.

Maintain saved index entries in the same transaction as source creation, save, import, or deletion. Rebuild through bounded batches when the index format changes or entries are missing. Treat index content as disposable: restore verifies canonical records and rebuilds the index before reporting complete workspace coverage. While building, label the search as incomplete and keep current-editor search usable.

Debounce queries, bound query length to 256 characters and 16 terms, return pages of at most 50 results, and cancel or ignore superseded requests. Merge draft and saved results before pagination, excluding overridden saved owners before ranking. Counts must represent the selected scope; use More results rather than an invented total when a complete count is unavailable.

Use workspace generation, query sequence, source revision/edit token, and draft generation to reject stale results. A result from the old workspace must never open an editor after restore.

## Linked planning card behavior

### Card identities and sources

A linked card is a named view of an existing source. It does not become a second task, unit, or event. The first supported sources are units, tasks, objectives, phases, timeline events, and whole authored narrative fields. Whole-field linking avoids fragile character offsets when text changes. Signal cards, arbitrary excerpts, nested card content, and interactive diagrams can follow later.

Store operation-owned card definitions in an optional versioned `planningCards` extension of the operation aggregate. A definition contains a stable card ID, title, mode, source selector or independent payload, selected fields, and supported display options. First-release layouts are compact and detailed; do not add a general visual designer.

Define a discriminated `PlanningTarget` type with source-specific selectors. Entity sources use stable entity IDs. Base paragraphs, structured narrative fields, entries, attachments, and text modules use their actual stable paragraph/field/entry/module identities. Do not assume every paragraph key is a UUID or use array offsets, names, or CSS selectors as persistent identity.

Linked definitions resolve only within their owning operation. Search can find other operations and catalogs, but it cannot create a live cross-operation or catalog-to-operation link in this delivery. Existing organization and ORBAT import actions remain the deliberate way to bring those facts into an operation.

### Placement and editing

Add a `PLANNING_CARDS` product module with ordered placement IDs that reference card definitions. Users insert it explicitly in the base order or an authored product, and can reorder or remove its placements. Multiple placements may use one definition. Saving an operation captures definitions and placements together.

For operations without module scaffolding, the first insertion initializes only the operation-local structure needed for that block. Preserve existing paragraphs, attachments, doctrine bindings, and content; do not reset the order to another doctrine layout. Include both the original starter and the US Army Orders configuration in this acceptance case.

Use a searchable picker and an in-place preview. Expose Open source, Used in, Edit display, Make independent copy, and Remove placement with their effects stated plainly. Editing a shared card definition changes its placements; placement-specific layout choices stay local. Removing the final placement must not silently delete the definition.

Make independent copy clones the selected card's currently resolved, allowlisted values into a new definition and replaces only that placement. It does not clone an operational entity or preserve live nested links. Permit editing the copied fields. Record the original target, content hash, and source state; distinguish a saved revision from unsaved working content using its base revision and draft generation.

Keep first-release cards as explicit blocks. Inline cards inside rich paragraphs and standalone reusable card catalogs are follow-on work. Do not extend the existing rich-text frame merely to smuggle unresolved references into text fields.

### Missing sources and deletion

Before deleting a source with live card users, list the affected definitions and placements. Offer Cancel, remove the dependent cards, or convert them to independent copies using the current resolved values. Apply the selected action as one undoable draft change and retain existing protections for other source relationships. Do not save automatically.

If a reference becomes unresolved through malformed data or a configuration change, retain its identity, display a visible diagnostic, and offer source replacement or removal. Never substitute another record with a matching name or silently display an old cached value as current. Publication requires resolvable active cards in the included package; retained export generation requires resolvable selected cards. Unused definitions can remain as visible warnings without blocking unrelated products.

Cards cannot contain other cards in this delivery. Narrative sources resolve only their authored text, not an entire product or derived card block. This prevents recursive rendering. Bound counts and resolved text sizes in schemas and preview rendering.

## Used in and change impact

Build a typed reference walker shared by cards, search context, and usage inspection. Cover task assignments, unit parents, objective and phase links, relative events, Signal participants, structured authoring references, module references, card placements, and recorded catalog-consumption origins.

Distinguish three results in the interface:

| Result             | Meaning                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Current references | Explicit relationships in the selected working or saved operation. Their source fields can be opened.            |
| Independent copies | Recorded origin relationships. A later source edit does not update the copy.                                     |
| Retained products  | Exports that recorded a relevant dependency, with their existing current/outdated/superseded/unsupported status. |

Ordinary prose mentions are search matches, not verified references. Label them accordingly. Derive retained-export usage from recorded dependency manifests and supported-version adapters. Report unavailable historical coverage explicitly rather than guessing relationships from generated HTML. Unrelated source changes must not make every card or export outdated.

## Publication and document compatibility

Live preview resolves cards against the selected working operation. New saved exports resolve against one exact persisted revision or selected publication, including that source's configuration. No card resolver may reach into the current database when rendering a historical publication.

The new projection records card definition and placement identities, selected fields, rendered source values, labels, and filter membership as dependencies. When a card uses a derived value, such as a relative event's displayed time, include its actual upstream event dependencies. Independent cards depend on their copied values, not later source changes.

Apply normal product inclusion and ancestor rules. Apply applicable audience/phase restrictions to card content before output. Explain filtered cards in the preview; linking does not bypass product filters. A source product being omitted does not delete its authored narrative: an explicit link may reuse that field in another included product, subject to the chosen output filters.

Introduce a new projection and export envelope for products containing cards, with explicit dispatch and verification. Keep historical projection, renderer, review, print, and migration implementations intact. The new composition must place cards at their authored position alongside existing text, tables, graphics, headers, and footers. Do not append a global reference table or reinterpret `CANONICAL_REFERENCES`.

Extend change comparison and impact reporting through a versioned adapter so added, removed, detached, retargeted, and edited cards are visible. Approval still binds to the exact saved operation revision. A search interaction creates no revision or approval; card edits use the ordinary revision workflow.

Backup, restore, working-copy recovery, publication verification, asset ownership, and native doctrine-package validation must recognize the extension. A doctrine may define an empty Planning cards block but cannot carry operation-specific card references. Do not imply that operation package exchange already exists. Older application builds must reject incompatible new data clearly rather than discard cards.

## Implementation work packages

Execute these packages in order. Search may be delivered on its own after S2; linked cards are complete only after C3. The names below are proposed files or components, not existing implementations.

| Package                       | Work and likely location                                                                                                                                                                    | Exit condition                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 Foundation                 | Record the current baseline; inventory source selectors and incoming references; verify packaged FTS5; define limits, fixtures, target navigation, and compatibility dispatch.              | Contracts identify every supported source, document surface, and historical dispatch path. Benchmark fixtures and baseline checks are reproducible.       |
| S1 Search services            | Add domain search/target contracts and text extraction; `search-service` and a repository port; SQLite index, migration, rebuild, and invalidation; validated bridge/preload/main commands. | Saved content is searchable with deterministic ranking and correct create/edit/import/delete behavior. Index rebuild and restore isolation pass.          |
| S2 Search interface           | Add Search dialog, results, filters, preview, draft-provider registry, and typed target navigation. Integrate existing editor protection and focus behavior.                                | Find, preview, and open works for current and other operations and catalogs, including dirty hidden tabs and stale responses. Keyboard-only use succeeds. |
| C1 Card model and resolver    | Add versioned definitions, typed selectors, linked/independent resolution, incoming-usage discovery, deletion actions, persistence, undo, and recovery.                                     | Linked and independent modes behave distinctly; source rename, deletion, recovery, and round-trip storage pass.                                           |
| C2 Card authoring             | Add Planning cards module, picker, card list/inspector, placement controls, and Used in. Register the module without changing existing module semantics.                                    | A user finds an existing task, inserts it twice, opens its source, edits it, detaches one placement, and saves/reopens successfully.                      |
| C3 Products and qualification | Add projection/envelope/verification dispatch, HTML/PDF composition, staleness, review reporting, backup/restore checks, and full desktop acceptance.                                       | The complete workflow and historical compatibility pass against the exact candidate. Search and cards are then eligible for packaging.                    |

Keep domain code free of Electron, SQL, and React. SQLite indexing belongs in persistence, command validation and orchestration in application, and transient editor registration in renderer/session code. Classify new search APIs as read-only in workspace protection; index maintenance belongs to source writes or an explicit rebuild lifecycle. Reuse `ModalBackdrop` and existing keyboard/focus patterns.

## Acceptance checks

### Search correctness and usability

- A phrase inside a framed rich narrative is found as readable text. Encoded payloads and internal hashes are absent from results.
- Duplicate names in separate operations remain distinct. Renaming a source preserves its identity and navigation target.
- Editing or deleting an item in a hidden open tab replaces its saved search representation; discard restores the saved results.
- Empty queries, punctuation, literal MATCH-like input, Unicode, long text, and zero results are handled without query execution surprises.
- Search returns correct filtered pages after merging draft and saved content. Repeated queries have stable ordering within the same source generation.
- Navigation focuses the right field, preserves other drafts, and respects pending nested edits. Escape closes the dialog and restores focus.
- Failed/canceled restore retains the session. Successful restore invalidates old requests, clears overlays, and rebuilds coverage from the replacement workspace.

### Card and product integrity

- Two linked placements update from one task source. Detaching one leaves that placement independent while the other still updates.
- Changes to an unselected source field do not invalidate a card-only export; changes to a displayed field or upstream relative event do.
- Source deletion offers explicit dependent-card handling, is undoable before saving, and never redirects a reference by name.
- A published card displays the values frozen in its publication after live edits, source deletion, and restart. Existing retained HTML/PDF bytes remain unchanged.
- Product inclusion, parent inclusion, audience, and phase filters remain effective. Explicit cards print in the chosen location with no automatic extra reference tables.
- Headers, footers, page numbers, long narratives, tables, graphics, and page breaks remain readable in representative HTML/PDF output.
- Card changes appear in comparison/review output and require a new revision approval. Used in separates live references, independent origins, and historical exports.
- Save/reopen, undo/redo, unexpected-exit recovery, backup/restore, catalog deletion, and schema compatibility preserve cards and source identities.
- Old operations without cards retain their prior output and historical engine dispatch. Frozen implementation checks remain intact.

### Performance and qualification

Use an isolated fictional fixture containing 50 operations, 50,000 searchable entries, 1,000 catalog items, and 10 open operation tabs. These are initial test targets, not current capacity claims. Record hardware, runtime, fixture distribution, and index size with the measurements.

Target a warm-query p95 of at most 200 ms from dispatch to rendered first page, excluding the stated debounce interval. Typing and ordinary editing must remain responsive during query and index rebuild work. Test a separate large-operation fixture with 1,000 card definitions and 2,000 placements; use bounded or virtualized editor lists and avoid resolving an entire workspace on each keypress. Confirm or adjust the schema limits from measured behavior before qualification, documenting any change.

Initially bound each resolved card to 40,000 text characters and keep card payloads textual, including unit identity fields. Embedded symbols, ORBATs, images, and other graphical card content belong to a later extension using the existing retained graphics and managed-asset paths. Existing graphical modules continue to work beside the new card blocks.

Run focused search, card, migration, dependency, and recovery tests during implementation. At integration, run typecheck, lint/boundary checks, the full regression suite, build, and the relevant existing desktop workflows. Add an end-to-end fictional workflow covering search through frozen PDF output and normal restart. Inspect its actual UI captures and rendered PDF pages. Re-run the complete required development and packaged qualification on the exact release candidate; earlier polish evidence does not qualify new behavior.

## Risks and scope controls

| Risk                                                                     | Planned response                                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Search confuses saved and working content                                | Replace results by owner, label source state, and test hidden tabs and draft deletion explicitly.                           |
| Cards turn into a second operational database                            | Store selectors for linked cards; keep independent copies clearly separate and editable only as copied content.             |
| Existing strict schemas silently lose new content                        | Add explicit schemas and dispatch, round-trip fixtures, restore verification, and clear unsupported-version errors.         |
| Usage counts overstate actual dependencies                               | Use typed relationships and recorded manifests; separate textual mentions and incomplete historical coverage.               |
| The index delays saves or freezes the interface                          | Bound extraction and rebuild batches, measure write/query cost, and keep transient draft search independent of persistence. |
| A live lookup changes historical output                                  | Require the resolver's source snapshot as an explicit input; prohibit live repository lookups during historical rendering.  |
| The first delivery expands into a presentation or collaboration platform | Finish search, block cards, usage, and retained output before beginning the next delivery.                                  |

## References

- [Current Ordo scope](../README.md), [architecture](architecture.md), and [existing essentials and polish plan](1.0-essentials-plan.md).
- [Catalog editing and consumption snapshots](catalog-authoring-polish.md), [explicit document content](readable-order-polish.md), and [document layout](document-layout-and-interaction-polish.md).
- Design references: Onebrief's [public feature descriptions](https://www.onebrief.com/platform/features) and [search, presentation, and whiteboard update](https://www.onebrief.com/content-hub/updates-oct-2024). The implementation contracts and delivery sequence above are specific to Ordo.
