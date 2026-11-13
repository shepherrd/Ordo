# Ordo 1.0.0

Ordo is an offline Windows x64 desktop app for drafting operation orders, managing organizations and ORBATs, and exporting planning products.

## Install and start

Run **Ordo Setup 1.0.0.exe** from the release assets. See the [1.0.0 release notes](docs/release-1.0.0.md). The unsigned Windows installer includes the runtime. When upgrading an existing workspace, save your edits, use **Settings → Back up workspace**, and close Ordo before running the installer.

On the **Dashboard**, choose **Create operation** to start your own plan or **Create Testify example** to explore a fictional civil-support exercise. Each click creates an editable copy of Operation Testify with its own saved revisions. The example includes its five-paragraph order, annexes, 16 units, 24 tasks, four phases, six objectives, and 20 timeline events.

## Exchange planning files

- Open **Doctrines** and choose **Import doctrine package** to load an Ordo `.ordo-doctrine` file. **Export doctrine package** includes the selected doctrine and its managed assets.
- In **Symbols & ORBATs**, choose **Export → Ordo JSON (reimportable)** to share a saved symbol or map. In the receiving workspace, choose **Import JSON** and review the preview.
- In an operation, open **Export studio** to generate HTML, PDF, or Word products. Briefings and spreadsheet imports are deferred.

## Plan and save

Choose an organization and doctrine when creating an operation. Compatible drafts can adopt later doctrine and organization staff edits. Conflicts appear for review. Publications preserve their saved sources. Use **Tasks & objectives → Add units from ORBAT** to choose the units to task, **Timeline** to coordinate events, and **Whiteboards** to organize ideas and save snapshots for orders.

Use **Save revision** to persist planning edits. **Open operations** lists the operations currently open, each with its own draft, selected page, and undo history. Switching tabs or visiting global pages does not save changes. Close a tab with its **×** button; edited tabs offer Save and close, Discard changes and close, or Cancel. Unsubmitted review or nested-editor changes must be recorded/applied or discarded before Save and close. Saved operations remain in the Operations catalog and can be reopened. The open list returns after a normal restart. **Settings → Back up workspace** saves the complete SQLite database, including history. **Restore backup** requires dirty editors, including hidden workspaces, to be saved or discarded and pending work to finish. It verifies the candidate database before replacement, retains recovery copies of the prior workspace, and resets all editor/selection/undo state after success. Canceled or failed restore preserves the current session.

Dashboard lists recoverable local working copies and opens their exact source editor. Recovery is explicit and does not save a revision or publish changes. In Export studio, expand **Print / PDF** on a retained export, choose paper size and orientation, generate a PDF, then save or print it. New planning edits require a new saved export first.

Choose **Delete** in the Operations catalog to remove an entire operation, including its published history and retained exports. The confirmation names the item, states that removal is permanent, lists affected records, and defaults to Cancel. Closing an operation tab still only closes the tab. Saved Symbols and ORBATs offer confirmed deletion in their editors; Organization Profiles offer it under **Versions**. Custom doctrine, export profiles and unused managed files also have Delete actions. Referenced library versions and bundled doctrine remain protected. Existing backups and files exported outside the workspace remain intact.

## Develop

Version 0.6.1 includes the **Open operations sidebar**: operations stay open until explicitly closed, with independent drafts and Save/Discard/Cancel protection. See [workspace-tab behavior and verification](docs/open-operation-tabs.md). The qualified 0.6.0 release and its evidence remain unchanged in their original locations.

Requires Node.js 24 or newer and npm. Dependency installation and the first Electron download need internet access; the built application does not.

```powershell
npm ci
npm run setup:desktop
npm run dev
```

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run smoke
npm run smoke:milestone2
npm run smoke:milestone3
npm run smoke:milestone4
npm run smoke:milestone5
npm run dist
npm run smoke -- --packaged
npm run smoke:milestone2 -- --packaged
npm run smoke:milestone3 -- --packaged
npm run smoke:milestone4 -- --packaged
npm run smoke:milestone5 -- --packaged
```

Historical M6 acceptance evidence is frozen. Run evidence-writing unit tests in a fresh working directory when preserving an existing `.test-data` capture set. Final M6 qualification uses the complete schema-3 runner, `node scripts/run-milestone6-regressions.cjs`, followed by `--packaged --development-evidence <matching-complete-manifest>` with `ORDO_PACKAGED_PATH` set to the exact candidate.

`npm run package` creates only the unpacked Windows application. `npm run dist` also creates the NSIS installer. Smoke tests launch a hidden desktop instance using fictional data and store screenshots under `.test-data`.

Versions are pinned in `package-lock.json`. Vite 7 is used because electron-vite 5 declares support through Vite 7. `better-sqlite3` 13 supplies a Node-API prebuilt binary that works in both the tested Node runtime and Electron; packaging preserves that binary and disables redundant native rebuilding. Reverify the packaged smoke test when upgrading Electron or SQLite dependencies.

## Historical milestone walkthroughs

The following walkthroughs describe earlier releases. Some labels and library workflows have since changed.

### Milestone 1 workflow

1. Establish an operation and edit its identity and five base-order summaries.
2. Maintain units, objectives, tasks with purposes, phases, and shared timeline events.
3. Build Annex → Appendix → Tab → Exhibit relationships. Annexes A, C, and H expose task-organization, tasks, and Signal editors respectively; narrative content remains available alongside structured data.
4. Maintain radio nets, participants, phase applicability, PACE, and lost-communications instructions in **Signal data**.
5. In **Export studio**, select the full OPORD profile or communications card. Choose audience, phases, nets, fields, PACE, and lost communications. The preview is derived and read-only.
6. Save profile changes as a new version or as a separate profile. **Generate export** records the exact source revision, profile version, configuration, and dependency manifest. **Save HTML** writes the generated artifact.
7. Resolve validation errors, set the operation's workflow status to **Approved**, and save. Under **Publications**, enter a note and choose **Approve Revision N**, then publish the immutable OPORD snapshot. Workflow status alone does not constitute approval.
8. Continue planning. Editing an approved operation returns it to Draft. Historical publications stay unchanged; affected exports show **Outdated**. A later published baseline explicitly supersedes the earlier one.

Empty audience/phase/net filters mean all matching records. Empty field, paragraph, or attachment selections mean exclude those items. Select attachments individually; selecting an annex does not silently include all its descendants. Applicability without unit or phase restrictions is operation-wide. Audience selection currently matches exact units, not automatic subordinate-unit expansion.

The initial full OPORD product includes selected base paragraphs and attachments, plus structured subordinate tasks and the timeline. Selected Annex H content includes detailed Signal source data. The communications card excludes architecture, spectrum, and maintenance notes by design.

## Milestone 2 authoring workflow

1. Create an operation with **US Army Orders 1.0.0**, or open the fictional brigade fixture. Configuration is pinned at creation.
2. Use **Base order** for structured Situation, Mission, Execution, Sustainment, and Command and Signal content. Execution references canonical tasks and purposes; Key Tasks is a selection of those tasks, and End State has structured fields.
3. Browse, search, expand, and collapse the A–Z doctrine tree. Browsing does not create a document. **Include**, **Omit**, **Reset to undecided**, and **Start authoring** create only the needed planning records. Save decisions with **Save revision**.
4. Use Annex A for the canonical unit tree and Annex H/H4A for the shared Signal workspace. C3A and C3B provide matrices; C3C provides a checklist; B1 provides generic content; R provides a report catalog; Z provides a distribution list. Other products use the registered narrative, collection, generic, or graphic-reference editor.
5. Inspect source provenance, canonical/sample distinctions, owner, workflow, references, and findings. J1 alternatives cannot both be active. Spares require an explicit organization profile override before use.
6. Use **Package composer** to filter by inclusion, omission, undecided state, spare status, findings, or owner. **Package preview** includes products only when they and all their ancestors are included. A product’s own preview can show draft content independently of package inclusion.
7. In **Export studio**, OPORD profiles can use the live included package or a selected subset. Communications Card filtering, exact profile versioning, explicit revision approval, immutable publication, and staleness behavior continue unchanged.

Doctrine defaults are recommendations; an uninstantiated product is operationally Undecided. Reset keeps authored content. Missing content produces visible warnings. Publication freezes the exact saved applicability and authoring state, independently from later package changes.

## Milestone 3 doctrine and modules workflow

1. Open **Doctrine Builder**, including before creating an operation. View bundled doctrine, **Duplicate doctrine** into a new custom family, or create a new doctrine. Only Draft versions can be edited.
2. Use **General**, **Structure**, **Products / Modules**, **Staff**, **Validation**, **Preview**, and **Versions**. Give products their own codes/titles, arrange the Annex → Appendix → Tab → Exhibit hierarchy, and configure ordered module definitions. Save the draft explicitly.
3. Publish a doctrine version to freeze it. Create a new version for subsequent changes. Retirement removes a version from new-operation choices while retaining it for pinned operations. Select a published configuration in **New operation**; existing operations do not adopt later doctrine edits.
4. Author product modules directly. The library includes plain/rich text, typed key/value, tables, matrices, checklists, timelines, charts, images, galleries, file attachments, canonical references, Task Organization, Signal nets, PACE, reports, and distribution lists. Canonical modules share existing operation facts.
5. Import images/files into managed storage. Rich text supports headings, emphasis, lists, links, quotes, and managed inline images. File attachments provide **Save attachment copy**. Images and attachments survive restart and workspace backup.
6. Link charts to table and column identities, and timeline items to canonical events plus minute offsets. Editing the source updates the read-only preview. Broken references produce findings; source content is retained.
7. Add, duplicate, configure, move, or remove modules for one operation. Inherited modules show their source. **Reset layout to doctrine default** requires confirmation and retains removed/local content and prior configuration for recovery. Save these changes as a normal operation revision.
8. **Responsible Staff** shows the doctrine default or parent inheritance. Choose **Override** to change it, then **Restore doctrine default** when appropriate. Rename an operation in **Overview**; the operation UUID stays stable and published names remain frozen.
9. Export/import `.ordo-doctrine` packages in Builder. They contain the exact doctrine configuration and its managed assets, without operation content. Conflicting identities or invalid packages are rejected.
10. Use **Package composer**, product previews, and **Export studio** to review the current included package. Explicit approval and publication retain their existing workflow. Backups include all doctrine versions, assets, modules, and historical records.

Tables and charts are deliberately lightweight. Assets are limited to 10 MiB each and doctrine packages to 64 MiB. Product duplication copies the selected product and its module definitions; remove child products before removing a parent. No spreadsheet formulas, executable extensions, or automatic doctrine adoption are provided. Images support PNG, JPEG, GIF, and WebP; file imports are treated as data and never executed by Ordo.

## Foundation and limits

- Domain schemas and invariants have no Electron, React, SQL, or renderer dependencies.
- Application commands use a repository interface. SQLite and Drizzle implement that interface.
- Doctrine, organization, echelon, and export profiles are schema-validated versioned entities.
- Every planning save creates an immutable operation revision. Published content, generated exports, and profile versions cannot be rewritten, enforced by SQLite triggers. Explicitly confirmed deletion can remove a whole operation or an unreferenced library version through a narrowly authorized atomic transaction.
- Export staleness compares recorded dependencies using the artifact's recorded projection implementation. Unrelated notes do not make a card stale; newly matching nets do. Superseded publication sources are identified separately.
- Render templates have separate versioned identities. Exports record template, renderer, projection, and source/profile versions; unsupported historical projection semantics are reported separately from staleness.
- Local attribution uses the local actor label in Settings, defaulting to **Local planner**. This is not authenticated identity or a cryptographic approval signature.
- The app bundles its resources, blocks remote runtime requests, and uses a sandboxed renderer with narrow validated IPC.

WARNORD/FRAGO workflows, maps, MDMP tools, shared editing, synchronization, identity integration, fine-grained authorization, encryption, and general document extraction remain deferred. The application makes no classified-network or access-control claims.

See [architecture](docs/architecture.md) for decisions and schema details, and [acceptance walkthrough](docs/acceptance.md) for the Signal/publication demonstration.

Milestone 1 build results remain in [verification](docs/verification.md). Historical design and evidence remain in [Milestone 2 architecture](docs/milestone2-architecture.md) and the [Milestone 2 completion report](docs/milestone2-completion.md). See [Milestone 3 architecture](docs/milestone3-architecture.md) and the [Milestone 3 completion report](docs/milestone3-completion.md) for retained Milestone 3 design and acceptance results.

## Milestone 4 comparison and review workflow

1. Save planning edits, then open **History / Changes**. Choose current saved versus previous, a frozen publication baseline, or two arbitrary saved endpoints.
2. **Compare saved states** opens a read-only semantic comparison. Inspect before/after values and affected dependents, or filter by product, category and search.
3. Name the assessment and **Create Change Review**. Unsaved planning/profile edits must be saved or discarded first. The review freezes its endpoints, change set, engine versions and impact evidence.
4. Record Accepted, Rejected, Needs Changes or Noted dispositions, with notes/comments. Bulk actions require confirmation. Decisions never edit or revert the plan.
5. Use **Open current source** for ordinary authoring. Returning to History / Changes preserves the review. Save new planning revisions normally.
6. Complete after every change has a disposition. Create a separate follow-on or superseding review for later planning. Archived reviews remain available through **Show archived reviews**.
7. Preview or save the dedicated HTML review report. Backup/restore preserves exact reviews and decision/comment history.

Milestone 4 introduced additive migration 005. Its comparison, impact, and report implementations remain unchanged. See [Milestone 4 architecture](docs/milestone4-architecture.md) and [completion report](docs/milestone4-completion.md).

## Milestone 5 global workspace and organizations

1. Use Dashboard, Operations, Organizations, Doctrines, Library, and Settings without selecting an operation. Open an operation explicitly; its header shows the pinned organization, doctrine, and saved revision.
2. In Organizations, create a Unit Profile draft. Configure identity, custom type/echelon, staff sections and positions, explicit functional roles, an optional incumbent, exact standing subordinates, and a recommended doctrine. Import an optional managed insignia.
3. Publish a version to freeze it. Derive a new version to retain continuing staff identities, or duplicate into an independent family. Retire obsolete published versions without breaking existing pins.
4. Select exact published organization and doctrine versions in Create Operation. Organization is optional. Its default doctrine is a recommendation that can be overridden. **Initialize Task Organization** is a separate explicit choice.
5. In Task Organization, **Add from Unit Profiles** creates independent canonical operation units. Choose unit only or standing subtree. Duplicate imports warn and allow deliberate independent reuse. Editing the operation unit never edits its source profile.
6. Responsible Staff resolves an explicit functional role to the pinned organization's position. Missing or ambiguous mappings show warnings. Override operationally and restore the default as needed; incumbent names do not determine assignment.
7. Library browses managed operation, doctrine, and organization assets. Settings owns preferences, local actor attribution, and backup/restore. No symbol or ORBAT placeholders are introduced.
8. Organization-aware saved-state comparisons use diff/impact/report v2. Historical v1 reviews and OPORD projection versions 1–4 retain their original semantics. Global profile changes never silently change an operation or publication.

The existing doctrine configuration `organizationRef` remains distinct from Unit Profiles. Migration 006 preserves earlier snapshots and managed asset bytes. See [Milestone 5 architecture](docs/milestone5-architecture.md) and [completion report](docs/milestone5-completion.md).
