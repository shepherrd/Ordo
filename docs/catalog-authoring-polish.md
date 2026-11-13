# Catalog and authoring polish — 8 October 2026

The user's “Perfect. Begin work on everything” approved the recorded polish requests. Implemented in the development workspace at **0.6.5**. This is not a new installer, a 1.0 qualification, or Milestone 7 work.

## Editing behavior

- Doctrines, Organizations, Saved Symbols and Saved ORBATs use create, edit, save, duplicate and permanent delete. Their active catalogs no longer maintain a user-managed draft/publish/retire/version lifecycle. Obsolete actions, status filters, version labels and version-management pages have been removed from these editors.
- Doctrine has General, Structure, Products / Modules and Staff pages. Creation notes and the Validation, Preview and Versions pages are removed. Staff names are drafter-defined; initial and new roles can be renamed and removed. Removing a role clears its current doctrine assignments and current organization mappings, preserving earlier operational snapshots.
- Organizations have Identity, Symbol, Structure, Staff, Defaults and Assets pages. Description and notes have larger, full-width rich editors. Insignia appears in catalog rows. “Person filling this role” is beside the position's identity fields; additional personnel details remain optional.
- Symbol echelon/mobility has named choices, including Division. Legacy ground-unit echelon has a named selector. Symbol-set changes show a visible confirmation before clearing incompatible components. Organization symbol selection and the ORBAT symbol tray accept saved symbols directly.
- Schema and reference validation remains mandatory on save and during backup/restore verification. Errors identify the affected field in the editor. No separate validation page is required.
- Narrative fields default to rich text, including base-order paragraphs, attachment narratives, task purposes, descriptions, guidance, matrix cells and new review notes. Names, designations, IDs, codes, dates and other compact typed fields remain plain controls. Existing historical review formats retain their plain-note contract.

Permanent deletion defaults to Cancel and explains that removal cannot be undone. Removing a reusable item deletes its active catalog record. Operations and exports keep the independent copies they already consumed; the confirmation states this. Current standing-organization and default-doctrine relationships must first be removed. Original import evidence remains protected.

## Data and historical compatibility

Additive migration **012** introduces typed mutable catalog records, edit-conflict tokens, original-source references, conversion receipts, asset ownership and consumption-snapshot bindings. Migrations 001–011 and all 69 retained implementations/resources in `tests/fixtures/deletion-frozen-implementations.json` are unchanged.

Every existing library record is converted individually using its existing ID. Multiple earlier versions remain separate editable items; none is silently chosen, combined or discarded. A save replaces the current catalog content. It does not append a catalog version. Conflict tokens prevent a stale editor from replacing newer changes.

Historical tables and compatibility readers remain because existing operations, publications, import receipts and exports depend on their exact identities and bytes. Exact copies are materialized only when content is consumed—for example when creating an operation, choosing a symbol or generating an export. Existing renderer identities, including explicitly selected spacing profiles, remain intact. This retained compatibility layer is not an active publishing workflow for library items.

Recoverable library edits are converted only when their saved source matches exactly. The unsaved edits remain separate from the saved item. Unmatched recovery copies are retained without being applied to another source. Deletion receipts prevent a removed catalog item from reappearing during a later launch.

Rich narratives use an explicitly framed, schema-validated document in existing narrative slots. Plain text retains its original bytes until edited. New formatted order output uses `html-v4`; new formatted reviews use `review-html-v4` through separate adapters. Earlier projections, comparison/impact engines and report renderers are untouched. Retained exports include exact source dependencies and output hashes. Graphics staleness still depends only on consumed fields.

## Verification

The full suite passes **580 tests across 29 files**. Type checking, the development build, architectural import boundaries and the 69 frozen-file hashes pass.

`scripts/smoke-catalog-polish.cjs` passes **13 desktop checks** against the actual compiled Electron app in an isolated fictional workspace with no diagnostic startup flags. They cover named numeric/legacy echelon selection, symbol-set changes, symbol picking, staff edits and inline errors, rich descriptions, insignia, independent operation snapshots, adding a child from the ORBAT symbol tray, ORBAT import without publishing, native dependency exchange, reference import, retained HTML/PDF generation, permanent-deletion cancel/confirm, backup/restore, creating and editing a doctrine after deleting every catalog entry, offline operation and normal clean exit/reopen. The lifecycle timeout remains 60 seconds.

An isolated copy of the saved personal workspace converted nine existing library records (three doctrines, two organizations, three symbols and one ORBAT). All **48 existing data tables** remained byte-equivalent at the row-data level. Operation Testify remained present with its original saved revision. The personal database was not opened or migrated by this verification.

Evidence paths and exact final compiled fingerprints are recorded in `catalog-authoring-polish-evidence.json`. Earlier failed/intermediate checks remain separate and do not qualify this final build.

## Using this development build

From `C:\Ordo APP DEV`, run `npm start` to open the compiled development build. Save and close an older Ordo window before switching builds. The first normal launch of this build applies migration 012 to that selected workspace. Use this build with the upgraded database; the retained 0.6.5 installer predates this migration and these editing changes.

The existing backups, earlier installers and acceptance records remain intact. Packaging and final release qualification have not been performed for this polish pass. Unsupported reference conversions and the existing provenance limitations are unchanged.
