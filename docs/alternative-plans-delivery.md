# Alternative plans

This delivery record describes the former Alternative plans feature. Existing alternatives are still available to open and edit in **Operations**. New alternatives and plan comparisons are no longer offered.

Delivery 6 was originally implemented on 19 October 2026. Historical qualification details are in [the evidence record](alternative-plans-evidence.json).

## Workflow

Enter an alternative name and select a saved baseline revision. Creating an alternative is an atomic workspace action: it creates a new operation at revision 1, with an independent draft and normal editing, Undo/Redo, saving, recovery, search, validation, approval, publication, and export workflows. Save or discard pending operation edits before creating it. The original operation and other alternatives are unchanged.

The copy includes the order, structured authoring and product modules, units and relationships, objectives, tasks, phases, event scheduling, Signal information, staff assignments, document header/footer, linked cards, briefings, whiteboards, and attached managed files. It starts with draft operation status and cleared planning-readiness marks; due dates remain. Approvals, publications, reviews, working-copy recovery records, and retained export/snapshot histories are not inherited. Export profiles start with valid defaults, since their current settings are not part of historical operation revisions.

Select **Open alternative** to edit the copy. An alternative can itself be the source of another alternative. Its page identifies its immediate source operation and saved revision. Returning from another open operation refreshes the alternatives list; **Refresh alternatives** also reloads it explicitly.

## Comparison

Compare any saved revision of an alternative with its frozen starting baseline, or with a saved revision of another alternative created from exactly that same baseline. Different source operations or baseline revisions cannot be compared as siblings in this delivery. The original baseline is retained even after its source operation is deleted.

The comparison reports added, removed, changed, and reordered records, with Before/After values, readable record names, category filters, and pages of 50 changes. It includes every operation authoring extension, including scheduling, planning cards, briefs, whiteboards, ORBAT layout, and document settings. Copied identities map back to their source identities for comparison: editing a copied task is a task change rather than a removal and unrelated addition. Newly created records remain distinct even if their names match.

Operation names and save bookkeeping are excluded. Unit/task/product names remain comparable. The frozen baseline is normalized through the initial draft/readiness reset, so a newly created alternative has no authored changes. Comparisons always use explicitly selected saved revisions, including when another tab contains unsaved edits. Comparison is read-only. Merging, selecting a winning plan, cross-operation live synchronization, and conflict resolution remain separate work.

## Identity, resources, and provenance

New operation, order, Signal, entity, product-content, operation-local module/field, card/placement, briefing/slide, board/item/connector, asset, and ORBAT-layout identities are allocated together. Typed internal references and reference-valued fields are remapped consistently. Ordinary text is never rewritten merely because it matches an identifier. Doctrine keys and pinned organization/staff/catalog identities remain unchanged. Independent-card historical origins and unit import provenance remain historical evidence of their original sources.

Referenced managed-file metadata and bytes are copied to new operation-owned asset identities. Existing immutable saved graphic exports and catalog snapshots remain pinned resources, without following later source edits. Their existing deletion protections still apply: deleting a source operation that owns a graphic referenced by another plan can be blocked until those historical dependencies are addressed. The alternative baseline record alone does not block deleting its source.

Migration **020** adds immutable `alternative_plans` records containing the original operation/configuration snapshot, source operation and revision, creation actor/time, baseline hash, initial name, and complete identity map. Backup verification checks the baseline hash, pinned configuration, unique identity mapping, and exact reconstruction of alternative revision 1. Creation, asset copies, revision history, search indexing, provenance, and default export profiles commit or roll back together. Permanent alternative deletion uses the existing confirmation and deletion gate. Older operations retain their existing domain shape and historical render dispatch.

## Qualification

The automated tests cover both built-in doctrines, remapped links and typed references, text preservation, saved ORBAT and organization/staff pins, baseline/sibling comparison, independent edits, older baselines, rollback, stale requests, immutable origins, managed bytes, baseline deletion, backup/restart, alternative deletion, and paginated comparison of 1,000 changed tasks. The full regression suite includes historical database upgrades and frozen implementation checks.

The normal offline desktop workflow covers creating two alternatives, editing/undo/redo/saving, hidden-tab drafts, sibling comparison, crash recovery, copied whiteboards, retained source output, backup/restore, all eight interface themes, narrow layout, and the 1,000-task fixture. Development and packaged candidate tests are recorded against the exact compiled files, with the existing whiteboard/document workflow rerun on the packaged candidate.

The test candidate is `.test-data/alternatives-candidate/win-unpacked/Ordo.exe`. The retained 0.6.5 release is unchanged. This completes the six connected-planning deliveries in the development tree; release integration and the separately scoped major milestones remain distinct decisions.
