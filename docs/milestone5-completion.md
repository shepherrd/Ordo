# MILESTONE 5 COMPLETION REPORT

## 1. Final status

**COMPLETE — Ordo 0.5.0.** All 373 automated tests, all five development workflows, all five packaged candidate workflows, and all five final packaged workflows pass. All 82 M5 acceptance steps pass. The version advanced only after the 0.4.0 candidate gates. Milestone 6 has not begun.

## 2. Repository changes

Added a global application shell, a repository-backed workspace service, typed Unit Profile domain and persistence, organization-aware staff resolution, additive migration 006, and explicit v2 comparison/impact/review rendering. Added two M5 test files and a separate desktop acceptance script. Retained earlier workflows with a shared navigation adapter for the new global shell. No dependency additions and no Milestone 6 implementation.

## 3. Global application-shell architecture

`ApplicationShell` owns global location and explicit operation entry. It composes Dashboard, Operations, Organizations, Doctrines, Library, and Settings. The operation editor stays in `App`. The domain imports neither Electron nor React nor SQL; application services use repository ports. SQLite owns storage and integrity checks.

## 4. Dashboard behavior

Normal startup is Dashboard, even when a last-opened operation exists. It provides recent operation activity, publications, open reviews, organization/doctrine summaries, and creation actions. SQL summaries select scalar metadata and lifecycle counts. Dashboard does not hydrate operation revisions, rich modules, review change sets, doctrine catalogs, or asset blobs; tests enforce this boundary.

## 5. Navigation/context architecture

Global visits hide the operation editor without replacing its draft or saving a revision. Returning restores the same unsaved editor state. Opening a different operation retains the established dirty/save guard. The operation header identifies organization, doctrine, and saved revision. Last-opened operation is a global preference, excluded from planning history and comparison. Global organization and doctrine draft editors also remain mounted while visited elsewhere.

## 6. Operations browser

The browser works before an operation is selected. It provides search, status filtering, sorting, bounded pages, organization/doctrine labels, revision, publication and open-review counts, and explicit operation selection. Operation IDs remain independent of names.

## 7. Organization family/version architecture

`unitProfileFamilyId` identifies the reusable profile; `unitProfileVersionId` identifies one exact version. The schema is explicitly versioned and strict. Each draft has a content counter for stale-write detection. The existing doctrine configuration `organizationRef` is unchanged and is never used as an alias for a Unit Profile.

## 8. Organization lifecycle behavior

Drafts are editable. Publishing freezes content and its SHA-256 hash. New versions preserve continuing internal identities and record ancestry. Duplication creates a new family and remaps section, position, and relationship IDs. Retirement is an immutable overlay, preserving the published document and hash. Existing references remain resolvable; new selections use published versions. Retired subordinate pins already present in a source profile survive derived versions and independent draft edits.

## 9. Unit identity model

Profiles contain designation, short designation, type/echelon including custom values, callsign, description, and optional managed insignia reference. Instantiation creates an independent canonical operation-unit UUID. Operational `name` remains the authoritative designation; additional profile identity fields do not duplicate it. Operation edits cannot rewrite source provenance.

## 10. Staff-section model

Sections have stable UUIDs, names, descriptions, and deliberate display order. Sections can be created, renamed, reordered, and used to group positions. Schema validation rejects invalid references and duplicate identities.

## 11. Staff-position model

Positions have stable UUIDs, section references, custom titles, short titles, functional roles, default-role designation, descriptions, notes, rank/grade, and optional incumbent information. Moving, reordering, or renaming a position preserves its identity. Derived profile versions retain continuing position IDs; new-family duplicates remap them.

## 12. Functional-role resolution

The explicit `staff-roles-v1` adapter maps known bundled doctrine staff IDs to functional roles. Custom doctrine mappings reference exact doctrine identities/versions. Resolution uses a sole candidate or an explicitly designated default. Missing candidates and ambiguous candidates produce visible warnings. Titles, array order, and incumbent names never select the position.

## 13. Incumbent metadata

Name, rank, contact, and notes are optional informational metadata on a position. They do not become position identity, authenticated user identity, operational assignment identity, or a personnel-management subsystem.

## 14. Standing hierarchy behavior

Standing relationships model reusable organizational parent/subordinate structure. Validation rejects self-parenting, duplicate child families, missing/extraneous family-version pairs, draft child selections, and transitive family cycles across profile versions. Preview resolves the exact tree. No operational command/support/effective-time relationship types are introduced.

## 15. Exact subordinate-version pinning

Every standing relationship retains a stable relationship UUID and exact child family/version UUIDs. Publishing a newer child does not change an existing parent. Relationship indexes are checked against the validated profile document. Existing retired references remain readable and usable through the frozen parent.

## 16. Organization default-doctrine behavior

Profiles may recommend an exact doctrine version and its existing configuration reference. Create Operation suggests it and allows a different valid published doctrine. The operation independently pins the chosen doctrine. Its organization binding contains no dynamic dependency on a profile's current default doctrine. Restore verifies the complete recommendation, including family, version, profile version, and configuration pair.

## 17. Create Operation changes

The global flow selects name, exact doctrine, optional exact published Organization Profile, optional clearly labeled fictional demo data, and optional Task Organization initialization. Organization selection is not required. Initialization is an explicit independent choice.

## 18. Operation organization pinning

`operationOrganizationBinding` freezes exact source family/version/hash, version label, resolved identity, staff, role-adapter version, and resolved doctrine-role mappings. Display, ownership resolution, historical comparison, and publication use this saved state. Generic operation saves cannot replace or remove the binding. There is no live adoption or synchronization.

## 19. Task Organization profile-instantiation behavior

Add from Unit Profiles offers exact-version search/preview, unit-only import, and explicit standing-subtree import. Units receive new operation UUIDs and operation-owned parent links. Provenance records source family/version/hash, import identity, and source relationship path. Repeated submissions with the same import ID are idempotent. Likely duplicate family reuse warns, requires deliberate confirmation, and can create another independent instance.

## 20. Responsible Staff integration

Bound operations display the organization position resolved from doctrine ownership or inheritance. Doctrine semantics remain inspectable. Typed operational overrides reference positions, sections, or roles in the pinned snapshot and participate in normal operation revisioning. Restore default removes the override. Missing/ambiguous mappings show warnings without inventing staff. Base order and doctrine-product authoring share this behavior.

## 21. Legacy compatibility

Legacy operations remain unbound and retain their original staff rendering and override behavior. Optional M5 fields do not introduce defaults into historical documents. Earlier base-order content, canonical units/tasks/Signal, applicability, modules, publications, exports, and review records remain readable. Existing organization configuration and bundled doctrine contents are unchanged.

## 22. Doctrine Builder/global-shell integration

The existing builder is available under global Doctrines before selecting an operation. Its draft state survives global visits. Its publication, exact pinning, managed assets, portable doctrine packages, and module authoring behavior remain covered by the retained M3 workflow.

## 23. Library behavior

Library browses existing managed asset metadata across operation, doctrine, and Unit Profile owners, with search and pagination. Bytes load on explicit preview/save. Organization imagery references managed asset IDs; no bytes are embedded in profile documents. Derived versions follow the existing asset ownership lifecycle. There are no dummy symbols, ORBATs, or diagram models.

## 24. Settings behavior

Settings reuses the existing preferences record for time display, local actor label, and other existing global preferences. Backup/restore is available outside operation context. UI navigation preferences remain outside operation revision/publication semantics. The local actor label is attribution, not authentication.

## 25. M4 diff/review integration

New organization-aware comparisons use `diff-engine-v2`, `impact-v2`, and `review-html-v2`. They compare frozen binding, relevant imported unit identity/provenance, and typed staff overrides, including effective position impacts. Unrelated current global profile changes do not become operation changes. V1 sources remain byte-identical; engine/impact/report pairing is validated. Stored reviews stay frozen and render through their recorded version.

## 26. Publication/export behavior

Publication already freezes the full source operation, now including optional organization binding and staff overrides. Package composition remains planning state. Accepted OPORD projections 1–4 and their renderers are unchanged; there is no projection v5. An organization-only edit does not stale an export whose recorded dependencies never consumed that field. The Communications Card remains derived from authoritative Signal data.

## 27. Database migration(s)

Only migration 006 is added. It creates profile families/versions/retirements, exact standing relationship indexes, operation revision pin indexes, and supporting summary indexes. Migrations 001–005 are byte-identical. The asset ownership constraint expands to a third owner through a transactional rebuild of the same table. Before/after checks cover row count, IDs, owners, metadata JSON, MIME, length, SHA-256, actual bytes, and required immutability triggers. Any discrepancy rolls back the migration. Tests cover schema-001 through schema-005 upgrades, including a real 0.4.0 backup and its frozen v1 review.

## 28. Backup/restore

Backups retain profile families/versions, staff, exact hierarchy/defaults, assets, operation pins, publications, exports, reviews, and events. Restore validates schema, hashes, source bindings, indexes, assets, and history protections before replacement, and keeps recovery copies. Both automated tests and real desktop restart workflows verify exact recovery.

## 29. Security considerations

The new workspace IPC uses strict commands and the existing trusted main-frame guard, context isolation, sandbox, CSP, and offline network policy. No renderer Node integration or arbitrary file-system bridge is added. Native file dialogs remain main-process owned. Managed inputs use the established size, MIME/signature, and hash validation. Tests use isolated fictional workspaces; the user's normal workspace is not replaced. Authentication, permissions, encryption, and classification enforcement remain outside scope.

## 30. Exact automated test commands/results

All commands completed successfully before the version bump.

| Command                 | Result                                              |
| ----------------------- | --------------------------------------------------- |
| `npm.cmd run format`    | PASS                                                |
| `npm.cmd run typecheck` | PASS                                                |
| `npm.cmd run lint`      | PASS; formatting and 267 architecture references    |
| `npm.cmd test`          | PASS; 373 tests in 11 files (303 retained + 70 new) |
| `npm.cmd run build`     | PASS                                                |

Tests cover profile lifecycle/identities, role resolution and ambiguity, retirement, standing pins/cycles, exact instantiation and duplicate reuse, immutable bindings, summary query boundaries, v2 review semantics, legacy v1 report bytes, old projection staleness, publication freezing, assets, migration rollback, corrupt-backup rejection, and restore.

## 31. Development smoke results

| Command                        | Result | Recorded checks | Evidence                                                                                           |
| ------------------------------ | ------ | --------------- | -------------------------------------------------------------------------------------------------- |
| `npm.cmd run smoke`            | PASS   | 13              | [M1 evidence](../.test-data/smoke-8faed6ec-7f4a-4e76-8144-7ef6c5e88d1c/acceptance.json)            |
| `npm.cmd run smoke:milestone2` | PASS   | 20              | [M2 evidence](../.test-data/milestone2-smoke-f10f0369-63c0-415b-a867-001a7d1aba89/acceptance.json) |
| `npm.cmd run smoke:milestone3` | PASS   | 50              | [M3 evidence](../.test-data/milestone3-smoke-cf3fd2e5-91ba-4911-bb51-86d831e9d7ad/acceptance.json) |
| `npm.cmd run smoke:milestone4` | PASS   | 64              | [M4 evidence](../.test-data/milestone4-smoke-b735bc95-3530-4e17-9d8c-9cd48ec7509e/acceptance.json) |
| `npm.cmd run smoke:milestone5` | PASS   | 77              | [M5 evidence](../.test-data/milestone5-smoke-ba73cee3-0ea8-4ee6-b812-ffbb8d6f5e35/acceptance.json) |

Every workflow completed in isolated offline development Electron. The final M5 rerun includes the Dashboard full-designation fallback. Earlier workflows retain their authoring assertions and use a shared adapter for global navigation.

## 32. Packaged candidate results

Built while the application remained **0.4.0** with:

```powershell
npm.cmd run dist -- --config.directories.output=release/milestone5-candidate-final
$env:ORDO_PACKAGED_PATH = "C:\Ordo APP DEV\release\milestone5-candidate-final\win-unpacked\Ordo.exe"
```

| Command                                      | Result | Recorded checks | Evidence                                                                                           |
| -------------------------------------------- | ------ | --------------- | -------------------------------------------------------------------------------------------------- |
| `npm.cmd run smoke -- --packaged`            | PASS   | 13              | [M1 evidence](../.test-data/smoke-1cf872c1-f6a6-4e44-a1f8-58d23e3571c2/acceptance.json)            |
| `npm.cmd run smoke:milestone4 -- --packaged` | PASS   | 64              | [M4 evidence](../.test-data/milestone4-smoke-1b57c67e-7d3a-4b11-99d3-6e798c65f7d0/acceptance.json) |
| `npm.cmd run smoke:milestone2 -- --packaged` | PASS   | 20              | [M2 evidence](../.test-data/milestone2-smoke-b8cb98bb-9753-469a-b270-7eb8cb3be49e/acceptance.json) |
| `npm.cmd run smoke:milestone3 -- --packaged` | PASS   | 50              | [M3 evidence](../.test-data/milestone3-smoke-967eb9a7-23f5-4123-a2c0-8a609850f288/acceptance.json) |
| `npm.cmd run smoke:milestone5 -- --packaged` | PASS   | 77              | [M5 evidence](../.test-data/milestone5-smoke-c2dcb2b6-97ab-4b43-aa19-45c3e5babadc/acceptance.json) |

All candidate gates passed at 2026-10-03T15:04:28.027Z, before changing package or UI versions. The final candidate incorporates the Dashboard label correction; earlier diagnostic candidates are not the release gate.

## 33. Final packaged release results

After the candidate gate, package/lock versions and both sidebar labels advanced to 0.5.0. Built with `npm.cmd run dist`; final smoke commands use the default version-specific executable path (no candidate override).

| Command                                      | Result | Recorded checks | Evidence                                                                                           |
| -------------------------------------------- | ------ | --------------- | -------------------------------------------------------------------------------------------------- |
| `npm.cmd run smoke -- --packaged`            | PASS   | 13              | [M1 evidence](../.test-data/smoke-3f07d07a-060a-4760-989d-853823f7ab7e/acceptance.json)            |
| `npm.cmd run smoke:milestone4 -- --packaged` | PASS   | 64              | [M4 evidence](../.test-data/milestone4-smoke-75b15de4-c016-4b9b-b72a-becb5de465b6/acceptance.json) |
| `npm.cmd run smoke:milestone2 -- --packaged` | PASS   | 20              | [M2 evidence](../.test-data/milestone2-smoke-4fa17d34-3931-4fa1-b454-f6496f1ef7f4/acceptance.json) |
| `npm.cmd run smoke:milestone3 -- --packaged` | PASS   | 50              | [M3 evidence](../.test-data/milestone3-smoke-b09304cb-ef1b-412e-a4e7-bfddd38757af/acceptance.json) |
| `npm.cmd run smoke:milestone5 -- --packaged` | PASS   | 77              | [M5 evidence](../.test-data/milestone5-smoke-e0245cb5-ef34-4b74-9e97-e1f8be730bd3/acceptance.json) |

Installer: [Ordo Setup 0.5.0.exe](../release/0.5.0/Ordo%20Setup%200.5.0.exe) — 123,650,680 bytes.

SHA-256: `a67f5573e9d46556f4637c7f08c6d4140b1575110071c7064bf4643be5b847d8`.

Unpacked application: `release/0.5.0/win-unpacked/Ordo.exe`. Keep the entire directory together. Historical release folders remain intact. The installer was built; acceptance ran against its packaged application, without installing over the user's workspace.

## 34. Acceptance scenario PASS/FAIL by step

All **82/82 PASS**. Steps 1–76 come from the final M5 packaged acceptance run. Steps 77–82 are cross-workflow gates backed by the separate completed scripts in sections 31–33.

| Step | Result | Demonstration                                                                                                                |
| ---- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | PASS   | Real Ordo 0.4.0/schema-005 upgraded through 006; existing asset blobs and owners preserved                                   |
| 2    | PASS   | Historical operations, configuration, publications, exports, assets, and frozen reviews remain readable                      |
| 3    | PASS   | Normal startup opens Dashboard                                                                                               |
| 4    | PASS   | All six global navigation destinations are available                                                                         |
| 5    | PASS   | Operations browser works without selecting an operation                                                                      |
| 6    | PASS   | Legacy operation opens without inferred organization                                                                         |
| 7    | PASS   | Return to Dashboard without restarting                                                                                       |
| 8    | PASS   | Existing Doctrine Builder opens globally                                                                                     |
| 9    | PASS   | Created fictional brigade Unit Profile through UI                                                                            |
| 10   | PASS   | Configured identity, custom type/echelon, callsign and description                                                           |
| 11   | PASS   | Created seven configurable staff sections                                                                                    |
| 12   | PASS   | Created eight reusable staff positions                                                                                       |
| 13   | PASS   | Assigned semantic OPERATIONS role to Brigade S-3                                                                             |
| 14   | PASS   | Added informational incumbent metadata without changing position identity                                                    |
| 15   | PASS   | Draft profile, staff, incumbent and managed insignia survive save/restart exactly                                            |
| 16   | PASS   | Published immutable version 1.0.0                                                                                            |
| 17   | PASS   | UI and application guards reject in-place published edits                                                                    |
| 18   | PASS   | Created a new Draft version in the same family                                                                               |
| 19   | PASS   | New staff draft preserves old published content and continuing position identities                                           |
| 20   | PASS   | Created fictional subordinate profile through validated workspace command                                                    |
| 21   | PASS   | Published exact Battalion version                                                                                            |
| 22   | PASS   | Added exact published Battalion version as a standing subordinate                                                            |
| 23   | PASS   | A newer Battalion version does not change the existing exact standing pin                                                    |
| 24   | PASS   | Read-only standing hierarchy preview shows exact child version                                                               |
| 25   | PASS   | Self-parent relationship rejected                                                                                            |
| 26   | PASS   | Transitive family cycle across profile versions rejected                                                                     |
| 27   | PASS   | Exact default doctrine was configured before publication and remains inspectable                                             |
| 28   | PASS   | Opened improved Create Operation flow                                                                                        |
| 29   | PASS   | Selected exact Brigade 1.0.0                                                                                                 |
| 30   | PASS   | Organization default doctrine preselected                                                                                    |
| 31   | PASS   | Planner can override doctrine recommendation                                                                                 |
| 32   | PASS   | Returned to exact recommended doctrine                                                                                       |
| 33   | PASS   | Created operation with independently selected organization and doctrine                                                      |
| 34   | PASS   | Operation stores exact organization version and resolved snapshot                                                            |
| 35   | PASS   | Publishing 1.1.0 does not silently adopt it into the operation                                                               |
| 36   | PASS   | Operation header shows organization, doctrine and revision                                                                   |
| 37   | PASS   | Responsible Staff resolves Operations to Brigade S-3                                                                         |
| 38   | PASS   | Doctrine owner semantics remain inspectable                                                                                  |
| 39   | PASS   | Typed operation-specific staff override saved in a revision                                                                  |
| 40   | PASS   | Restoring default returns organization/doctrine-derived ownership                                                            |
| 41   | PASS   | Created profile without OPERATIONS role                                                                                      |
| 42   | PASS   | Missing role displays unresolved warning without inventing a position                                                        |
| 43   | PASS   | No-organization operation remains fully supported                                                                            |
| 44   | PASS   | Opened canonical Task Organization                                                                                           |
| 45   | PASS   | Opened exact profile selector from Task Organization                                                                         |
| 46   | PASS   | Searched and selected exact saved Battalion version                                                                          |
| 47   | PASS   | Instantiated unit-only import                                                                                                |
| 48   | PASS   | Operation unit has independent UUID and exact source provenance                                                              |
| 49   | PASS   | Operational rename leaves global Unit Profile unchanged                                                                      |
| 50   | PASS   | Deliberate subtree import permits confirmed independent profile reuse                                                        |
| 51   | PASS   | Imported parent links reference operation-owned units                                                                        |
| 52   | PASS   | Global profile edits do not mutate Task Organization                                                                         |
| 53   | PASS   | Create Operation offers explicit Task Organization initialization                                                            |
| 54   | PASS   | Selected standing structure instantiated exactly once                                                                        |
| 55   | PASS   | Saved multiple planning revisions                                                                                            |
| 56   | PASS   | V2 comparison and controlled review detect typed operational staff override                                                  |
| 57   | PASS   | New global version alone creates no operation changes and leaves frozen review exact                                         |
| 58   | PASS   | Published OPORD freezes exact organization snapshot and staff overrides                                                      |
| 59   | PASS   | Published another global organization version                                                                                |
| 60   | PASS   | Historical publication remains unchanged                                                                                     |
| 61   | PASS   | Legacy operation continues using original ownership data and renderer behavior                                               |
| 62   | PASS   | Organization browser search, status/echelon filters and sorting work                                                         |
| 63   | PASS   | Duplication creates independent family/Draft and remaps staff identities                                                     |
| 64   | PASS   | Retired version remains resolvable for pinned operation                                                                      |
| 65   | PASS   | Global preferences available outside operation context                                                                       |
| 66   | PASS   | Managed global library supports organization imagery without Symbol/ORBAT placeholders                                       |
| 67   | PASS   | Dashboard shows recent saved operation activity                                                                              |
| 68   | PASS   | Dashboard shows open Change Review information                                                                               |
| 69   | PASS   | Dashboard action creates operation                                                                                           |
| 70   | PASS   | Dashboard action opens new Organization flow                                                                                 |
| 71   | PASS   | Dashboard action opens doctrine creation controls                                                                            |
| 72   | PASS   | Backed up saved workspace with organization, assets, staff, pins and review history                                          |
| 73   | PASS   | Made additional profile/staff/operation changes after backup                                                                 |
| 74   | PASS   | Restored backup through guarded global Settings action                                                                       |
| 75   | PASS   | Restart returns to Dashboard after restore                                                                                   |
| 76   | PASS   | Exact profile versions, staff/hierarchy/defaults, organization pins, frozen publication/review and staff resolution restored |
| 77   | PASS   | Milestone 1 retained workflow passes in development and packaged Electron (sections 31–33).                                  |
| 78   | PASS   | Milestone 2 retained workflow passes in development and packaged Electron (sections 31–33).                                  |
| 79   | PASS   | Milestone 3 retained workflow passes in development and packaged Electron (sections 31–33).                                  |
| 80   | PASS   | Milestone 4 retained workflow passes in development and packaged Electron (sections 31–33).                                  |
| 81   | PASS   | M5 development workflow passes, including offline/security and zero-renderer-error assertions.                               |
| 82   | PASS   | All five workflows pass on both the final 0.4.0 candidate and final 0.5.0 packaged release.                                  |

Step 27 was configured before publishing profile 1.0.0 and then verified at the requested stage, preserving published immutability. Later global edits use new versions; no published record is edited in place.

Additional assertions cover unsaved global navigation without implicit save, duplicate import confirmation/idempotency, exact managed image recovery, invalid workspace commands, and renderer isolation.

## 35. Backward compatibility result

**PASS.** All 303 pre-existing tests remain in the 373-test suite. All retained M1–M4 development and packaged workflows pass. Migration 001–005, OPORD projection 1–4, bundled doctrine, and v1 diff/impact/report hashes match their frozen guards. Actual historical database fixtures retain snapshots, publications, exports, managed asset bytes, and v1 reviews. Optional M5 state is not inferred into legacy operations.

Machine-readable results, evidence hashes, migration hash, candidate gate timestamp, and release hashes are in [milestone5-verification.json](milestone5-verification.json).

## 36. Known limitations

Windows x64, offline single-planner scope. The installer is unsigned. Smoke workflows exercise development Electron and the packaged executable in isolated workspaces; they do not install over a real user workspace. Library is a managed-asset browser, not a separate arbitrary-file import system. Profile hierarchy preview is read-only and non-graphical. Unit Profile package portability and in-place operation organization adoption are deliberately absent. Organization provenance is retained in publications but is not added to OPORD projection output. Asset size and existing doctrine-package limits remain unchanged. The build emits existing nonfatal Zod annotation and dependency-deduplication notices.

## 37. Deferred Milestone 6+ work

Military symbols, symbol dictionary/editor/gallery, graphical ORBAT creation/gallery/import, operation symbol overrides, organization portability and adoption, richer operational relationships, WARNORD/FRAGO/OPLAN lifecycle, GIS, PDF/DOCX, accounts, permissions, shared editing, synchronization, and tactical AI remain excluded. No speculative symbol/ORBAT schema was added.

## 38. Important files/modules

| Area               | Files                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Global UI          | `src/renderer/src/ApplicationShell.tsx`, `OrganizationWorkspace.tsx`, `UnitProfilePicker.tsx`, `ResponsibleStaff.tsx`, `workspace.css`  |
| Domain             | `src/domain/unit-profiles.ts`, `staff-resolution.ts`, `workspace-navigation.ts`                                                         |
| Application        | `src/application/workspace-ports.ts`, `workspace-service.ts`                                                                            |
| Persistence        | `src/persistence/unit-profile-store.ts`, `migrations/006.sql`, repository/restore integration                                           |
| Versioned review   | `src/domain/diff/v2.ts`, `src/application/review-impact-v2.ts`, `src/export/review-html-v2.ts`, `review-report.ts`                      |
| Regression         | `tests/milestone5.test.ts`, `tests/milestone5-contracts.test.ts`, `tests/fixtures/milestone4-0.4.0.db`, `milestone5-frozen-hashes.json` |
| Desktop acceptance | `scripts/smoke-milestone5.cjs`, `scripts/smoke-global.cjs`, retained M1–M4 scripts                                                      |
| Documentation      | `docs/milestone5-architecture.md`, this report, `docs/milestone5-verification.json`, `README.md`                                        |

## 39. Recommended next milestone only

Milestone 6 — Military Symbology & ORBAT. First inspect the user's existing reference application single-file HTML source, then plan how to rebuild its symbol dictionary/editor/gallery and ORBAT creator/gallery. Use stable Unit Profile references and independent operation units established here. Do not embed that application or anticipate its schema without inspection. Milestone 6 requires separate instruction; no implementation has begun.
