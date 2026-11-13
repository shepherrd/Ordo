# Connected planning: first delivery

Implements the P0 → S1 → S2 → C1 → C2 → C3 sequence in the connected planning implementation plan. Qualification results are recorded separately in [connected-planning-evidence.json](connected-planning-evidence.json).

## Using this delivery

Choose **Search** in the global sidebar or operation header, or press **Ctrl+K**. Search defaults to the current operation when one is open. Switch to Workspace to include other current operations, organizations, doctrines, symbols, ORBATs, and file metadata. Preview a result, choose **Open source** to edit it, or **Used in** to inspect its references.

In the base order or an authored product, add a **Planning cards** module. Choose **Insert linked card**, find the source, and choose its displayed fields. **Reuse card** adds another placement of the same definition. **Edit display** changes the shared card; **Make independent copy** detaches only that placement. Save the operation normally to retain these changes.

## Contracts and boundaries

- Search indexes current operation identities, units, tasks, objectives, phases, events, Signal, nets, PACE, authored paragraphs and fields, product content, module content, file metadata, and current catalog identity/staff/symbol/ORBAT text. Linked card titles and independent card text are indexed once per definition. Linked source text is not duplicated per placement.
- Historical revisions, publications, retained export bodies, unapplied symbol fields, unaccepted recovery copies, binary contents, and the FM dictionary are excluded from ordinary search.
- Stable selectors use operation/entity IDs, paragraph keys, field/entry IDs, attachment/section IDs, module/row/column IDs, catalog/node/staff-position IDs, and asset IDs. Names and list positions are never identities. Card sources are a strict subset: an entity or one complete authored text field in the owning operation.
- The search contract allows 256 query characters, 16 distinct normalized terms, 50 results per page, and an offset up to 50,000. Normalization is Unicode NFKD, combining-mark removal, lowercase, and letter/number token prefixes. Ranking is exact title/code, heading prefixes, then body matches, with title length and stable ID tie-breaks.
- SQLite FTS5 is a disposable index. Migration 015 adds derived tables and maintenance triggers. Source writes update their owner atomically. Startup rebuild examines at most 16 owners per turn and exposes incomplete coverage. Derived tables do not participate in canonical deletion planning.
- Every loaded editor replaces its entire saved owner, including empty and deleted content. Working providers include hidden operation tabs. Saved owners are excluded before ranking; working and saved results are merged before pagination. Search never applies or saves a draft.
- Query sequence, workspace generation, saved source token, and working generation checks reject stale results. Successful restore clears providers, navigation, and remembered scope; failed/canceled restore preserves the session.
- Card definitions and placements have separate IDs. Limits are 1,000 definitions, 2,000 placements, and 40,000 resolved text characters per card. The editor displays 20 placements per page and source pickers display 50 matches.
- Independent copies retain only selected text values, copied audience/phase membership, and origin evidence (selector, content hash, and saved revision or working base revision/generation). They do not keep live source dependencies. Detaching one placement leaves other linked placements intact.
- Removing a source offers Cancel, keep cards as copies, or remove dependent cards. The source and card changes commit together to the ordinary undoable operation draft. Removing a placement alone retains its definition.
- Typed incoming references, independent origins, and catalog consumption origins are distinct. Historical usage uses versioned dependency records, never retained HTML text searches. Historical summary rows without stable source IDs explicitly report partial coverage.

## Document compatibility dispatch

| Component     | New dispatch                                      | Compatibility                                                                                                                 |
| ------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Card data     | Optional `planningCards.schemaVersion = 1`        | Existing operations need no field or rewrite.                                                                                 |
| Module        | `PLANNING_CARDS`                                  | Explicit local block; no automatic migration of authored text or doctrine layouts.                                            |
| Projection    | 6                                                 | Resolves card blocks against the supplied operation/configuration snapshot and composes them in existing module positions.    |
| Retained HTML | Envelope 7 / `html-v7`                            | Migration 016 adds the new envelope to the export guard and retains the existing branches.                                    |
| Retained PDF  | Envelope 3 / `ordo-print-v3`                      | Adapts exact retained HTML; previous print engines remain dispatched by historical version.                                   |
| Review report | `review-html-v6` with card comparison extension 1 | Existing comparison engines and their original results are retained; card changes and output impacts are additional evidence. |

Publication uses the current saved revision and approval rules. Export uses the exact saved revision or publication snapshot and recorded configuration. Included unresolved cards block output; unused or excluded unresolved definitions remain visible diagnostics. Output respects product/ancestor inclusion and audience/phase membership. Preview explains filtered cards; that explanation does not enter retained output. Card dependencies include only selected values, required labels, identities, membership, and relative-event timing inputs.

New card output uses the operation's configured document header and footer, or the ordinary document-layout defaults when no layout has been configured. Technical provenance remains in export details. Short cards stay together across page breaks; cards longer than a page can continue onto another page.

The 69 frozen implementation/resource hashes remain the historical compatibility boundary. No historical projection, renderer, print, diff engine, or migration 001–010 is rewritten.

## Reproducible qualification

- Pre-edit baseline: `.test-data/connected-planning-baseline-20261015-124816/manifest.json`, with 645 baseline tests passing.
- `scripts/probe-search-runtime.cjs` checks Unicode/prefix FTS5 behavior in normal development and packaged Electron runtimes.
- `tests/search.test.ts` covers saved extraction, literal query handling, ranking/pagination, atomic rollback, owner replacement, missing-index rebuild, typed usage, and stale navigation.
- `tests/planning-cards.test.ts` covers starter/Army preservation, whole-field resolution, independent scope/content, source deletion, limits, audience/phase filters, upstream timing, publication snapshots, retained HTML/PDF provenance, review persistence, and backup reopening.
- `scripts/smoke-connected-planning.cjs [packaged-executable]` runs offline in a fresh fictional workspace: search and focus a task, edit its working text, insert twice, detach one placement, edit/delete/cancel the source, save, generate HTML and a real PDF, exit normally, reopen, and inspect Used in. It then backs up and restores through the workspace controls, verifies retained cards/products, and checks that open providers and pre-restore search targets cannot survive the restore.
- `scripts/benchmark-connected-planning.cjs [packaged-executable]` creates 50 fictional operations with 500 tasks each, 1,000 saved symbols, and 10 dirty open operation tabs. It records actual entry count, index bytes, hardware/runtime, 32 warm samples after eight warm-ups, and dispatch-to-render timing excluding the 160 ms debounce. All eight themes are exercised through the Settings selector.
- `scripts/probe-search-rebuild.cjs capacity-fixture-folder [packaged-executable]` copies a closed fictional capacity database, removes only the derived index, and checks typing while startup rebuilds it. It verifies source-record hashes and the final entry count, and exits normally.

An existing isolated capacity fixture may be reused with `ORDO_BENCHMARK_FIXTURE`, restricted to this repository's `.test-data` directory. Qualification requires a clean exit and no renderer errors; interrupted or selector-failure runs are not acceptance evidence.

## Qualification results — 15 October 2026

- The full regression suite passes: **657 tests**. The final search/card output check also passes all **11 focused tests**. Typecheck, build, formatting, unused-code and architecture checks pass; all **69 frozen hashes** are unchanged.
- The complete connected-planning and existing multi-operation desktop workflows pass in development and packaged Electron, including normal exit/reopen and actual backup/restore. The packaged candidate contains the same **17 build files** as the tested development output.
- Search at **54,404 entries** achieves warm p95 **121.1 ms development / 122.1 ms packaged**, below the 200 ms target. Median is **21.0 / 21.1 ms**. The derived index occupies about **79.5 MiB**. Hardware: Ryzen 5 4500U, six logical processors, 7.39 GiB RAM; Electron 44.5.1.
- The separate **1,000-definition / 2,000-placement** editor opens its card list in **141 / 93 ms**, renders only **20 cards** per page, and advances pages correctly. These are fixture measurements, not guarantees for every workspace or machine.
- A full rebuild of **55,455 entries** completes about **11.5 / 11.0 seconds after launch**. The shell appears while rebuilding, at **1.46 / 1.18 seconds**. Measured input-to-frame latency during rebuilding stays below **17 ms** in both runtimes, and operation/catalog record hashes remain unchanged.
- Search and card captures were inspected across all eight themes. Actual PDF pages were rendered and inspected after correcting short-card pagination. Tests use isolated fictional workspaces; the existing release directory and user workspace are not replaced.

The old `smoke-milestone3.cjs` harness was not used as acceptance evidence: it still expects schema 11 and obsolete versioned-catalog controls. Current multi-operation coverage, the new backup/restore desktop workflow, and the complete regression suite provide the relevant checks for this delivery.

## Later deliveries and boundaries

All six planned deliveries are now implemented. Briefing slides and whiteboards are covered by [delivery 3](briefing-builder-delivery.md) and [delivery 5](planning-whiteboard-delivery.md). Graphical card payloads, cross-operation live cards, and collaboration remain separately scoped. See the [integration polish record](connected-planning-integration-polish.md) for the combined follow-up qualification.
