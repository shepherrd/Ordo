# Milestone 3 Completion Report

Ordo 0.3.0 · Windows x64 · 3 October 2026

## 1. Final status

**COMPLETE.** Ordo 0.3.0 implements Doctrine Builder and Modular Product Authoring. All 194 automated tests pass, including the original 135. M1 (13 checks), M2 (20 steps), and M3 (50 acceptance steps) pass in both development and packaged Electron with zero renderer errors. The Windows release is built and verified. Milestone 4 has not begun.

## 2. Repository changes

Extended the existing application with Doctrine Builder, versioned custom doctrine, 17 module types, managed assets, rich editing, module-aware previews/exports, operation layout overrides, and safe doctrine portability. Added migration 004, projection v4, renderer `html-v2`, automated regressions, and a separate M3 Electron smoke script. Package and lockfile are 0.3.0. Changes remain in the current workspace; no commit or PR was created. Earlier milestone reports remain historical records.

## 3. Doctrine family/version architecture

A strict lifecycle document separates family UUID, version UUID, permanent stable key, numeric profile version, human version label, schema version, and optimistic draft content counter. It records source kind, lifecycle dates, parent/duplication relationships, notes, and the exact resolved configuration. Drafts are editable; publication freezes content. Retirement uses an append-only ledger and preserves readability for pinned operations. Bundled records are sidecars around unchanged profile documents. Duplicate creates a new family; new version retains the family and creates an independent draft. Operations retain exact original configuration pins.

## 4. Doctrine Builder behavior

The first-class Builder is accessible without creating an operation. It groups bundled, user-created, and imported versions and supports new, duplicate, open, save draft, publish, create new version, retire, import, and export. General, Structure, Products / Modules, Staff, Validation, Preview, and Versions views separate these tasks. Published/bundled controls are disabled, with service and database enforcement underneath. Unsaved draft edits receive navigation/close protection; workspace restore remounts Builder against restored data.

## 5. Product hierarchy authoring

Drafts support base-order composition and Annex → Appendix → Tab → Exhibit products, custom codes/titles/purpose, aliases, staff defaults/support, ownership behavior, applicability recommendations, format/capability hints, and source metadata. Users can add, rename, reorder siblings, change valid parents, duplicate a selected product with its definitions, and remove leaf products. UUIDs and stable keys remain independent of labels. Strict hierarchy, sibling-code, identity, parent, and provenance checks remain active; custom codes do not have to be A–Z.

## 6. Module-definition architecture

Definitions belong to a versioned doctrine layout and contain stable UUID/key, type, title, description, guidance, position, required/default-visible flags, typed configuration, and provenance. Configuration defines fields, columns, defaults, chart/time modes, and asset references; operation facts are not stored in definitions. The renderer capability registry maps 17 domain types to available editors. Doctrine contains no React component names. Unsupported optional types produce findings; unsupported required types prevent publication/import.

## 7. Module-instance architecture

Revisioned operation instances contain their UUID, operation/product binding, definition reference or local definition, origin, content, configuration override, order, removal state, and timestamps. The optional module extension has its own schema version and does not rewrite legacy documents. Saved identity/source bindings cannot be reassigned. Doctrine configuration, operation layout overrides, and authored content remain separate.

## 8. Module library implemented

| Category                   | Types                                                                         |
| -------------------------- | ----------------------------------------------------------------------------- |
| Text                       | PLAIN_TEXT, RICH_TEXT                                                         |
| Structured                 | KEY_VALUE, TABLE, MATRIX, CHECKLIST                                           |
| Temporal                   | TIMELINE                                                                      |
| Visual                     | CHART, IMAGE, IMAGE_GALLERY                                                   |
| Files/references           | FILE_ATTACHMENT, CANONICAL_REFERENCES                                         |
| Existing Ordo data/editors | TASK_ORGANIZATION, SIGNAL_NET_MATRIX, PACE, REPORT_CATALOG, DISTRIBUTION_LIST |

Key/value and table fields support 21 types: short/long/rich text; integer/decimal/boolean; date/time/datetime/duration; single/multi-select; unit/phase/event/objective/task/net/product/staff references; and URL. Field and option UUIDs are stable when labels change. Guidance, required state, defaults, and configured order remain definition data.

## 9. Rich-text implementation

Pinned Tiptap 3.31.4 supplies the renderer editor and document transactions. Ordo stores a strict structured document tree, not authored HTML, with paragraphs, headings, bold/italic/underline, lists, quotes, safe links, and managed image IDs. Domain validation bounds node count/depth and rejects unknown nodes, attributes, handlers, scripts, unsafe links, and external image paths. A deterministic escaping formatter produces previews/exports. Images resolve through managed raster data. The choice and official library reference are recorded in the architecture document.

## 10. Managed asset architecture

Immutable asset metadata and bytes are stored together in SQLite. Each asset has a UUID, exactly one operation/doctrine-version owner, original basename, MIME type, size, import timestamp, SHA-256, and opaque `asset:UUID` reference. Renderer documents never depend on filesystem paths. Main-process native dialogs import bytes and save attachment copies through a narrow validated bridge. Images support PNG/JPEG/GIF/WebP. Files are treated as data, with executable/script filename and payload rejection; Ordo does not execute attachments.

## 11. Table/Matrix/Checklist behavior

Table and Matrix use the same typed column/row/cell model, with stable identities, row add/remove/reorder, editable cells, and allowed column configuration. Column renames preserve bindings. Removed columns leave stored cells recoverable and produce explainable findings when referenced. New rows initialize configured defaults. Checklists support item text, status, notes, and optional unit/staff/event references; they do not automate approvals. Legacy M2 matrix/checklist content and editors remain available.

## 12. Timeline behavior

Items contain identity, title/description, optional phase, and either an absolute timestamp or a canonical event UUID plus minute offset. H, H-30, and H+45 resolve from the same authoritative event. Changing H-hour updates live derived times. Missing events are findings; local absolute items do not create duplicate canonical events. Input/output timestamps use UTC semantics.

## 13. Chart/data-binding behavior

BAR, LINE, PIE, and SCATTER render deterministic SVG with a data table. Sources are either direct datasets or stable table-module/column references. Linked charts store binding configuration, not copied table facts. Editing table data updates preview immediately; column renames retain identity, and removed/missing/nonnumeric bindings produce findings. Scatter requires numeric x-values. No formula engine, user JavaScript, or executable chart configuration exists.

## 14. Canonical-reference behavior

References resolve existing units, tasks/purposes, objectives, phases, events/H-hour, nets, PACE, and order products. Typed fields also support canonical references and doctrine staff IDs. Reference breakage is visible and does not silently repair planner content. Rendered dependencies record referenced values for existing staleness checks.

## 15. Task Organization/Signal/PACE reuse

Task Organization modules invoke the existing authoritative unit editor; Signal and PACE invoke the shared Signal editor and read the same nets, participants, channels, applicability, and PACE data. Their module content contains no copied operational dataset. Existing Annex A/H behavior remains available. Export audience/phase/net scope and canonical ordering participate in module projections and dependencies.

## 16. Operation-specific layout override behavior

Planners can add, duplicate, configure, reorder, and remove operation modules. Removing an inherited module records an explicit operation override without changing doctrine. Reset requires confirmation, restores inherited defaults, retains authored content, archives local modules for recovery, and preserves the prior configuration override. Recovery is explicit. Layout changes save as normal operation revisions and remain frozen in prior publications.

## 17. Operation rename behavior

Overview edits the name through the normal save-revision workflow. UUID and doctrine pins remain unchanged. Later names do not rewrite historical revision, publication, or generated export names. Both automated and Electron checks verify the behavior.

## 18. Responsible Staff UX behavior

Products show the doctrine default or inherited parent staff with its source. The full selector appears only after **Override**. An operational override is labeled and revisioned; **Restore doctrine default** removes it. Parent inheritance continues through the existing owner-resolution model. Doctrine remains unchanged.

## 19. Doctrine import/export format and security

`.ordo-doctrine` is bounded strict JSON containing a format/schema marker, canonical content hash, exact doctrine lifecycle/configuration, and base64 doctrine-owned assets. It includes no operations or operation assets. Import validates the entire manifest, identities, schemas, hashes, MIME/signature/size, ownership, basenames, module references, and conflicts before an atomic transaction installs it. There is no filesystem archive extraction. Identical imports are idempotent; differing content with the same identity is rejected. Imported provenance is labeled; copied source citations remain intact.

## 20. Projection/export changes

Projection v4 renders ordered active modules within the included package, preserving ancestor applicability and profile scope. It tracks selection/order, module content, linked facts, chart source data/columns, and asset metadata. `html-v2` adds trusted module fragments and managed raster embedding. Communications Card behavior retains its existing semantics. Old exports dispatch through their recorded projector/renderer; v1-v3 and the original HTML renderer remain unchanged. Publication freezes the exact approved revision and configuration independently of subsequent doctrine, layout, applicability, name, or content changes.

## 21. Validation rules

Strict schemas and findings cover invalid hierarchy/identity/code/provenance, stale draft writes, immutable published mutation, malformed definitions/fields/options, unsupported required types, invalid asset ownership/hash/storage, incorrect instance/definition/product bindings, invalid inherited configuration overrides, duplicate row/item identities, field value errors, broken references, chart columns, relative-event bindings, and malformed rich documents. Structural/identity errors are rejected at save boundaries. Recoverable authoring issues remain visible without discarding values. Storage failures are surfaced and prevent approval/publication. Package Composer associates module content and findings with the correct product.

## 22. Database migrations

Only additive migration **004.sql** was added. It creates doctrine lifecycle, retirement-ledger, and managed-asset tables, version uniqueness, and immutability/ownership guards. Modules remain in validated profile/operation documents. Original migrations 001–003, projection implementations v1–v3, and bundled doctrine files match recorded SHA-256 fixtures byte-for-byte. Schema-001/002 regression upgrade paths and an actual schema-003 Ordo 0.2.0 database upgrade pass. Existing historical documents are not rewritten.

## 23. Backup/restore changes

SQLite backup now naturally includes all managed bytes and lifecycle rows. Restore verification extends existing checks to asset hashes/ownership, lifecycle/profile agreement, module bindings, historical references, and required triggers. The acceptance path backs up a modular workspace, makes further doctrine/operation/asset changes, restores, restarts, and compares exact doctrine versions, operation pins/content, and assets. Recovery copies of the prior workspace retain the existing behavior.

## 24. Legacy compatibility behavior

M1 base-order summaries and M2 structured base fields retain their original read/edit paths. M2 Generic label/value content stays accessible through its compatibility editor/view. V4 includes existing narrative/structured content alongside modules when present, without copying or reinterpreting labels. Original doctrine pins, source distinctions, approval/publication semantics, and Communications Card behavior remain intact. Module layouts are adopted only by explicit operation authoring or new-operation configuration.

## 25. Exact automated test commands/results

Commands run from `C:\Ordo APP DEV` in PowerShell:

| Command                                      | Result                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `npm.cmd run format`                         | PASS                                                               |
| `npm.cmd run typecheck`                      | PASS                                                               |
| `npm.cmd run lint`                           | PASS; formatting and 150 architecture-boundary references          |
| `npm.cmd test`                               | PASS; 194 tests across 7 files: all original 135 plus 59 M3 checks |
| `npm.cmd run build`                          | PASS; main/preload/renderer production bundles                     |
| `npm.cmd run smoke`                          | PASS; 13 M1 checks, zero renderer errors                           |
| `npm.cmd run smoke:milestone2`               | PASS; 20 M2 steps, zero renderer errors                            |
| `npm.cmd run smoke:milestone3`               | PASS; 50 acceptance entries, zero renderer errors                  |
| `npm.cmd run dist`                           | PASS; production build and Windows x64 NSIS installer              |
| `npm.cmd run smoke -- --packaged`            | PASS; 13 M1 checks, zero renderer errors                           |
| `npm.cmd run smoke:milestone2 -- --packaged` | PASS; 20 M2 steps, packaged 0.3.0, zero renderer errors            |
| `npm.cmd run smoke:milestone3 -- --packaged` | PASS; 50 acceptance steps, packaged 0.3.0, zero renderer errors    |

The final version bump used `npm.cmd version 0.3.0 --no-git-tag-version`, after development acceptance passed. Earlier harness selector/fixture errors were corrected without removing behavioral assertions. The test timeout is 15 seconds to accommodate actual database migration/verification work. Builds emit upstream Zod comment-annotation notices; no application compile error results.

## 26. Development smoke result

All three workflows pass in real offline Electron using isolated fictional workspaces. M3 uses actual UI authoring, native-dialog stubs selecting fixture paths, restarts, clean-workspace import, and persisted-state assertions. Runtime isolation/security is separately exercised by M1. Visual QA covers Builder, package preview, module chart preview, and final workspace. Development Electron reports its runtime version (44.5.1), not the packaged application version.

Evidence directories (each contains `acceptance.json` and screenshots):

- M1: `.test-data/smoke-70e16351-6431-4c77-877c-507b60e92ec6`
- M2: `.test-data/milestone2-smoke-6f051f20-fc1c-47d5-96c7-642a0534a538`
- M3 final 0.3.0 build: `.test-data/milestone3-smoke-a257fc59-5080-48bd-bec2-c4cb6962e3f1`

M3 screenshots include `doctrine-builder.png`, `package-preview.png`, `module-chart-preview.png`, and `final.png`. All runs use fictional data and isolated desktop profiles.

## 27. Packaged smoke result

**PASS.** All three packaged workflows pass with zero renderer errors. Runtime confirms version **0.3.0**, Windows x64, packaged Electron **44.5.1**. The final module-based publication, clean-workspace doctrine import, exact backup/restore, managed asset decoding, and restarts pass in the packaged executable.

Evidence directories:

- M1: `.test-data/smoke-337d9ff6-6f28-4032-8fb7-c1f0f5b815be`
- M2: `.test-data/milestone2-smoke-fe81b6db-76d7-4110-b836-eb7061883ed1`
- M3: `.test-data/milestone3-smoke-d1cfdc2c-f5c1-4727-9cb9-d6f703982ade`

| Artifact                                        | Bytes       | SHA-256                                                            |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `release/0.3.0/Ordo Setup 0.3.0.exe`            | 123,601,734 | `6A29CAB8A33D51F1834E322B2C78A49495503BD33EB402F545F737E8B3CC6A2B` |
| `release/0.3.0/win-unpacked/Ordo.exe`           | 245,726,208 | `9D3420ABDAAA1E36F29D8328DFD5F04B68194BD4AD1ACADC892398B63D7ACD8F` |
| `release/0.3.0/win-unpacked/resources/app.asar` | 37,024,685  | `972AFBAE748BDE9EA030A39C76715A97D3AA17F059E6814ECECF4C233F1D9CE5` |

Keep the entire `win-unpacked` directory together. The installer is unsigned; NSIS generation and packaged executable behavior are tested, while installation/uninstallation wizard interaction is outside this acceptance run. The first packaging attempt encountered Windows `EBUSY` because the prior `release/win-unpacked/Ordo.exe` was open. Release output now uses `release/${version}`, and packaged smoke scripts resolve that version-specific path. The existing planner process was not stopped. Earlier installers remain at their original paths.

## 28. Acceptance scenario PASS/FAIL by step

The supplied 50-step scenario is implemented in the M3 smoke. Steps 46–47 are substantiated by the separate M1/M2 runs, rather than rerunning those workflows inside the M3 script. All 50 rows pass in development and packaged execution.

| Step | Required behavior                                              | Development | Packaged |
| ---- | -------------------------------------------------------------- | ----------- | -------- |
| 1    | Actual 0.2.0 database upgrades without historical loss         | PASS        | PASS     |
| 2    | Bundled US Army Orders visible and immutable                   | PASS        | PASS     |
| 3    | In-place bundled editing prevented                             | PASS        | PASS     |
| 4    | Duplicate into 25th LIB Orders draft                           | PASS        | PASS     |
| 5    | Edit name and description                                      | PASS        | PASS     |
| 6    | Add valid child product                                        | PASS        | PASS     |
| 7    | Reorder products and restart                                   | PASS        | PASS     |
| 8    | Add rich text/image/table/timeline/chart/reference definitions | PASS        | PASS     |
| 9    | Configure typed key/value fields                               | PASS        | PASS     |
| 10   | Publish doctrine 1.0.0                                         | PASS        | PASS     |
| 11   | Published doctrine becomes immutable                           | PASS        | PASS     |
| 12   | Create derived 1.1.0 draft                                     | PASS        | PASS     |
| 13   | Draft edits leave 1.0.0 unchanged                              | PASS        | PASS     |
| 14   | Select published custom doctrine for new operation             | PASS        | PASS     |
| 15   | Retain 1.0.0 pin                                               | PASS        | PASS     |
| 16   | Rename with stable UUID and new revision                       | PASS        | PASS     |
| 17   | Author formatted rich text and managed inline image            | PASS        | PASS     |
| 18   | Rich content/image survive restart                             | PASS        | PASS     |
| 19   | Add operation-only module                                      | PASS        | PASS     |
| 20   | Reorder operation modules                                      | PASS        | PASS     |
| 21   | Remove inherited module without changing doctrine              | PASS        | PASS     |
| 22   | Confirm reset and retain recoverable content                   | PASS        | PASS     |
| 23   | Typed table columns and rows                                   | PASS        | PASS     |
| 24   | Bind chart to table/column IDs                                 | PASS        | PASS     |
| 25   | Source edit updates chart without copied data                  | PASS        | PASS     |
| 26   | Rename preserves binding; deletion produces finding            | PASS        | PASS     |
| 27   | Absolute/H/H-30/H+45 timeline entries                          | PASS        | PASS     |
| 28   | Canonical H-hour change updates resolved times                 | PASS        | PASS     |
| 29   | Multi-image gallery with captions                              | PASS        | PASS     |
| 30   | Managed attachment survives restart                            | PASS        | PASS     |
| 31   | Annex A uses canonical units                                   | PASS        | PASS     |
| 32   | Signal/PACE remain canonical                                   | PASS        | PASS     |
| 33   | Staff default shown without full selector                      | PASS        | PASS     |
| 34   | Explicit operational staff override                            | PASS        | PASS     |
| 35   | Restore doctrine staff default                                 | PASS        | PASS     |
| 36   | Parent inheritance identifies its source                       | PASS        | PASS     |
| 37   | Export portable custom doctrine                                | PASS        | PASS     |
| 38   | Import into clean workspace                                    | PASS        | PASS     |
| 39   | Hierarchy/definitions/metadata/assets match                    | PASS        | PASS     |
| 40   | Package excludes operation data                                | PASS        | PASS     |
| 41   | Conflicting import rejected without overwrite                  | PASS        | PASS     |
| 42   | Package renders rich text/images/table/timeline/chart          | PASS        | PASS     |
| 43   | Publish modular OPORD                                          | PASS        | PASS     |
| 44   | Later rename leaves publication name frozen                    | PASS        | PASS     |
| 45   | Live content change leaves publication frozen                  | PASS        | PASS     |
| 46   | Separate M1 regression workflow                                | PASS        | PASS     |
| 47   | Separate M2 regression workflow                                | PASS        | PASS     |
| 48   | Back up modular workspace                                      | PASS        | PASS     |
| 49   | Make later doctrine/operation/asset changes                    | PASS        | PASS     |
| 50   | Restore/restart recovers exact versions/pins/content/assets    | PASS        | PASS     |

## 29. Backward compatibility result

Automated coverage retains every original M1/M2 test. Upgrade tests preserve old snapshots, publications, profile versions, exports, and projection dispatch. The original Signal proof still maintains facts once and derives multiple profile-filtered products. Existing M2 catalog, structured Execution, generic content, applicability, source distinctions, staff inheritance, reports/distribution, and controlled publication remain intact. No automatic doctrine upgrade or historical artifact migration occurs.

## 30. Known limitations

- Single offline planner; attribution is local, not authenticated identity.
- Assets are capped at 10 MiB each; doctrine packages at 64 MiB. Raster images only. Imported files are data, and unsupported/executable forms are rejected.
- Tables/charts are lightweight; no formulas, pivots, macros, advanced chart designer, GIS, or freeform layout canvas. Pie visualization uses nonnegative display values; its data table preserves source values.
- Product duplication copies the selected node and its modules, not an entire subtree. Parent removal requires removing children first.
- Reset archives recoverable module content/configuration. Unresolved references in retained content may still require repair before approval.
- File attachments can be saved separately; an HTML export is not a portable bundle of arbitrary attached files. Managed images are embedded in module HTML.
- Legacy generic content remains a compatibility editor; automatic conversion and adoption are intentionally absent.
- Windows installer is unsigned. Installer wizard interaction and other operating systems were not tested.

## 31. Deferred Milestone 4+ work

No revision comparison/change review, WARNORD/FRAGO/OPLAN lifecycle, formal MDMP, GIS/symbology engine, arbitrary canvas, formula engine, executable plugins, tactical AI, cloud sync, shared editing, permissions/authentication, classification enforcement, PDF/DOCX export, automatic web doctrine updates, or automatic doctrine adoption was implemented.

## 32. Important files/modules

| Area                              | Files                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict domain and authoring       | `src/domain/modules.ts`, `doctrine-builder.ts`, `module-authoring.ts`, `model.ts`, `authoring.ts`, `invariants.ts`                                                                                                |
| Application ports/lifecycle/files | `src/application/modular-ports.ts`, `doctrine-service.ts`, `files.ts`, `service.ts`, `ports.ts`, `bridge.ts`                                                                                                      |
| Persistence                       | `src/persistence/migrations/004.sql`, `modular-store.ts`, `repository.ts`                                                                                                                                         |
| Desktop boundary                  | `src/main/files.ts`, `src/main/index.ts`, `src/preload/index.ts`                                                                                                                                                  |
| Renderer                          | `src/renderer/src/DoctrineBuilder.tsx`, `ModuleWorkspace.tsx`, `ModuleFields.tsx`, `RichEditor.tsx`, `editorRegistry.ts`, `DoctrineWorkspace.tsx`, `App.tsx`, `style.css`                                         |
| Projection/rendering              | `src/export/projections/v4.ts`, `module-render.ts`, `modular-html.ts`, `projection.ts`                                                                                                                            |
| Verification                      | `tests/milestone3.test.ts`, `tests/milestone3-edge.test.ts`, `tests/fixtures/milestone2-0.2.0.db`, `tests/fixtures/milestone3-frozen-hashes.json`, `scripts/smoke-milestone3.cjs`, `scripts/check-boundaries.cjs` |
| Configuration/docs                | `.gitignore`, `package.json`, `package-lock.json`, `vitest.config.ts`, `README.md`, `docs/milestone3-architecture.md`, this report                                                                                |

## 33. Recommended next milestone only

**Revision Comparison & Controlled Change Review.** Compare saved revisions, explain changed canonical facts and derived products, and support deliberate review against a published baseline. This is a recommendation only. No Milestone 4 implementation has begun.
