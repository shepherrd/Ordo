# Office exchange

For 1.0.0, open **Export studio**, choose a profile and source, select **Word (.docx)** under **File format**, and choose **Export Word**. To convert an earlier order, open **Word / PDF / print** on its generated product. Retained DOCX copies are available under **Saved Word exports**. Spreadsheet import and PowerPoint briefings are deferred. Previously imported records stay in their operations.

Delivery 4 of the connected planning plan, implemented on 19 October 2026. See [qualification evidence](office-exchange-evidence.json).

## Editable Office exports

**Word order (.docx)** uses the saved order created by Export Studio or a previously generated product. Its inclusion filters, exact resolved content, source revision or publication, configured header, logo, and footer remain authoritative. Choose Letter or A4 and portrait or landscape. Paragraphs, headings, rich formatting, hyperlinks, lists, planning-card text, and tables become native editable Word content. Table headings repeat across pages. The drafter's footer uses left, centre, and right text with optional page fields. Graphics are embedded images; small images retain their intrinsic size and larger images fit the page. Office pagination may differ from the retained HTML/PDF.

**PowerPoint briefing (.pptx)** uses a saved operation revision or publication. It resolves the same slide content as the briefing builder and rejects overfull source slides. Title, text, card, and graphic layouts produce editable text and shapes, with embedded graphics, the briefing footer, slide numbers, and presenter notes. Text remains editable rather than flattening the entire slide to an image. The output uses the briefing's white/green document style, independently of the interface theme.

Generate retains the Office file before **Save DOCX/PPTX** writes an external copy. Retained records contain source selection, source and content hashes, revision, generation time, local actor, library/renderer versions, and byte count. Verification reconstructs the source from saved history and verifies the retained bytes. Changing the operation or editing an external Office copy never modifies an earlier retained file. Retained files remain accessible after their editable briefing is removed. Office history currently displays format, source revision, time, and size; it does not add another approval workflow.

## Controlled spreadsheet imports (deferred)

Choose XLSX, UTF-8 CSV, or TSV, then select a worksheet and one of **Units, Tasks, Objectives, Phases, or Timeline events**. These are facts in the operation, not organization-library records. The first row supplies headings. Ordo suggests mappings by field name; the drafter can change or omit each mapping.

Blank Ordo IDs create new records. An explicit ID must match an existing record of the selected type to update it. Matching names never trigger updates; unknown IDs require correction or deliberate clearing. Unmapped fields remain unchanged. Blank mapped cells preserve existing values unless **Use blank mapped cells to clear existing values** is selected. Required values still cannot be cleared.

Preview shows new records, explicit-ID updates, unchanged rows, errors, and before/after field values. Uncheck a row to exclude it and immediately recalculate the preview. Duplicate IDs/keys, ambiguous or missing references, invalid dates/numbers, and relationship cycles prevent application. No valid subset is silently applied. **Apply import to draft** makes one undoable change; **Save revision** persists it. An operation change invalidates a prior preview. Pending mappings and previews survive navigation between operation pages, remain protected when hidden, and block workspace replacement. Applied changes participate in ordinary working-copy recovery.

Relationships accept existing IDs or exact unique names. A same-sheet `Row key` can be referenced as `@key` by a unit's parent or an event's scheduling link, including forward references. Import units, objectives, and phases before tasks/events that use them. Timeline fields include duration, assigned unit, start/finish anchor, and offset. Delimited timestamps require an explicit timezone; native Excel date cells are interpreted as UTC. Imported or updated records retain the filename, worksheet, row, and SHA-256 in their source metadata.

Limits: 10 MiB input; 20 worksheets; 1,000 data rows and 64 columns per worksheet; 40,000 characters per cell. The preview displays 40 rows per page. XLSX archives also have entry and expanded-size bounds. Encrypted/macro workbooks, workbook external-link parts, formulas, spreadsheet error cells, and merged cells are rejected with correction messages. Hyperlink display text is read without following the link. CSV formula-like strings remain literal text. General DOCX/PPTX extraction and automatic Office round-trip synchronization are outside this delivery.

## Integration and compatibility

Migration **018** adds immutable `office_exports`, including stored Office bytes and verified source metadata. Existing migrations, publication formats, retained HTML/PDF renderers, and all 69 frozen implementation files remain unchanged. Backup/restore verifies Office files; explicit permanent operation deletion includes them. The operation schema needs no new import-specific fields: imported facts use existing entities and metadata.

Domain mapping and validation are independent of Electron and React. Application contracts validate commands and select frozen sources; persistence owns retained bytes; the main process reads selected files and generates Office packages. Rendering remains offline with sandboxed, data-only graphics windows. Production dependencies are pinned, their security overrides are explicit in `package.json`, and [dependency notices](office-third-party-notices.txt) ship with the application.

The pre-delivery development tree is preserved in `.test-data/office-baseline-2026-10-19T15-25-55-291Z`. Existing uncommitted work is preserved. The application version remains 0.6.5; the separate candidate is `.test-data/office-candidate/win-unpacked/Ordo.exe`. The retained `release/0.6.5` installer was not replaced.

## Qualification

- TypeScript, build, formatting, unused-code, and architecture checks pass. All **701 tests pass**, including 26 focused Office tests. Production dependency audit reports zero known vulnerabilities. All **69 frozen hashes** match, and all **17 compiled files** match the packaged application.
- `scripts/smoke-office.cjs` qualifies normal offline development and packaged applications using isolated fictional data. It exercises real DOCX/PPTX generation and saving, CSV/XLSX imports for all five record types, mapping errors and exclusion, explicit-ID updates, undo/redo, draft recovery after injected renderer failure, hidden-import protection, backup/restore, and byte-identical Office output after normal restart.
- The existing briefing and timeline/progress desktop regressions pass on the candidate build. They cover retained PDFs, source navigation, presenter mode, overflow rejection, linked scheduling, planning readiness, recovery, and backup/restore.
- Both Office screens were inspected in all eight themes and at 1600×1100 and 1050×850. Selected tabs, field alignment, wrapping, contrast, and page-level horizontal overflow were checked.
- Actual generated DOCX and PPTX files were rendered with LibreOffice and Poppler. Every page/slide was inspected. The four-slide PPTX contains 30 editable shapes and one embedded graphic; speaker notes remain in the notes parts. An additional packaged fixture exercises native rich formatting, hyperlinks, nested lists, a logo, linked cards, an ORBAT, and a 55-row table in A4 portrait and landscape. Its extracted text includes every table row and repeated headings/footers remain readable. This is LibreOffice interoperability evidence, not a claim that every Microsoft Office version was tested.

The planning whiteboard and alternative plans are implemented; see [delivery 5](planning-whiteboard-delivery.md) and [delivery 6](alternative-plans-delivery.md). General document extraction remains deferred. The [integration polish record](connected-planning-integration-polish.md) covers saved-file freshness indicators, source previews, and the combined qualification.
