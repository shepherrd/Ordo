# Milestone 1 architecture

## Boundaries

```text
src/domain       Zod schemas, stable IDs, invariants, factories
src/application  Commands, publication workflow, repository/runtime ports
src/validation   Declarative rule selection and explainable findings
src/export       Source projection, dependency tracking, HTML rendering
src/persistence  SQLite/Drizzle adapter and reviewed SQL migrations
src/config       Validated starter profiles; doctrine definitions are JSON data
src/demo         Clearly fictional fixtures, separate from configuration
src/main         Electron composition root, IPC, dialogs, backup/restore
src/preload      Narrow typed bridge
src/renderer     React editors, navigation, inspector, read-only previews
```

Dependencies point inward. `npm run check:boundaries` verifies that domain, application, validation, export, configuration, demo, renderer, and preload module dependencies follow the allowed layers. It parses static imports, dynamic imports, CommonJS require, re-exports, and type imports; unresolved aliases and computed module loads are rejected in protected layers. Runtime ID, clock, and actor services are injected. A future server host can reuse the same application behavior with a different repository and transport. Converting the current synchronous repository port to asynchronous remote persistence would be an explicit interface migration; it is not represented as a zero-effort database swap.

## Identity and configuration

Entities use UUIDs independently of names, titles, annex codes, or ordering. Paragraph identifiers are stable keys in the doctrine profile. Profile identity and version form a composite reference. Schema version is a distinct concept from a profile's content version.

Doctrine/configuration uses strict Zod schemas. Unknown properties, duplicate identifiers, unsupported schema versions, and invalid owner/status definitions fail validation. The starter catalog is A/B/C/H; identifiers accept additional letters and organization-specific codes. Executable validation rules and editor implementations are registered in source; configuration selects supported capabilities rather than evaluating arbitrary code.

Organizations reference default doctrine/echelon versions. New operations resolve those defaults; existing operations keep explicit pinned references. New profile versions cannot overwrite previous versions. Profile adoption, organization/echelon authoring, and profile migrations beyond schema 1 are future commands, not generic JSON writes. Personal time-display preferences are stored separately.

## Persistence and revision semantics

Migration `002.sql` adds immutable revision approvals, publication-to-approval bindings, render-template versions, and export-to-template bindings. Existing schema-1 publication/export JSON remains byte-for-byte intact; additive bindings label old embedded approval evidence as `legacy-publication`. Legacy evidence cannot authorize a new publication. Migration checksums and contiguous version lineage are verified before upgrading.

Migration `001.sql` establishes profile versions, operations, operation revisions, units, phases, objectives, tasks, events, attachments, radio nets, participant relationships, PACE plans, export-profile versions, publications, generated exports, audit events, and preferences.

The current operation header and individual current entity records are canonical planning state. References used for task assignment, hierarchy, parent units, relative events, and net participants also have relational columns and foreign keys. Typed entity payloads preserve descriptive fields and metadata. Less complex applicability arrays are schema-validated in entity payloads; these can be normalized further as query requirements develop.

One application save validates the complete aggregate, verifies the expected revision, updates current records, appends the complete revision snapshot, and records attribution in a single transaction. Complete snapshots deliberately favor correctness and reconstructability over storage optimization for this small offline milestone. They are historical records, not independent editable facts. A future revision compaction strategy must preserve publication/export references.

Cross-operation foreign keys and domain invariants reject dangling relationships. Incomplete drafts may have unassigned task fields and validation findings. Domain validation reports missing/invalid task assignments, missing purposes, nets referencing units outside task organization, and absent base-order summaries. No rule changes a plan.

Only the persistence adapter imports SQLite/Drizzle. Drizzle provides typed read mappings. Reviewed SQL owns constraints, migration checksum tracking, and immutable-history triggers. Existing migrations must not be edited after release; add migrations for subsequent schema changes.

## Publication

An OPORD publication captures the exact persisted operation revision, resolved profile versions, order identity, approval attribution/note/timestamp, and publication version. The application requires the configured workflow status, an explicit **Approve Revision** action for the exact saved revision, and no error-severity findings. Approval has its own immutable UUID, source operation/revision, actor, timestamp, note, scope, and origin. Publication references that approval ID; SQL also enforces the exact operation/revision binding. Status alone is never approval evidence. Completeness warnings remain visible but do not block this initial workflow. Local approval attribution is not authenticated identity.

The repository verifies that publication content and configuration match the referenced revision. The database forbids updates and deletes of publication content. A new publication points to the preceding publication via `supersedesId`; the older record is not mutated. Current/superseded state is derived from these relationships. WARNORD, FRAGO, and OPLAN identifiers have model extension points, while only OPORD publication is exposed in milestone 1.

Editing an approved planning state creates a new revision with the configured editing status. Publication and approval records remain unchanged. The new revision has no approval and cannot publish until separately reviewed and explicitly approved.

## Exports and deterministic staleness

An export profile separates inclusion rules from rendering rules. Inclusion selects exact units, phases, nets, fields, paragraphs, and attachments. Rendering controls product title and full/execution/quick-reference layout density. No automatic narrative summarization is performed.

`project()` produces a renderer-neutral product view and a sorted dependency manifest. Dependencies include selected source values, referenced labels, and selection membership. Tracking membership detects new records that enter a dynamic audience/phase filter. The manifest intentionally excludes source values that did not affect the product.

Generated exports retain the immutable profile version, source operation/revision and optional publication, resolved configuration, actor/time, projection version, renderer version, exact render-template ID/version, dependency manifest, and generated HTML. The repository verifies the source/profile/configuration/dependency linkage. HTML and selected historical facts are frozen artifacts; the editing UI always edits authoritative planning records.

Staleness dispatches to the artifact's recorded projection implementation, using its historical profile and resolved configuration, then compares canonical dependency values. The frozen v1 implementation is retained; v2 adds configurable Net names and ignores attachment selections that a card does not consume. Unsupported projection versions report compatibility unavailable with unknown staleness, never a false operational change. Renderer/template-only changes do not change operational staleness. This means an unrelated maintenance-note edit does not invalidate a card, while a selected channel change does. Selecting a newer export-profile version is a separate action; it does not rewrite old artifacts. Published-source exports remain historical and may be flagged as different from current planning or based on a superseded baseline.

Render templates are strict, immutable presentation entities, separate from doctrine, inclusion profiles, and the renderer implementation. Built-in OPORD and card templates are stored in SQLite. Generated HTML retains the exact template reference. No template designer is included.

Future authorization belongs in application commands and source selection before projection/rendering. Milestone 1 deliberately has no fake multi-user permission system. A host serving multiple users must implement and test that authorization boundary before deployment.

## Desktop, storage recovery, and packaging

The renderer has context isolation and sandboxing enabled, no Node integration, a restrictive CSP, and access only to specific validated IPC commands. Main-frame identity and URL are checked. New windows/navigation and remote runtime requests are blocked. All content rendered into exported HTML is escaped.

SQLite uses foreign keys, WAL, and transactional writes. Online backup uses SQLite's backup API. Restore copies the selected file to a candidate, requires the Ordo database application marker, validates migration compatibility, checks relational integrity and all historical schemas/provenance, then retains a recovery backup and replaces the active database. The tested persistence restore helper performs this sequence under a desktop workspace lock. Failed candidates do not replace current data; failure during activation reopens the prior database. Verification covers history attribution/identity, configuration, approval bindings, templates, and export dependency provenance. Recovery files are intentionally retained for manual recovery.

The Windows installer is unsigned. Code signing, platform hardening, installer update channels, encryption, and controlled-network accreditation are outside this milestone. The packaged executable is tested independently of the development server. Dependencies are pinned, including the SQLite prebuilt Node-API binary; packaging does not require Visual Studio native compilation.
