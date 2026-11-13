# Milestone 2 Completion Report

Verified 1 October 2026 · Ordo 0.2.0 · Windows x64

## 1. Final status

**COMPLETE.** Doctrine and Orders Authoring is implemented in the existing offline desktop app. All 135 automated tests pass. Both development and packaged Windows runs pass all 13 Milestone 1 checks and all 20 Milestone 2 acceptance steps, with zero renderer errors. No Milestone 3 work has started.

## 2. Repository changes

Added the separately versioned US Army Orders catalog, strict doctrine/authoring schemas, operation applicability, migration 003, a collapsible searchable doctrine tree, editor registration, typed product editors, structured base authoring, Package Composer, projection v3, and regression/desktop acceptance coverage. Updated the README and package version to 0.2.0. Existing architecture, canonical entities, approval/publication controls, and recovery workflow remain in use. Work is in the current workspace; no commit or PR was created.

## 3. Doctrine schema

Doctrine schema 2 adds a typed catalog with immutable UUID identities, permanent stable keys, display codes/titles, hierarchy, aliases, source provenance, source references, spare status, formats, ownership, applicability recommendations, capability hints, and extension metadata. Citation objects retain publication title/identifier, edition date, change number/date, locator, and URL. Profile entity version **1** and content version **1.0.0** are separate from schema version **2**. The original schema-1 profile remains unchanged.

## 4. Seeded doctrine catalog summary

`us-army-orders` contains **185 nodes: 26 annexes, 82 appendices, 73 tabs, and 4 exhibits**. It implements the supplied A–Z hierarchy, including B’s seven appendices, C’s decision-support products, F1C1 exhibit depth, H’s five appendices and 25 tabs, Q’s five appendices, and the special A/R/Z formats. It does not invent fixed children for annexes that have none in the supplied catalog.

The baseline is FM 5-0, _Planning and Orders Production_, 4 November 2024, with Change 1 of 8 August 2025. Source checking was limited to this supplied catalog. The official reference and detailed provenance decisions are recorded in [Milestone 2 architecture](milestone2-architecture.md).

## 5. Variant/provenance behavior

Table D-2 remains the canonical structural source. D7 is a distinct sample-format addition; J1 Guidance and Running Estimate are mutually exclusive active alternatives; M/S children are sample-derived; Q3’s sample title is a separately sourced alias. F2’s printed duplication is recorded without creating a duplicate node. O/T/X/Y remain reserved spares.

Source verification found two wording differences: Table D-2 abbreviates I1 and I7 as **AMD Execution Matrix** and **AMD Communications Architecture**. The supplied expanded titles are retained; printed wording is recorded in aliases/source notes. No hierarchy was improvised. Editor choices are marked as Ordo defaults rather than universal doctrine.

## 6. Authoring/editor architecture

Domain and application layers remain independent of Electron, React, and SQLite. Repository ports continue to isolate persistence. Doctrine capability hints are mapped to UI implementations by a renderer registry with 11 registered capabilities. Unsupported hints receive a Generic fallback and an explainable finding.

Implemented Matrix, Checklist, Generic, Report Catalog, Distribution List, and narrative/five-paragraph content. Collection and graphic-reference views use the generic framework. Annex A reuses the canonical unit editor; H and H4A reuse the authoritative Signal editor. Product references bind to existing units, tasks/purposes, objectives, phases, events/H-hour, nets, and PACE records. Catalog browsing creates no planning documents.

## 7. Base OPORD authoring changes

The new profile defines 22 base fields/group nodes. Execution follows the approved structure: an Intent group with narrative Purpose, canonical Key Task selection, structured End State fields, narrative Concept with references, a read-only view of authoritative Task/Purpose assignments, and Coordinating Instructions with references. Situation, Mission, Sustainment, and Command and Signal provide meaningful headings and guidance. Mission retains Who/What/When/Where/Why guidance.

Legacy operations retain their original five summaries, editing path, and projection semantics. They are neither split nor copied into the new structure. New authoring and all attachment views have read-only HTML previews.

## 8. Package Composer behavior

Composer shows the base order and catalog hierarchy with Included/Omitted/Undecided/Spare, effective owner, workflow, findings, and substantive-content indicators. Filters cover All, Included, Omitted, Undecided, Spare, Has Issues, and By Owner.

Only explicitly included products with included ancestors enter the package preview. An included child under an undecided ancestor is flagged and excluded until its ancestors are included. Omitted ancestors with included children are rejected. Reset preserves authored content. Parent owner changes flow to inherited children. Applicability and ownership changes are operation state and participate in revisions; they never alter source doctrine.

Publication remains a separate action. It freezes the exact saved revision’s package and authoring state after explicit revision approval. Later composition changes leave publications unchanged. V3 OPORD export profiles support the live included package or a selected subset; historical exports keep their recorded projection implementation and exact profile version/dependencies.

## 9. Validation rules

Strict schemas and explainable findings cover duplicate stable identities, duplicate sibling codes, invalid type hierarchy, missing parents/cross-references, unknown source classes, spare repurposing without an explicit override, invalid active alternatives, unsupported editor hints, invalid canonical references, malformed typed content, mismatched doctrine bindings, and invalid applicability. Unknown JSON fields are rejected. Missing content and unresolved ancestor inclusion produce warnings without modifying the plan. Existing Milestone 1 consistency rules remain active.

## 10. Database migrations

Added **003.sql** only. It introduces an immutable version-scoped doctrine-node index with profile/parent foreign keys, nullable doctrine-node/applicability columns on current attachments, uniqueness of operation/node instances, and insert/update binding checks. Typed content remains in validated entity payloads; base authoring remains in the operation header. Existing snapshots are not rewritten.

Migrations 001/002 and projection v1/v2 files match their original SHA-256 hashes byte-for-byte. Restore checks include doctrine-index/profile agreement, operation bindings, required triggers, historical schemas, and existing export/publication provenance.

## 11. Exact test commands/results

Commands were run from `C:\Ordo APP DEV` using `npm.cmd` in PowerShell.

| Command                                      | Result                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                      | PASS                                                                                           |
| `npm.cmd run lint`                           | PASS; formatting and 72 module-boundary references checked                                     |
| `npm.cmd test`                               | PASS; 135 tests in 5 files, including all 75 Milestone 1 tests                                 |
| `npm.cmd run dist`                           | PASS; renderer/main/preload build and Windows NSIS packaging                                   |
| `npm.cmd run smoke`                          | PASS; 13 Milestone 1 checks, 0 renderer errors                                                 |
| `npm.cmd run smoke:milestone2`               | PASS; 20 steps, 0 renderer errors                                                              |
| `npm.cmd run smoke -- --packaged`            | PASS; 13 Milestone 1 checks, 0 renderer errors                                                 |
| `npm.cmd run smoke:milestone2 -- --packaged` | PASS; 20 steps, 0 renderer errors; runtime confirms packaged 0.2.0, win32/x64, Electron 44.5.1 |

The two initial acceptance harness issues were an old unit-field label and a schema-001 fixture copying newly added columns. Both were corrected without removing behavioral assertions. The build reports upstream Zod comment-annotation notices; compilation and packaging succeed.

Evidence directories, each containing `acceptance.json`, screenshots, and final state:

- M1 development: `.test-data/smoke-68970e9f-0ec4-460a-b2a8-5614290a33fe`
- M2 development: `.test-data/milestone2-smoke-f2ff7f1b-78dc-4891-ab69-4ecb223e1fe0`
- M1 packaged: `.test-data/smoke-0afecc6a-3361-4d40-848f-53435e236e4b`
- M2 packaged: `.test-data/milestone2-smoke-6249ed78-c01b-49bd-9185-1f8579483f10`

## 12. Packaged application result

**PASS.** The packaged executable was tested offline with real Electron, SQLite, IPC, restart, approval, publication, export generation, backup, and restore.

- Installer: `release/Ordo Setup 0.2.0.exe` — **122,337,487 bytes**.
- Installer SHA-256: `562DD51FDDFC85DD0962E2E5EFCC9671CE36197D649B5B80B2609FB90E1C267E`.
- Application: `release/win-unpacked/Ordo.exe` — **245,726,208 bytes**; retain the entire `win-unpacked` directory.
- Executable SHA-256: `6E5FE592355188B095C4B2A183E18D5450F76EF8FB9C48677EA533BA912EE9A2`.

The installer is unsigned. NSIS generation and the packaged executable were verified; installation/uninstallation wizard interaction was not exercised. The original 0.1.1 installer remains intact.

## 13. Acceptance scenario PASS/FAIL by step

Every row passed in both development and the final packaged Windows app.

| Step | Acceptance demonstration                                                                                                   | Result |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1    | Fresh fictional brigade with new profile and structured base/Execution authoring                                           | PASS   |
| 2    | A–Z doctrine tree, without mass document instantiation                                                                     | PASS   |
| 3    | O/T/X/Y visible and protected as spares                                                                                    | PASS   |
| 4    | Annex A canonical unit editing and preview                                                                                 | PASS   |
| 5    | B’s seven appendices and B1’s four tabs; generic authoring                                                                 | PASS   |
| 6    | C3 matrix, decision-support matrix, and checklist paths                                                                    | PASS   |
| 7    | Canonical D1–D6 distinguished from sample D7                                                                               | PASS   |
| 8    | F1C1 Exhibit-level hierarchy and persisted content                                                                         | PASS   |
| 9    | H’s five appendices and all supplied tabs                                                                                  | PASS   |
| 10   | H4A, Signal workspace, and live card share authoritative data                                                              | PASS   |
| 11   | J1 alternatives distinguished; simultaneous activity rejected                                                              | PASS   |
| 12   | M’s three appendices labeled as sample-format records                                                                      | PASS   |
| 13   | Q’s five appendices and Q3’s sourced alias                                                                                 | PASS   |
| 14   | R report catalog with unit/event references                                                                                | PASS   |
| 15   | Z distribution list with unit references and acknowledgment fields                                                         | PASS   |
| 16   | Applicability and authoring survive real save/restart; revision history verified by integration tests                      | PASS   |
| 17   | Omitted-parent/included-child conflict rejected without changing saved state                                               | PASS   |
| 18   | Composer states, ownership, workflow, content, findings, and all requested filters                                         | PASS   |
| 19   | Package preview includes applicable products and excludes omitted/undecided products                                       | PASS   |
| 20   | Card staleness, exact approval, frozen publication package, and validated backup/restore; original M1 workflow also passes | PASS   |

## 14. Backward compatibility result

**PASS.** Schema-001 and schema-002 upgrade tests preserve historical content and profile pins. Original migration/projection hashes are checked in automated tests. Existing M1 publications and exports remain readable with their original semantics; M1 base narratives stay unchanged. A read-only comparison against the original M1 acceptance database confirms the starter doctrine matches exactly; that original database still has migrations 001/002, one publication, and three exports. Evidence: `.test-data/milestone2-baseline/original-m1-profile-verification.json`.

The M1 closure fixture now excludes the two new nullable columns when constructing an old schema and expects migration lineage 1/2/3. All 75 original tests and the unchanged 13-check Electron workflow continue to pass.

## 15. Known limitations

This is an unsigned offline single-planner development release. Specialized matrices, checklists, and generic products provide typed authoring and references, not automated specialist planning. Graphic products store reference notes; they do not render or edit maps. Optional doctrine descriptions remain sparse. Profile/organization overrides require a new validated dataset; there is no profile designer or adoption UI. Warnings about missing content remain visible but do not block approval. Upgraded schema-003 workspaces require this app version or later; use retained backups with older app versions.

## 16. Deferred Milestone 3+ work

WARNORD/FRAGO lifecycles, formal MDMP, GIS/symbology, shared editing/synchronization, authenticated identity/permissions, classification enforcement, PDF/DOCX, tactical AI generation, automatic doctrine updates, and a graphical profile designer remain deferred. None was started.

## 17. Important files/modules

| File                                                          | Role                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/domain/doctrine.ts`                                      | Strict catalog, citations, capabilities, and typed content schemas                     |
| `src/domain/authoring.ts`                                     | Lazy instances, applicability, ownership, canonical references, package rows, findings |
| `src/config/us-army-orders.json`                              | New supplied A–Z dataset                                                               |
| `src/config/doctrine.json`                                    | Unchanged M1 starter                                                                   |
| `src/application/service.ts`, `ports.ts`                      | Explicit configuration selection and repository boundary                               |
| `src/persistence/migrations/003.sql`, `repository.ts`         | Additive persistence and restore verification                                          |
| `src/renderer/src/editorRegistry.ts`, `DoctrineWorkspace.tsx` | Capability registration, tree, inspector, typed editors, base authoring, Composer      |
| `src/export/projections/v3.ts`, `projection.ts`               | New semantics with historical dispatch retained                                        |
| `tests/milestone2.test.ts`, `milestone2-persistence.test.ts`  | 60 additional regression tests                                                         |
| `scripts/smoke-milestone2.cjs`                                | 20-step real Electron acceptance, development or packaged                              |
| `docs/milestone2-architecture.md`                             | Decisions, source provenance, compatibility and data model                             |

## 18. Recommended next milestone

Recommend **revision comparison and controlled change review** over the existing immutable planning and publication history. Define and approve that scope before starting it or introducing WARNORD/FRAGO/MDMP workflows. This is a recommendation only. Milestone 2 work stops here.
