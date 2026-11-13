# Milestone 2 architecture and compatibility

## Impact plan and result

Milestone 2 adds doctrine authoring to the existing offline desktop application. It retains the domain/application/repository boundary, the original starter doctrine, and the Milestone 1 approval, publication, export, and recovery workflows. No authentication, synchronization, FRAGO, WARNORD, MDMP, GIS, PDF/DOCX, or tactical-generation features were added.

The implementation proceeded through catalog/schema, migration/applicability, tree/navigation, editor framework, base authoring, composition, preview/validation, and acceptance/packaging stages. Existing unit and Signal editors are reused. Matrix, Checklist, Generic, Report Catalog, and Distribution List are the small additional specialized editor set.

## Configuration and source provenance

`src/config/doctrine.json` remains the original schema-1 A/B/C/H dataset. `src/config/us-army-orders.json` is a separate schema-2 dataset with doctrine UUID `10000000-0000-4000-8000-000000000002`, profile key `us-army-orders`, entity version 1, and content version `1.0.0`. Its organization and echelon profiles also have separate identities. Existing operations retain their exact three profile pins. Creating an operation is the only UI path selecting a configuration; there is no implicit adoption or profile migration command.

The supplied catalog contains 185 nodes: 26 annexes, 82 appendices, 73 tabs, and 4 exhibits. Each node has a stored UUID and permanent stable key independent of display code/title. `annexCatalog` remains a compatibility index for shared Milestone 1 paths; strict validation requires its root identities, codes, and titles to agree with the schema-2 catalog. It is not a second editable catalog.

The baseline is _FM 5-0, Planning and Orders Production_, 4 November 2024, incorporating Change 1 of 8 August 2025. The supplied hierarchy was implemented without broader doctrine research. The official downloaded PDF confirms the edition/change metadata and the cited Table D-2 structure. Source reference objects retain publication title, publication identifier, edition date, change number/date, source locator, and URL. Node provenance retains the separate classes `FM5_TABLE_D2`, `FM5_SAMPLE_FORMAT`, `FUNCTIONAL_DOCTRINE`, `ORDO_DEFAULT`, and `ORGANIZATION_OVERRIDE`; ordinary UI displays readable labels.

Official source: [Army Publishing Directorate, FM 5-0 including Change 1](https://armypubs.army.mil/epubs/DR_pubs/DR_a/ARN44590-FM_5-0-001-WEB-3.pdf). Table D-2 is in Appendix D, printed pages 211–215; identified sample formats are in Appendix E.

- D1–D6 retain Table D-2 authority; D7 is a sample-format addition with a default-omitted recommendation.
- J1 Guidance and J1 Running Estimate have distinct identities and citations. At most one instantiated interpretation may be active. The other may remain explicitly omitted, preserving authored history.
- Q3 keeps its Table D-2 title; the sample-format title is an alias with its own provenance record.
- M and S children are sample-format records, not invented Table D-2 children.
- The repeated printed F2 entry is represented once, with a source note.
- O, T, X, and Y remain spares. Repurposing requires an explicit organization override in a new validated profile.

Verification found two title-wording differences: Table D-2 prints “AMD Execution Matrix” (I1) and “AMD Communications Architecture” (I7). The supplied expanded Air and Missile Defense titles are retained; their printed abbreviations are recorded as aliases and source notes. No hierarchy was changed. Optional descriptive metadata is deliberately sparse. Functional doctrine identifiers are reference pointers only; specialist doctrine content was not researched or implemented. `scripts/seed-doctrine.cjs` reproducibly authors the checked-in seed at development time. It never runs in the application or updates installed doctrine. Its stable keys must not be renamed to change display labels.

## Operation authoring and applicability

New profile operations use operation schema 2. They retain the same canonical Unit, Task/Purpose, Objective, Phase, Event/H-hour, Net, and PACE entities. Base authoring stores narrative and stable entity references. Attachments add `doctrineNodeId`, `applicability`, and optional typed content. All changes go through the existing revisioned aggregate save, optimistic revision check, audit record, and immutable history snapshot.

The catalog tree is a view over profile definitions plus operation state. Browsing creates no attachment records. Include/Omit/Reset or Start authoring creates only the selected product and required structural ancestors. Absence means operation **Undecided**; a doctrine default is displayed as a recommendation, not copied into a hidden operational decision. Reset preserves authored content. Children cannot be included under an omitted ancestor. Included children under an undecided ancestor receive a finding and stay out of the package until every ancestor is included.

Owners use an explicit operation assignment when present; otherwise children inherit their current parent owner and roots use the doctrine default. Changing a parent’s operational owner affects inherited children without modifying doctrine. Workflow and source attribution remain operation state.

The generic five-paragraph narrative editor is used for ordinary annexes. Matrix columns/rows, checklist items, generic fields, reports, distribution recipients, and End State fields have stable UUIDs. Report recipients and event timing, distribution units, base links, and generic product references point to canonical records. Annex A uses the existing unit editor. Annex H and H4A use the same Signal editor; they never create attachment-local copies of nets or PACE plans.

## Execution and legacy base content

Schema-2 base order definitions provide 22 fields/group nodes across the five paragraphs. Execution has an Intent group with narrative Purpose, a collection of canonical Key Task references, structured End State fields, narrative Concept with references, a read-only Task/Purpose view for Tasks to Subordinate Units, and narrative Coordinating Instructions with references. Intent and canonical collections reject an additional free-form task narrative.

Schema-1 operations retain the original five summaries, original editing UI, and v2 projection. There is no splitting, copying, or reinterpretation of legacy narrative. Schema-2 projection also retains any explicit base summary present, ahead of structured subparagraphs. UI and HTML preview share the operation state; preview is read-only.

## Editor registration

Core doctrine contains capability hints and format metadata, not React components or renderer names. The domain owns typed content and integrity rules. `src/renderer/src/editorRegistry.ts` maps 11 capabilities to the available presentation implementations. Unsupported hints resolve to Generic and produce an explainable warning. Collection and graphic-placeholder capabilities use generic content and references; they do not simulate a specialist editor or GIS. Editor choices are explicitly marked `ORDO_DEFAULT`.

## Package composition, publication, and projection

Package Composer combines catalog definitions, applicability, effective owner, workflow, substantive-content indicators, and validation findings. Filters cover All, Included, Omitted, Undecided, Spare, Has Issues, and By Owner. The base OPORD is always part of a complete package. Catalog presence alone is never inclusion.

New OPORD export profiles default to the live included package. An explicit selected-products mode can narrow this set. Only included products with included ancestors and matching unit/phase scope are projected. An individual product preview can show authored content regardless of package inclusion and is labeled as a planning preview.

Projection v3 implements structured base authoring and package-aware products. Milestone 1 operations still generate through v2; historical records dispatch through their recorded v1/v2/v3 implementation. `v1.ts` and `v2.ts` are unchanged byte-for-byte. V3 cards retain v2 selection behavior. Exports still freeze the exact source revision/publication, profile version, configuration, template, renderer, projection version, dependencies, and HTML. Dynamic package membership and canonical referenced values enter the dependency manifest. Ignored attachment selectors do not invalidate a live-package projection.

Composition is planning state. Publication continues to require a saved eligible revision, explicit approval bound to that revision, and no error findings. The snapshot freezes all applicability and authoring data. Subsequent inclusion changes return approved planning to Draft and leave the published snapshot and generated artifacts unchanged.

## Migration 003 and verification

Migrations 001 and 002 are untouched. Migration 003 adds an immutable version-scoped `doctrine_nodes` index with parent/profile foreign keys, plus nullable doctrine-node and applicability columns on current attachments. Legacy rows remain null. A unique index enforces one instance per operation/node. Insert/update triggers verify that relational bindings agree with the typed document and belong to the operation’s pinned doctrine. Authored content stays in the validated entity payload; structured base content stays in the operation header. Neither is duplicated into an independently editable table.

Restore validation checks the new immutable index against each stored profile, attachment index/document agreement, binding triggers, strict current/historical operation schemas, and existing publication/export provenance. Upgrade tests construct an actual schema-002 workspace and verify unchanged historical documents, profile pins, publication HTML, and projection versions after migration. Backup/restore and restart tests cover typed content and applicability alongside frozen publications and exports.

The Milestone 1 migration test fixture omits the two new nullable attachment columns when constructing schema 001 and asserts they are null before omission. Its expected migration lineage now includes 003. No existing behavioral assertion was removed.
