# Milestone 4 approved impact plan

Approved on 3 October 2026. Implement in the existing offline application without changing prior migrations, projections v1-v4, renderers, bundled doctrine, or historical documents.

1. Add a pure versioned semantic diff domain with typed adapters for M1 narrative, M2 structured content, and all M3 modules. Match stable identities and detect meaningful sequence moves. Suppress save metadata and derived consequences.
2. Add immutable revision UUID sidecars over the existing operation/revision composite key. Resolve explicit revision/publication endpoints to exact snapshots and configuration, with state/configuration digests.
3. Add migration 005 for revision identities, sealed Change Reviews, immutable Change Records, and append-only review events. Persist exact comparisons and impact evidence. Review decisions never save or approve operations.
4. Add OPEN/COMPLETED/SUPERSEDED/ARCHIVED lifecycle and UNREVIEWED/ACCEPTED/REJECTED/NEEDS_CHANGES/NOTED dispositions. Preserve previous decisions and comments with local attribution. Normal completion requires no unreviewed changes.
5. Compare rich document structure, text, formatting, links, and managed image bindings using deterministic block alignment; do not add IDs to historical rich text. Match table rows/columns/cells and structured collection items by UUID. Compare assets by metadata/hash only.
6. Build deterministic reference/impact chains separately from primary changes. Preserve exact historical export selection semantics and distinguish comparison effects from already-outdated artifacts. Freeze analyzed artifact inventory and impact evidence in reviews.
7. Add History / Changes, Quick Comparison, persistent review workspace, filtering, source navigation, and a dedicated versioned review report renderer. Require explicit save before controlled review creation when edits are unsaved.
8. Extend verification and backup/restore to review endpoints, sealed content, and event histories. Keep Electron isolation and strict commands. No new remote services or executable extensions.
9. Preserve all 194 tests; add M4 unit/integration tests and the 68-step desktop acceptance path. Run all four workflows in development and packaged Electron. Keep 0.3.0 until all gates succeed, then build and verify 0.4.0. Stop before M5.

Approved scope clarification: Task Organization comparison covers existing membership, parent-unit links, and metadata. Separate command/support relationships and effective timing are not modeled and will not be introduced implicitly in this milestone. No FRAGO, merge/revert, doctrine adoption, authentication, collaboration, or PDF/DOCX work.

## Implemented boundaries

`domain/diff` and `domain/reviews.ts` depend only on the domain and Zod. Hashing is injected; Node crypto lives in the persistence adapter. `ReviewService` resolves saved endpoint selectors through `ReviewRepository`, runs the explicit `diff-engine-v1` dispatcher and application impact analysis, and creates a sealed comparison in a transaction. A separate typed `ordo:reviews` bridge handles these commands; no review command calls operation save, approval, or publication. The existing guarded main-frame IPC boundary and workspace backup/restore lock also protect reviews and report saving.

Revision numbers remain human-readable per-operation counters. Migration 005 supplies immutable UUID sidecars for old and new revisions, without rewriting their JSON. A publication endpoint resolves the publication's own snapshot/configuration and the UUID of its exact source revision. Endpoints retain source kind, IDs, revision number, all three configuration pins, state/configuration SHA-256 digests, saved/published time, and labels. Cross-operation and reverse chronological comparisons are rejected.

## Frozen review and event model

`change_reviews` stores the immutable review header and comparison evidence. `change_review_changes` stores ordered immutable semantic records; the complete comparison has a canonical SHA-256 digest. The repository inserts the header and records and seals the set atomically. SQL triggers prevent resealing, mutation/deletion, or later record insertion. Composite foreign keys bind endpoints and related reviews to the same operation.

`change_review_events` stores decisions, comments, title/description edits, completion, supersession, and archival in one append-only stream. Each event has a UUID, monotonic sequence, local actor, and timestamp. Folding this stream yields the current disposition/status; it never replaces an earlier event. Expected-sequence checks reject stale UI actions. Bulk disposition changes require confirmation and commit atomically. Normal completion requires all changes to leave UNREVIEWED, including reviews whose final assessment contains NEEDS_CHANGES. Closed reviews are read-only except explicit supersession or archival. Archival hides a review from the normal selector while preserving it behind “Show archived reviews.” Supersession creates a separate replacement and links both records in one transaction.

## Comparison semantics

All pre-existing entity IDs remain authoritative. Base-order legacy narratives and structured fields have separate read paths; no content is migrated into new fields. Collections are indexed by UUID. A longest increasing subsequence identifies useful moves among common identities, suppressing index shifts after insertion/removal. Typed cells retain their raw type, row/column IDs, and readable column/row labels. Reference label changes are primary edits on their canonical entity, not module-local edits. Derived times and chart values are never injected into source change records.

Rich text is compared as a validated document tree. Bounded exact-block alignment reports text, block/list style, formatting, hyperlink URL/range, and image-binding changes. Adjacent equivalent text/link fragments normalize before comparison. There are no fabricated historical block IDs. Inline word highlighting uses bounded common-word alignment and falls back to common prefix/suffix for large text. Assets are described by managed ID, filename, and SHA-256; diff and impact analysis do not load bytes. Large identical paragraphs and a 2,000-row typed table are covered by focused tests.

The engine suppresses operation revision/save timestamps, module timestamps, storage references, key serialization order, set ordering, and the automatic approved-to-draft invalidation caused by saving an edit. Deliberate entity metadata changes remain semantic records. Doctrine/profile pin differences are configuration changes; the engine does not compare whole doctrine catalogs or adopt a new profile.

## Impact and artifact evidence

Impact analysis builds edges from actual canonical references, product relationships, typed reference fields, timeline anchors, and chart table/column bindings present at either endpoint. First-hop field constraints prevent a simultaneous metadata or unselected chart-column edit from claiming another change's effect. Endpoint output witnesses confirm that the dependent actually differs. Inherited ownership is an impact of the explicit parent override. Each impact retains its reason, dependency chain, and derived before/after display.

For every recorded export, analysis dispatches through that artifact's exact stored projection version, profile version, and resolved configuration. Only dependency paths whose values differ between the selected endpoints count as comparison effects. Baseline and target staleness are separately evaluated against the original artifact's manifest. An already-outdated artifact is labeled accordingly. Unsupported projection versions produce a frozen diagnostic, without inventing an impact or changing the artifact. Publication divergence records identify a frozen baseline; they never call it a mutable or stale publication.

The analysis freezes the artifact inventory and evidence when the review is created. Opening a historical review loads these records; it does not rerun semantic diff or update its target to the current plan. Newly created artifacts and subsequent planning changes require a new comparison/review.

## Desktop review and reporting

History / Changes exposes current/previous and publication shortcuts, arbitrary saved endpoint selectors, revision actor/status/approval/publication associations, Quick Comparison, and persisted reviews. Change cards are grouped by category and filterable by disposition, product, category, and text. The list initially renders 100 changes and history 30 revisions, with explicit expansion. Source navigation opens the current authoring item, retains review state, and is disabled for removed sources. Dirty planning or profile edits visibly block creation of controlled reviews; saved-state quick comparisons remain available.

`review-html-v1` is a dedicated deterministic report renderer. It escapes authored strings, includes exact endpoint hashes and engine/renderer/event-sequence provenance, and renders disposition/comment history and dependency explanations. The preview is sandboxed, and saved HTML has a restrictive CSP and no scripts or remote resources. Existing OPORD projectors v1-v4 and previous HTML/module renderers remain byte-identical.

## Restore and compatibility

Restore verification now resolves every frozen review endpoint, checks comparison digests and semantic fingerprints, validates source entities and impact/artifact targets, folds event histories, verifies supersession links, and checks required immutable-history protections. UUID sidecars, exact change records, actor/time information, decisions, comments, and lifecycle survive database backup/restore and restart. The actual schema-003 and schema-004 fixtures complement retained schema-001/002 migration tests.

Practical limits remain explicit: rich block alignment is deterministic and bounded rather than a document merge; history metadata is read locally, with display pagination rather than server pagination; review attribution is the existing local actor string, not authenticated identity. None of these introduce multi-user or synchronization behavior.

The retained `tests/fixtures/milestone4-review-v1.db` and companion manifest contain a completed desktop review with 21 primary records and 25 events. Regression checks verify exact comparison/event hashes and deterministic report bytes, alongside hashes of accepted diff, impact, and review-renderer semantics.
