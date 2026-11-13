# Ordo Milestone 1 Completion Report

Verified 1 October 2026 · Windows x64 · Ordo 0.1.1

## 1. Final status

**Complete with explicitly documented non-blocking limitations.** All final build, type, formatting/boundary, unit/integration, development Electron, and packaged Electron checks pass. No Milestone 1 acceptance failure remains. Milestone 2 has not begun.

The existing implementation was extended in place. Closure added explicit revision approval, versioned render-template identity, historical projection dispatch, stronger restore verification, and the missing acceptance coverage.

## 2. Implemented capabilities

The offline single-planner workspace supports operation identity, five base-order paragraphs, typed Annex → Appendix → Tab → Exhibit relationships, units/task organization, objectives, tasks with purposes, phases, shared absolute/relative timeline events, and authoritative Signal nets/PACE/lost-communications data.

Full OPORD and Communications Card previews derive from that dataset. Versioned Export Profiles control scope, fields (including Net name), and presentation settings. Generation freezes HTML plus exact provenance. Explicit revision approval precedes immutable OPORD publication. Later planning edits create unapproved draft revisions while preserving historical evidence. SQLite backup/restore includes all operations, history, approvals, configuration, profiles, templates, publications, exports, and preferences.

## 3. Architectural invariants verified

| Invariant                    | Enforcement and evidence                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework-free core          | Domain imports no Electron, React, renderer, or database code. Application uses repository/runtime ports. The AST-based boundary check covers static, dynamic, CommonJS, re-export, and type imports; nine guard regression tests cover forbidden dependencies.                                                                  |
| One authoritative source     | Signal editors modify operation entities. OPORD/card projections read those entities. Previews and generated artifacts are read-only. Both live products update from one source edit.                                                                                                                                            |
| Stable identity              | UUID identities are independent of labels, codes, names, and sequence. Profile IDs are separate from content versions and schema versions. Name changes preserve references.                                                                                                                                                     |
| Validated configuration      | Strict Zod schemas validate doctrine, echelon, organization, export profiles, templates, and historical records. Operation revisions pin exact configuration versions. Historical versions are immutable.                                                                                                                        |
| Atomic revisioning           | Expected-revision checks, aggregate validation, current-record writes, complete historical snapshot, and attribution execute in one transaction. Stale writes and invalid links leave no partial history.                                                                                                                        |
| Same-operation relationships | Composite foreign keys protect task/unit/objective/phase, unit parent, relative event/phase, attachment parent, and net participant links. Repository-boundary domain invariants also validate PACE, net, and attachment applicability arrays and typed hierarchy. Fourteen foreign-link cases plus direct SQL cases are tested. |
| Exact approval               | Approve Revision creates an immutable attributable record for one saved revision and OPORD scope. Workflow status alone cannot publish. Application checks and SQL publication bindings require that exact explicit approval.                                                                                                    |
| Immutable publication        | A publication preserves source revision, configuration, order identity, approval ID and attribution, timestamp, and complete content. Database triggers prohibit update/delete. A later publication points to its predecessor.                                                                                                   |
| Export provenance            | Each artifact preserves source operation/revision/publication, exact export profile and resolved configuration, projection version, renderer version, render-template ID/version, actor/time, dependencies, and HTML. Repository checks validate the links.                                                                      |
| Deterministic staleness      | Stored projection version dispatches to retained v1 or v2 semantics. Manifests include selected values, referenced labels, and dynamic result membership. Rendering-only metadata does not cause operational staleness; unsupported projections report compatibility unavailable with unknown staleness.                         |
| Explainable validation       | Findings identify rule, severity, category, entity, field, explanation, and evaluated revision. Unassigned drafts, invalid assignments, missing purposes, missing summaries, hierarchy errors, and net/task-organization consistency are explained without changing data.                                                        |
| Safe restore                 | A copied candidate must pass marker, contiguous migration/checksum, integrity/FK, configuration/history/approval/template/provenance checks. Recovery is saved before replacement. Invalid candidates leave active state intact; activation failure reopens the previous database.                                               |
| Desktop isolation            | Sandboxed renderer, context isolation, Node integration disabled, restrictive CSP, narrow validated preload bridge, main-frame/origin checks, denied new windows/navigation/remote runtime requests, and escaped exported HTML. Tests isolate both SQLite and Electron user data.                                                |

## 4. Database and migrations

- `001.sql` remains unchanged: configuration versions, operations/revisions, current structured entities and relationships, export-profile versions, publications, exports, audit events, and preferences. Foreign keys and immutable-history triggers enforce identity and history constraints.
- `002.sql` is additive: `revision_approvals`, `publication_approvals`, `render_template_versions`, and `export_templates`. It adds exact-revision approval bindings and mandatory template bindings for new records. One explicit OPORD approval per operation/revision is permitted; historical evidence is append-only.

New publication/export documents use schema version 2. Existing schema-1 publication/export JSON is preserved byte-for-byte. Additive migration records label old embedded approval attribution as `legacy-publication`; it cannot authorize a new publication. Legacy exports bind to the appropriate built-in template v1 and retain projection v1. The tested upgrade preserves content and source dependencies. Fresh databases apply both migrations. Future, gapped, or changed migration lineages are rejected.

SQLite enables foreign keys, WAL, and transactional writes. Less complex applicability arrays stay in strict typed entity payloads with repository-boundary validation; this milestone does not invent additional planning tables for unimplemented concepts.

## 5. Final test results

| Exact command                     | Final result                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm.cmd run format`              | PASS; source, test, script, and documentation formatting applied                                             |
| `npm.cmd run typecheck`           | PASS; TypeScript reports no errors                                                                           |
| `npm.cmd run lint`                | PASS; Prettier check and AST dependency boundary check, 48 module references                                 |
| `npm.cmd test`                    | PASS; **75 tests, 3 files, 0 failures** (24 original domain/integration, 42 closure, 9 boundary-guard cases) |
| `npm.cmd run build`               | PASS; main, preload, and renderer production bundles                                                         |
| `npm.cmd run smoke`               | PASS; **13 checks, 0 failures, 0 renderer errors**                                                           |
| `npm.cmd run dist`                | PASS; unsigned Windows x64 executable and NSIS installer; includes build/typecheck                           |
| `npm.cmd run smoke -- --packaged` | PASS; **13 checks, 0 failures, 0 renderer errors**, actual packaged executable with no development server    |

Development evidence: `.test-data/smoke-1ec242bd-e86f-4992-809c-94f3853ec3ee`.

Packaged evidence: `.test-data/smoke-42331d1e-5917-4e8d-8308-76a83638f89d`. This contains `acceptance.json`, `final-state.json`, screenshots, the saved Channel-excluded HTML, SQLite workspace/backup, and retained recovery files.

The UI walkthrough was reproduced through real Electron controls with real IPC, SQLite, and filesystem operations. Only native dialogs were stubbed to deterministic test paths. Screenshot review covered source editing, full Signal details, card inclusion/exclusion, approval, validation, publication, updated live products, canonical events, and restoration. This is agent-operated UI verification and visual review, not a claim of separate human-user sign-off.

Earlier smoke attempts exposed navigation selectors affected by count badges and a shared Electron cache/instance lock. Those were corrected; the final development and packaged runs above pass. The build emits two non-blocking Rollup annotation warnings from comments in the installed Zod dependency; application compilation succeeds.

## 6. Packaging result

- Installer: `C:\Ordo APP DEV\release\Ordo Setup 0.1.1.exe`
- Packaged executable: `C:\Ordo APP DEV\release\win-unpacked\Ordo.exe` (keep the entire `win-unpacked` directory together)
- Installer size: **122,304,482 bytes**
- Installer SHA-256: `36CA68FABBD8ACEBFB9093CC4F5D0BB1F5C50A21FA1B9C12B35E9209EF771C78`
- Authenticode: **NotSigned**, as allowed for Milestone 1

The packaged binary successfully loaded bundled configuration/demo data and native SQLite, wrote HTML and backups, restored complete state, and reopened it. Network access was disabled in the test browser context and runtime remote requests are denied by the app. The NSIS installer was built; its installation wizard was not run against the user's normal application directories.

## 7. Acceptance walkthrough results

| Step                         | Result | Evidence                                                                                                                                                                                         |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1                            | PASS   | First authoritative Signal channel saved as `DEMO REVIEW CHANNEL`, revision 2.                                                                                                                   |
| 2                            | PASS   | Full OPORD includes that channel and architecture/spectrum/maintenance detail.                                                                                                                   |
| 3                            | PASS   | Read-only Communications Card includes the channel and omits detailed Signal notes.                                                                                                              |
| 4                            | PASS   | Unchecking Channel creates profile v2; preview, immutable export, and saved HTML exclude it.                                                                                                     |
| 5                            | PASS   | Re-enabled Channel with UNIT A / PHASE I creates profile v3; only matching data appears; exact configuration/projection/renderer/template provenance is retained.                                |
| 6                            | PASS   | UNIT B finding is explained; including the unit in task organization and saving resolves it.                                                                                                     |
| 7                            | PASS   | Acceptable workflow state is saved; a separate explicit approval records the exact revision, local actor, time, scope, and note.                                                                 |
| 8                            | PASS   | Publication v1 preserves the reviewed revision, exact approval ID, resolved configuration, timestamp, and snapshot.                                                                              |
| 9                            | PASS   | Editing creates an unapproved draft; both live products update, prior publication and approval remain unchanged, included Channel artifact is outdated, excluded Channel artifact stays current. |
| 10                           | PASS   | Backup/edit/restore returns exact planning and all publication/export/approval history; close/reopen preserves it.                                                                               |
| Canonical event              | PASS   | One H-HOUR edit updates Timeline, its relative event, and live OPORD; published 14:00/15:00 values remain frozen.                                                                                |
| Dynamic membership           | PASS   | A newly matching UNIT A / PHASE I net appears live and invalidates the prior artifact through `selection/radio-nets`.                                                                            |
| Cross-operation rejection    | PASS   | Foreign task, net participant, attachment parent, and every other supported reference tested; no partial save persists.                                                                          |
| Approval invalidation        | PASS   | Approval N and publication N remain intact; later revisions cannot publish using the old approval.                                                                                               |
| Projection/render provenance | PASS   | Historical v1 semantics remain stable while v2 exists; renderer-only metadata does not cause staleness; unknown projection versions are a separate compatibility state.                          |

The reproducible instructions are in [acceptance.md](acceptance.md).

## 8. Known non-blocking limitations

The build targets Windows x64 and is unsigned. Attribution identifies a local planner; it is not authenticated identity or a cryptographic signature. Doctrine starts with the supplied small A/B/C/H catalog, and generation currently produces HTML. No graphical template designer or broad configuration-authoring UI is included. Applicability selects exact units rather than automatically expanding a unit hierarchy. The synchronous repository port is appropriate to this offline deployment; a future remote repository will need an explicit asynchronous interface adaptation.

These are the approved milestone boundaries. There is no knowingly unfinished Milestone 1 acceptance item.

## 9. Deferred to Milestone 2+

Full WARNORD/FRAGO workflows, complete doctrine catalogs, MDMP tooling, GIS, multi-user identity/permissions, shared editing, synchronization/server deployment, PDF/DOCX rendering, extensive field-history UI, plugin distribution, updater infrastructure, and automatic/AI tactical-plan generation were not implemented. Production signing/distribution and environment-specific accreditation are separate future work.

## 10. Important files and modules

| Responsibility                                              | Location                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Domain schemas, approval/template identities                | `src/domain/model.ts`                                                                    |
| Domain relationships and canonical event resolution         | `src/domain/invariants.ts`                                                               |
| Revision, explicit approval, publication, export commands   | `src/application/service.ts`                                                             |
| Repository/runtime extension points                         | `src/application/ports.ts`                                                               |
| SQLite/Drizzle persistence, history/provenance verification | `src/persistence/repository.ts`, `schema.ts`, `migrations/001.sql`, `migrations/002.sql` |
| Safe candidate validation/recovery/restore                  | `src/persistence/restore.ts`                                                             |
| Doctrine and configuration                                  | `src/config/doctrine.json`, `src/config/profiles.ts`                                     |
| Fictional fixtures                                          | `src/demo/operation.ts`                                                                  |
| Explainable validation                                      | `src/validation/engine.ts`                                                               |
| Projection dispatch and staleness                           | `src/export/projection.ts`, `src/export/projections/v1.ts`, `v2.ts`                      |
| Render templates and escaped HTML                           | `src/export/templates.ts`, `src/export/html.ts`                                          |
| Electron composition, filesystem/dialogs, IPC and security  | `src/main/index.ts`, `src/preload/index.ts`, `src/application/bridge.ts`                 |
| Planning and approval/publication UI                        | `src/renderer/src/App.tsx`                                                               |
| Unit/integration/restore/compatibility coverage             | `tests/domain.test.ts`, `tests/closure.test.ts`, `tests/boundaries.test.ts`              |
| Real Electron acceptance                                    | `scripts/smoke.cjs`                                                                      |
| Architecture guard                                          | `scripts/check-boundaries.cjs`                                                           |

## 11. Next recommended milestone

Use a bounded fictional planning scenario to define a minimal FRAGO amendment/review workflow and its change summary against a published OPORD, reusing the revision, approval, and provenance foundations. Agree that scope before implementation. No Milestone 2 work has begun.
