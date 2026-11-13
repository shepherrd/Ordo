# Milestone 5 architecture

The approved scope is a persistent offline global workspace, reusable versioned Unit Profiles, operation-owned unit instantiation, and deterministic organization-aware staff resolution. The application remains a single-planner Electron app. Milestone 6 symbols, ORBATs, portability, synchronization, adoption, accounts, and new order lifecycles are excluded.

## Application and navigation

`ApplicationShell` owns global location and explicitly opens an operation. Normal startup is Dashboard, regardless of the last operation preference. The existing operation editor is retained in `App`; global visits hide it without unmounting, saving, or replacing its draft. Opening a different operation uses the existing revision-guarded save path. Doctrine Builder and Organization Workspace have separate draft state and retain it across global visits. Global preferences reuse the existing preferences record; last-opened operation is UI state, not planning state.

Dashboard and Operations summaries are SQL projections of scalar metadata. They do not hydrate historical operations, doctrine catalogs, full reviews, rich content, or image blobs. Organization and operation browsers use bounded result pages. Review cards and counts derive from lifecycle events, without loading semantic change records. This is a local summary read model, not a separate audit system.

## Configuration boundaries

The existing `organizationRef`, `organizationSchema`, and `ResolvedConfig.organization` retain their original doctrine-configuration meaning. They are not renamed, aliased, migrated, or inferred into the new model. Unit Profiles use `unitProfileFamilyId`, `unitProfileVersionId`, and `operationOrganizationBinding` throughout.

A Unit Profile is a strictly validated schema-versioned document. A family is the reusable profile identity; each version has a separate UUID and version label. Draft content counters guard stale edits. Published documents and hashes are immutable. Retirement is a separate append-only record, preserving the original document and content hash. New versions retain continuing staff and relationship IDs; duplication into a new family remaps internal IDs and records its source.

Sections, positions, identity metadata, exact doctrine recommendations, explicit role mappings, and standing child references live in the validated document. SQLite indexes identity/lifecycle and exact standing relationships for foreign keys and browsing; the indexes are checked against their document source. Array order is deliberate display order. Position identity is separate from informational incumbent metadata.

Standing relationships are reusable parent/subordinate template relationships, with exact child versions. Validation rejects duplicate children, self-parent relationships, and transitive family cycles across versions. These are not operational command/support/effective-time relationships. Existing retired child references remain readable.

## Operation ownership and provenance

An optional organization binding freezes the selected family/version/hash, version label, resolved identity, staff configuration, role-adapter version, and resolved doctrine-to-role mappings. Staff resolution and historical rendering consume this saved state, without consulting a current global profile. The source version is retained as provenance and is verified during save/restore. Generic planning saves cannot add, replace, remove, or modify the binding. Legacy operations stay unbound.

Organization default doctrine is a creation-time recommendation. It is not copied into a live operation dependency. The planner independently selects an exact valid doctrine version. Initializing Task Organization is an explicit option, independent of selecting an organization.

Import creates existing canonical operation units with independent UUIDs, operation-owned parent links, editable identity metadata, and immutable source provenance. Unit `name` is the canonical operational designation; profile identity details do not contain a second editable designation. Provenance records source family/version/hash, import UUID, and source relationship path. Repeated submissions with the same import UUID are idempotent. Reuse of a profile family warns and requires deliberate confirmation; it is allowed to create additional independent instances. There is no synchronization or automatic profile adoption.

## Staff resolution

`staff-roles-v1` explicitly maps known bundled doctrine identities and staff IDs to functional roles. Custom doctrine roles use explicit profile mappings pinned to exact doctrine versions. Titles and display order never infer roles. Resolution uses the sole matching position or an explicitly designated default. Multiple candidates without a default yield ambiguity; no candidate yields a missing-position warning.

Existing doctrine owner IDs, inheritance, and legacy overrides remain intact. Typed operation overrides bind a product to a position/section/functional role in the operation's pinned organization. Restoring default removes the operational override and resumes the deterministic inherited/default path. Incumbent names do not determine assignment. No-organization operations use the original ownership behavior.

## Migration and assets

Migration 006 adds Unit Profile families, versions, retirement records, standing relationship indexes, and immutable revision pin indexes. Migrations 001–005 remain byte-identical. Migration registration now explicitly assigns each migration its own immutability tables rather than assuming every later migration adds review tables.

The existing asset ownership CHECK only permitted operation or doctrine ownership. Migration 006 transactionally rebuilds the same managed-assets table with an additional Unit Profile version owner. Existing asset documents, owners, IDs, and bytes are copied unchanged. Before applying the migration, source metadata, MIME signatures, lengths, and SHA-256 values are verified. Before committing, row count, identities, owners, exact JSON, actual blob equality, and required triggers are compared. Failure rolls back the migration.

Organization images use the same file validation, byte storage, hash verification, preview/save commands, and backup mechanism as prior managed assets. Profile documents reference an asset ID, never embedded bytes. Derived versions use independently owned managed asset identities, following the existing doctrine asset lifecycle. No second storage subsystem exists.

## Comparison, publication, and exports

Historical `diff-engine-v1`, `impact-v1`, and `review-html-v1` implementations stay byte-identical. V2 comparisons reuse v1 behavior for the pre-existing fields and add organization binding, operational unit identity/provenance, and typed staff overrides. V2 fingerprints identify the semantics explicitly. The impact adapter adds actual effective-position changes and ties them to the relevant product/ancestor ownership sources. Frozen reviews are read from stored records, never recomputed on opening.

New review endpoints carry exact organization provenance where present. Organization-aware reviews use `review-html-v2`; renderer dispatch preserves historical report bytes. Engine, impact, and report versions must agree. Global profile edits alone do not create an operation change.

No OPORD projection v5 is introduced. Projectors v1–v4 and accepted order/module renderers remain unchanged. Existing exports consume their original dependencies; an organization-only staff override does not stale an artifact that never consumed that field. Publications already freeze the complete operation snapshot, which now includes the optional organization binding and typed overrides.

## Restore and security

Restore verifies profile schema/hash/lifecycle, ancestry, staff mappings, hierarchy indexes, assets, exact operation snapshots and pins, unit provenance, and immutable-history triggers alongside all previous checks. It preserves the existing verified-candidate and recovery-backup procedure.

The new `ordo:workspace` bridge is typed and strictly validated, guarded by the same trusted main-frame identity, offline policy, sandbox, context isolation, CSP, and workspace lock. File dialogs remain main-process owned. Profile and operation hashes are computed and verified in persistence; renderer-provided source snapshots are not trusted.

## Delivery gates

Preserve all 303 original tests and historical hash guards, add M5 tests and a separate `smoke:milestone5` workflow, and run all five development and packaged workflows. Keep 0.4.0 through candidate gates. Only then build and verify 0.5.0. Final evidence and the 82-step acceptance mapping belong in the completion report. Stop before Milestone 6.

The future integration contract is stable Unit Profile family/version identities, canonical operation unit UUIDs, exact source provenance, and a separate Task Organization import action boundary. No speculative symbol or ORBAT schema is introduced.
