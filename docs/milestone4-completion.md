# Milestone 4 Completion Report

## 1. Final status

**COMPLETE — Ordo 0.4.0.** All 303 tests, all four development workflows, all four pre-bump packaged candidate workflows, and all four rebuilt 0.4.0 packaged workflows passed. All 68 acceptance steps are PASS. The application remained 0.3.0 until the candidate gates passed; it was then advanced and reverified. Milestone 5 has not been started.

Installer: `release/0.4.0/Ordo Setup 0.4.0.exe` (123,627,644 bytes). SHA-256: `2b54fd1a22e911a9124eb0d311c0966a832dc01544bd6e27408049d8301ba86b`. Unpacked app: `release/0.4.0/win-unpacked/Ordo.exe`. Machine-readable evidence: `docs/milestone4-verification.json`.

## 2. Repository changes

Added the semantic comparison domain, controlled review domain, review repository port/service, dependency analysis, migration 005, SQLite review adapter, typed desktop review bridge, History / Changes workspace, dedicated review HTML renderer, regression fixtures/tests, and the separate Milestone 4 Electron smoke. Earlier tests and workflows remain; their migration expectations now include 005 and the security bridge allowlist includes the two new review methods.

## 3. Revision-history architecture

Saved snapshots remain authoritative and unchanged. An additive UUID sidecar identifies each operation/revision pair; an insert trigger assigns new identities. History shows revision number, operation name, save actor/time, workflow state, associated approvals/publications, and current-saved status. Display pagination initially shows 30 revisions.

## 4. Comparison endpoint model

Explicit REVISION and PUBLICATION selectors resolve saved sources within one operation. Resolved endpoints preserve UUIDs, revision number, publication ID when present, doctrine/organization/echelon pins, timestamps, labels, and state/configuration SHA-256 hashes. Publication endpoints use their frozen snapshot and configuration. Invalid, cross-operation, unsaved, and reverse-order sources are rejected.

## 5. Semantic diff-engine architecture

The pure domain dispatcher calls stable-identity adapters over canonical entities, legacy narratives, structured authoring, and modules. Changes carry readable summaries and typed before/after values. Dependencies are analyzed separately in the application layer. Domain code imports no React, Electron, SQLite, Drizzle, renderer, or Node API.

## 6. Diff-engine versioning

Every comparison freezes `diff-engine-v1` and `impact-v1`. Unknown diff engines are rejected. Persisted reviews load their stored records without rerunning comparison. The retained v1 desktop fixture and semantic-file hashes guard future changes; new behavior requires a new semantics version rather than rewriting accepted v1 behavior.

## 7. Change Record model

Each record has a deterministic semantic fingerprint and derived UUID; operation, entity, product, module-instance and definition identities; category/type; stable field path; human labels/summary; typed before/after values and displays; canonical/direct-product references; source-navigation location; and detail kind. Change records are sealed and immutable with their endpoints.

## 8. Semantic comparison coverage

Coverage includes operation identity/configuration metadata, M1 narrative, M2 structured base fields/products, canonical units/tasks/purposes/objectives/phases/events, Signal/PACE, applicability, staff overrides, module presence/order/configuration/content, and all 17 M3 module types. Separate command/support relationships or effective-time concepts were not invented.

## 9. Rich-text diff behavior

Validated tree blocks are aligned deterministically with bounded lookahead. Changes distinguish sentences, paragraph/heading/list style, list insertion, formatting, hyperlink URL/range, and managed images. Equivalent adjacent text/link fragments normalize. Readable word highlighting is bounded for large text. Historical rich documents receive no fabricated block identifiers; unsafe HTML is never rendered.

## 10. Table/Matrix/Checklist diff behavior

Columns, rows, and items match by stable ID. Renames remain modifications. Typed cells identify their specific row and column; booleans/numbers retain their types. Adds/removals and useful sequence moves are distinct. Inserting one row does not produce numeric-index changes for all following rows. A 2,000-row table regression confirms one edited cell yields one primary record.

## 11. Timeline diff behavior

Absolute time, reference-event identity, and relative offset are primary structural fields. H-30 to H-45 is an offset change. Editing canonical H-Hour produces one source event change; relative events/timeline modules receive derived impact evidence and resolved before/after values.

## 12. Chart dependency/diff behavior

Direct chart data and binding edits are primary records. A linked chart reads its source table and selected stable columns. Table edits remain primary while changed chart output is a dependent impact. Field-scoped edges prevent an unselected cell from claiming a simultaneous selected-column effect.

## 13. Signal/Task Org/canonical entity comparison

Annex A, Annex H, Signal matrices, PACE modules, canonical-reference modules, and live cards continue reading the original operational entities. Renaming/reassigning canonical data changes it once. Parent-unit links and membership are compared directly; dependent products appear with explanations. The Communications Card field-exclusion proof is retained.

## 14. Noise-suppression behavior

Comparison suppresses revision counters, save/module timestamps, storage references, JSON key order, participant/applicability set ordering, automatic approval invalidation on save, and incidental positional shifts. Derived chart datasets, copied reference labels, and resolved relative times are not new authored-change records. Deliberate metadata edits remain visible.

## 15. Change Review domain model

A first-class review freezes its operation, baseline/target, exact comparison, analyzed artifact inventory, diagnostics, engine versions, report renderer, creation attribution, and optional parent/supersession relationships. Events carry subsequent controlled metadata. Reviews never call planning save, approval, or publication.

## 16. Decision/history model

UNREVIEWED, ACCEPTED, REJECTED, NEEDS_CHANGES, and NOTED apply to individual stable change IDs. Every new decision appends an event; earlier dispositions and reasons remain. Expected-sequence checks prevent stale updates. Explicitly confirmed bulk actions append individual events atomically. Assessments do not apply or revert changes.

## 17. Comments/notes behavior

Review notes and change comments are separate event forms, with local actor, timestamp, and sequence. Empty comments and foreign change IDs are rejected. Title/description edits also preserve their earlier history. Closed reviews retain readable notes and decisions.

## 18. Review lifecycle

OPEN permits decisions/comments. COMPLETED requires no UNREVIEWED changes and may contain NEEDS_CHANGES. Explicit supersession creates and links a separate replacement. ARCHIVED retains history and is hidden from the normal selector unless requested. Subsequent planning revisions never move an existing target or reopen a completed review.

## 19. Change Review workspace UX

History / Changes includes previous/publication shortcuts, arbitrary endpoint selection, read-only Quick Comparison, persisted review selection, grouped before/after cards, disposition/product/category/search filters, bulk confirmation, notes/history, completion, follow-on/superseding review preparation, archival, report preview/save, and source navigation. Removed current sources cannot be opened. Unsaved planning/profile changes block controlled review creation with a visible save-first explanation. The first 100 matching changes render initially, with expansion.

## 20. Impact/dependency analysis

Edges originate in actual source references and bindings from either endpoint. Endpoint output witnesses confirm a dependent differs. Impacts preserve changed source IDs, target, concrete reason, dependency chain, and derived values. Inherited ownership is attributed to the explicit parent override. Metadata and unselected chart-field attribution have dedicated regressions.

## 21. Export impact behavior

Each artifact is evaluated using its recorded projection, export-profile version, resolved configuration, and dependencies. Baseline-to-target dependency changes are separate from baseline/target staleness relative to the original artifact. Excluded channel changes do not affect a card that omitted channel. Already-outdated artifacts are labeled. Unknown projection semantics yield a diagnostic, without modifying or inventing staleness for the artifact.

## 22. Publication-baseline behavior

A publication remains immutable. Comparison reads its exact source and configuration and describes later planning as divergence from that baseline. The acceptance workflow explicitly approves/publishes first, then verifies later narrative, module, review, and restore operations leave the publication unchanged.

## 23. Review summary/report rendering

`review-html-v1` deterministically renders frozen endpoint hashes/pins, engine versions, event sequence, changes, before/after highlights, dispositions, comments, impact reasons, and lifecycle metadata. A sandboxed iframe previews it; HTML can be saved locally. A retained completed review fixture reproduces its exact report SHA-256. This renderer does not alter OPORD export semantics.

## 24. Database migrations

Only migration 005 was added. It creates revision identities, sealed reviews, ordered immutable changes, and append-only review events, with foreign keys, binding/sequence checks, and immutability triggers. Prior migrations 001–004, bundled doctrine, projectors v1–v4, and historical renderers pass byte-hash guards. Actual schema-003/0.2.0 and schema-004/0.3.0 workspaces upgrade without rewriting historical rows; retained tests cover schema-001/002 upgrades.

## 25. Backup/restore changes

Reviews and all event history are included in the existing SQLite backup. Verification resolves endpoints, checks hashes/fingerprints, source entities, impact/artifact references, same-operation links, event folding, supersession, and required protection triggers. The desktop workflow backs up a completed review, creates later revisions/review/comments, restores, restarts, and compares the exact prior review state.

## 26. Security considerations

Existing sandbox, context isolation, Node isolation, trusted main-frame IPC, CSP, offline network policy, and window blocking remain. Review commands have strict schemas; the workspace lock protects backup/restore/report save. Authored report content is escaped. Comparison uses asset metadata, never executable attachment contents. Local actor labels are not authenticated identities. The installer remains an unsigned development release.

## 27. Legacy compatibility

M1 summaries remain in their original fields. M2 authoring/applicability remains operation state against pinned doctrine. M3 module data and assets remain authoritative. Reviews do not require legacy operations to adopt modules. The real 0.3.0 upgrade fixture and frozen completed v1 review fixture are retained for future regression testing.

## 28. Exact automated test commands/results

| Command                                                                        | Result                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `npm.cmd run format`                                                           | PASS                                                       |
| `npm.cmd run typecheck`                                                        | PASS                                                       |
| `npm.cmd run lint`                                                             | PASS; Prettier and 199 architecture references             |
| `npm.cmd test`                                                                 | PASS; 303 tests in 9 files: original 194 plus 109 M4       |
| `npm.cmd run build`                                                            | PASS; main/preload/renderer bundles                        |
| `npm.cmd run dist -- --config.directories.output=release/milestone4-candidate` | PASS; 0.3.0 candidate NSIS and unpacked build              |
| `npm.cmd run dist`                                                             | PASS after the version gate; 0.4.0 NSIS and unpacked build |

The retained v1 review fixture replays 21 primary changes, 25 history events, and its exact report hash. All retained historical-byte guards pass. Intermediate harness fixes addressed raster-only preview selection and accessible comparison shortcuts. Initial migration expectation failures were updated to acknowledge schema 005 without weakening content assertions. Dependency annotation/deduplication notices did not fail builds.

## 29. Development smoke results

| Command                        | Result          | Evidence directory                                                 |
| ------------------------------ | --------------- | ------------------------------------------------------------------ |
| `npm.cmd run smoke`            | PASS; 13 checks | `.test-data/smoke-e7ba42c6-151a-450a-98c3-0a6d1460a173`            |
| `npm.cmd run smoke:milestone2` | PASS; 20 checks | `.test-data/milestone2-smoke-951c877d-d467-4ca0-a5a9-8e5a0b741282` |
| `npm.cmd run smoke:milestone3` | PASS; 50 checks | `.test-data/milestone3-smoke-afbfc8d7-78bc-4dd7-8047-50a9a218b4fc` |
| `npm.cmd run smoke:milestone4` | PASS; 64 checks | `.test-data/milestone4-smoke-59d85ab3-51a7-4eef-b488-ee8098f80633` |

The M4 script checks scenario steps 1–63 plus gate 67. Steps 64–66 use the original independent smokes. Electron 44.5.1 ran offline against separate fictional workspaces. No renderer errors were recorded. M4 baseline fixture edits use the validated application bridge; comparison controls, dispositions, comments, filters, source navigation, completion, and report preview/save are exercised in the actual desktop UI.

## 30. Packaged smoke results

Candidate gate passed at 2026-10-03T12:42:10.927Z. For each command below, PowerShell first set `$env:ORDO_PACKAGED_PATH='C:\Ordo APP DEV\release\milestone4-candidate\win-unpacked\Ordo.exe'`. Runtime version 0.3.0 was verified before the version bump.

| Command                                      | Result          | Evidence directory                                                 |
| -------------------------------------------- | --------------- | ------------------------------------------------------------------ |
| `npm.cmd run smoke -- --packaged`            | PASS; 13 checks | `.test-data/smoke-a7e78166-97ca-4742-b97b-76e3131e9cc2`            |
| `npm.cmd run smoke:milestone2 -- --packaged` | PASS; 20 checks | `.test-data/milestone2-smoke-3c6417bb-5e1e-48ba-905e-6103b5a20ed9` |
| `npm.cmd run smoke:milestone3 -- --packaged` | PASS; 50 checks | `.test-data/milestone3-smoke-170c40c8-d3e8-40f2-957c-0a5c4733ebeb` |
| `npm.cmd run smoke:milestone4 -- --packaged` | PASS; 64 checks | `.test-data/milestone4-smoke-a11bffe8-1fb3-4df2-82d2-48681a3533b9` |

Final release verification completed 2026-10-03T12:50:15.715Z. These commands used the default `release/0.4.0/win-unpacked/Ordo.exe` path, with no candidate-path override. All passed with zero renderer errors.

| Command                                      | Final release result | Evidence directory                                                 |
| -------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `npm.cmd run smoke -- --packaged`            | PASS; 13 checks      | `.test-data/smoke-7f1a0cb8-d7a2-4f46-b4a2-1bc3976b827a`            |
| `npm.cmd run smoke:milestone2 -- --packaged` | PASS; 20 checks      | `.test-data/milestone2-smoke-6428208c-4861-41e2-bb15-ed41090cf5bb` |
| `npm.cmd run smoke:milestone3 -- --packaged` | PASS; 50 checks      | `.test-data/milestone3-smoke-8eea548e-a45e-4b3c-80e1-7a85e67bd6a4` |
| `npm.cmd run smoke:milestone4 -- --packaged` | PASS; 64 checks      | `.test-data/milestone4-smoke-440f0839-52dd-4681-b5e2-edd132ccdb97` |

## 31. Acceptance scenario PASS/FAIL by step

| Step | Result | Evidence / outcome                                                                                                        |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| 1    | PASS   | Actual 0.3.0 schema-004 backup migrated to 005; all historical rows are unchanged                                         |
| 2    | PASS   | Historical operations, doctrines, assets, publications and stored exports remain readable                                 |
| 3    | PASS   | Created fictional brigade operation through validated application commands                                                |
| 4    | PASS   | Baseline saved with canonical brigade facts, included A/C/H and rich/table/chart/timeline/image/gallery modules           |
| 5    | PASS   | Explicit approval and OPORD publication performed in the desktop UI                                                       |
| 6    | PASS   | Saved a revision changing only one narrative field                                                                        |
| 7    | PASS   | Exactly one narrative change; save time and automatic status reset suppressed                                             |
| 8    | PASS   | History quick action compares current saved revision with its predecessor                                                 |
| 9    | PASS   | Arbitrary earlier and later revision selectors work                                                                       |
| 10   | PASS   | Frozen publication selected as baseline against later saved planning state                                                |
| 11   | PASS   | Operation rename retains operation UUID                                                                                   |
| 12   | PASS   | H-Hour edit is one canonical time change                                                                                  |
| 13   | PASS   | Relative timeline resolution appears as impact, without a duplicate authored edit                                         |
| 14   | PASS   | Task text and purpose use the same canonical task identity                                                                |
| 15   | PASS   | Task assignment is a relationship change                                                                                  |
| 16   | PASS   | Parent-unit change affects Annex A through a dependency, without duplicate source data                                    |
| 17   | PASS   | Signal net channel is one canonical edit                                                                                  |
| 18   | PASS   | Annex H and live Communications Card are explained dependents                                                             |
| 19   | PASS   | Included-to-omitted applicability is revisioned operation state                                                           |
| 20   | PASS   | Responsible Staff override compares doctrine/inherited ownership to explicit assignment                                   |
| 21   | PASS   | Removing an override restores doctrine/inherited staff semantics                                                          |
| 22   | PASS   | Operation module addition has a stable instance identity                                                                  |
| 23   | PASS   | One module move produces one semantic move                                                                                |
| 24   | PASS   | Module removal preserves content and records operation layout removal                                                     |
| 25   | PASS   | Plain text has readable before and after content                                                                          |
| 26   | PASS   | Rich sentence, list item and image produce structured semantic differences                                                |
| 27   | PASS   | Column rename retains its ID; no remove/add noise                                                                         |
| 28   | PASS   | One typed cell edit identifies its exact stable row and column                                                            |
| 29   | PASS   | Table row addition is a single added row                                                                                  |
| 30   | PASS   | Row reorder uses stable identities and one useful move                                                                    |
| 31   | PASS   | Linked chart is an affected dependent of table-only source editing                                                        |
| 32   | PASS   | Changing chart binding is a primary structural edit                                                                       |
| 33   | PASS   | Timeline H-30 to H-45 compares its authored offset                                                                        |
| 34   | PASS   | Image replacement uses managed asset identity/hash, without reading binary contents                                       |
| 35   | PASS   | Quick Comparison visibly groups semantic changes with before/after highlights                                             |
| 36   | PASS   | Created a first-class persisted Change Review from the selected endpoints                                                 |
| 37   | PASS   | Baseline, target, engine, semantic changes and impacts are frozen                                                         |
| 38   | PASS   | Restart reloads the identical persisted change records                                                                    |
| 39   | PASS   | Recorded ACCEPTED through the review UI                                                                                   |
| 40   | PASS   | Recorded REJECTED through the review UI                                                                                   |
| 41   | PASS   | Recorded NEEDS_CHANGES through the review UI                                                                              |
| 42   | PASS   | Recorded NOTED through the review UI                                                                                      |
| 43   | PASS   | Disposition actions leave underlying operation content byte-equivalent                                                    |
| 44   | PASS   | Changing a prior decision retains both entries                                                                            |
| 45   | PASS   | Added a separate review-level note                                                                                        |
| 46   | PASS   | Added a change-level comment                                                                                              |
| 47   | PASS   | Every action retains timestamp, local actor and sequence                                                                  |
| 48   | PASS   | Disposition, category, product and search filters are usable                                                              |
| 49   | PASS   | Source navigation preserves the frozen review and decisions                                                               |
| 50   | PASS   | Impacts retain concrete dependency reasons/chains and derived before/after values                                         |
| 51   | PASS   | Recorded export including channel is affected and outdated                                                                |
| 52   | PASS   | Recorded export excluding channel is unaffected by the channel-only revision                                              |
| 53   | PASS   | Frozen publication is unchanged and described as a divergence baseline                                                    |
| 54   | PASS   | Unsaved authoring blocks controlled review creation with a save-first explanation                                         |
| 55   | PASS   | Completed review after all changes received dispositions, retaining Needs Changes                                         |
| 56   | PASS   | Later saved plan revision does not move the completed review target                                                       |
| 57   | PASS   | New comparison against latest revision is separate from completed review                                                  |
| 58   | PASS   | Completed review, exact changes, decisions and comments survive restart                                                   |
| 59   | PASS   | Versioned read-only report preview and saved HTML include exact provenance and review history                             |
| 60   | PASS   | Backed up workspace including frozen review and append-only events                                                        |
| 61   | PASS   | Made additional revision, follow-on review and comment after backup                                                       |
| 62   | PASS   | Restored saved workspace through the verified restore service                                                             |
| 63   | PASS   | Restart after restore exactly reproduces reviews, endpoints, changes, decisions and comments                              |
| 64   | PASS   | Original M1 workflow: 13 desktop checks passed in development, packaged candidate, and final 0.4.0 release.               |
| 65   | PASS   | Original M2 workflow: 20 desktop checks passed in development, packaged candidate, and final 0.4.0 release.               |
| 66   | PASS   | Original M3 workflow: 50 desktop checks passed in development, packaged candidate, and final 0.4.0 release.               |
| 67   | PASS   | Development Electron M4 workflow passed; prior milestone gates are recorded by their separate smoke commands              |
| 68   | PASS   | All four workflows passed in the packaged 0.3.0 candidate before the version bump and again in the rebuilt 0.4.0 release. |

## 32. Backward compatibility result

All original 194 tests remain in the suite. No old snapshot, profile, publication, export, doctrine record, migration, OPORD projector, or historical renderer was migrated merely to support comparisons. Earlier test changes only acknowledge additive migration 005 and the expanded narrow desktop bridge. The prior 0.3.0 installer also retains its original SHA-256 (`6a29cab8a33d51f1834e322b2c78a49495503bd33eb402f545f737e8b3cc6a2b`).

## 33. Known limitations

- Rich block alignment uses deterministic bounded anchors; it is not a global document merge or an edit-provenance tracker for blocks that historically had no IDs.
- History/review metadata is read locally; list pagination limits rendered rows rather than providing a server cursor.
- Task organization covers existing membership and parent-unit links. Separate support/command relationship types and effective timing remain outside this approved milestone.
- Impact evidence is frozen at review creation. New artifacts or later planning require a new comparison.
- Single offline planner, local attribution, HTML review reports, and unsigned Windows development packaging remain the supported deployment scope.

## 34. Deferred Milestone 5+ work

WARNORD/FRAGO/OPLAN lifecycle, automatic revised orders, merge/revert/cherry-pick, doctrine migration/adoption or full doctrine diff, shared editing/authentication/synchronization, GIS/symbology, MDMP, PDF/DOCX, AI recommendations/generation, executable plugins, and user scripts were not implemented.

## 35. Important files/modules

| Area        | Files                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Domain      | `src/domain/diff/{model,index,v1,sequence,rich,text}.ts`, `src/domain/reviews.ts`                  |
| Application | `src/application/review-ports.ts`, `review-service.ts`, `review-impact.ts`                         |
| Persistence | `src/persistence/migrations/005.sql`, `review-store.ts`, repository integration                    |
| Desktop     | `src/application/bridge.ts`, `src/main/index.ts`, `src/preload/index.ts`                           |
| UI/report   | `src/renderer/src/ReviewWorkspace.tsx`, `reviews.css`, `App.tsx`, `src/export/review-html.ts`      |
| Tests       | `tests/milestone4-diff.test.ts`, `milestone4-reviews.test.ts`, actual 0.3.0 and frozen v1 fixtures |
| Acceptance  | `scripts/smoke-milestone4.cjs`, original three smoke scripts, evidence below `.test-data`          |
| Design      | `docs/milestone4-architecture.md`                                                                  |

## 36. Recommended next milestone only

Milestone 5 — WARNORD / FRAGO Lifecycle, with FRAGO able to reference reviewed changes against a published baseline. No Milestone 5 implementation has begun.
