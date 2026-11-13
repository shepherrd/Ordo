# Document reference-table polish — 9 October 2026

The user reported that automatically printed “Linked facts” tables repeated information already written in the document and exposed mechanical data. The 0.6.5 development build now omits those implicit reference tables from current OPORD previews and newly generated HTML/PDF exports.

## Behavior

- Narrative fields, structured-entry prose, and annex content print the author's content without automatically appending “Linked facts” or “Authoritative references” tables.
- Key tasks, subordinate tasks and purposes, Task Organization, Signal tables, and explicitly authored modules/tables remain. Content is selected by its structured meaning, never by matching a heading string. An author can still deliberately name a section “Linked facts.”
- Reference selections remain stored. Existing dependency and staleness semantics remain intact; omitting a table does not detach the linked data or edit narrative text.
- New exports from a publication use its frozen operation and configuration. Previously retained exports and their PDF adaptations remain unchanged.

## Implementation and compatibility

`projectReadableOrder` adapts only presentation on an in-memory copy. It keeps the original projection's dependencies and never saves the presentation copy. New affected exports use the `html-v5` envelope; unaffected exports retain their existing renderer dispatch. Both synchronous and asynchronous generation use the same preparation/retention path. Graphical orders retain and verify their exact SVGs and manifests.

Additive migration **013** extends the export insertion guard for this envelope. Migrations 001–012 remain byte-identical. Projection versions 1–5, historical review engines, and the prior narrative renderer/generator/verifier remain unchanged. This is not a new operation model or a change to library lifecycles.

## Verification

- Build and typecheck passed; architecture boundaries passed (927 module references).
- Full regression suite: **586 tests across 30 files passed**. Six new cases cover base/annex previews, explicit content preservation, synchronous/rich export paths, graphical retention, publication sources, linked-data staleness, corruption rejection, schema-12 migration, and backup/restore.
- 69 frozen implementation hashes plus migration 012 and the three prior narrative implementation hashes matched their baselines.
- The focused desktop workflow passed all four checks in a new fictional workspace: live preview, retained HTML and references, retained PDF generation, and normal offline exit/reopen. The current compiled file hashes and timestamped process milestones are retained in the desktop manifest.
- Inspected the actual Electron preview and the single-page PDF rendered with Poppler. Narrative remains legible and unclipped, with no appended reference table. Existing provenance footers remain outside this change.
- The initial full test run had four obsolete renderer/schema assertions; these were updated without removing behavioral checks. The first desktop run generated its export but failed an exact toast-text locator. Its failed manifest remains separate; a fresh run passed after waiting for the generated-document control instead.

See [evidence](readable-order-polish-evidence.json). This is development polish, not packaged qualification. The retained installer, version number, and personal workspace are untouched.
