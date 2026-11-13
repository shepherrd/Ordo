# Planning whiteboard

For 1.0.0, saved snapshots can be inserted into the base order and attachments. The briefing destination described below is deferred.

Delivery 5 of the connected planning plan, implemented on 19 October 2026. Open an operation and choose **Whiteboards**. Qualification details are recorded in [the evidence file](planning-whiteboard-evidence.json).

## Editing

Choose **Add note** to write on the canvas. Double-click a note to edit it again. **Insert…** offers text, shapes, symbols, planning cards, and saved graphics. Select an item and choose **Edit item** for formatting and precise placement. **Boards** holds board management and canvas settings. **Expand board** fills the Ordo window.

Each operation can contain several named boards. Add notes, text, rectangles, ellipses, diamonds, saved military symbols, retained SVG/PNG graphics, and linked planning cards. Military symbols are independent pinned copies; retained ORBAT graphics retain their original export content.

Select and drag items to move them, or use the resize handle and numeric position/size fields. Shift-click selects several items. Arrow keys move a selection by one unit; Shift moves it by twenty. Optional grid snapping, position locks, layer ordering, duplicate/remove selection, pan, zoom, and fit are available. Escape cancels an in-progress drag or connector. Removing an item also removes its attached connectors. Operation Undo/Redo, explicit revision saves, and local working-copy recovery cover completed board edits.

Connectors describe the diagram only. Moving, resizing, locking, reordering, connecting, duplicating, or removing board items never changes unit hierarchy, task assignments, event schedules, or other source facts. Duplicating a board creates new layout identities while retaining its card references.

Linked cards use the same definitions and field choices as order and briefing cards. Their displayed values follow the source. **Open source** goes to the fact editor; **Make independent copy** detaches just that placement and records its copy origin. Independent values can be edited on the board. Source deletion uses the existing choice to retain independent copies or remove affected placements and connectors. Unified search opens exact boards/items, and **Used in** includes board references and recent saved snapshot captures.

The editor uses the selected interface theme. Board background, text, and item colors are document content and remain stable when the interface theme changes. The item inspector and list scroll independently. At narrow desktop widths the inspector moves below the canvas.

## Saved snapshots and document insertion

The drafter explicitly creates a snapshot from a saved operation revision or publication. It captures the resolved cards, layout, symbols, and graphics at that source. Snapshot creation rejects empty boards, missing resources, and text that does not fit its item instead of silently exporting clipped content.

Snapshots retain verified PNG bytes, a self-contained SVG, source revision/publication, source and content hashes, resource manifests, card/source identities, and renderer environment. The history indicates Current, Outdated, or Source unavailable. A removed working board does not remove its earlier snapshots.

**Insert snapshot** adds a managed PNG image to an existing order product or a new graphic slide in an existing briefing. Its caption clearly says **saved whiteboard snapshot** and includes the board name, revision, and capture time. Each insertion receives its own asset identity. Later board or source edits cannot change this image. Existing order HTML/PDF/DOCX and briefing PDF/PPTX output carries the image and caption. External PNG/SVG copies are available separately.

## Persistence and compatibility

- Optional `whiteboards` schema version 1 leaves old operation shapes unchanged.
- Migration 019 adds immutable snapshots and managed-image origin records. Backup/restore verifies the exact retained image bytes and their recorded source resources. Permanent operation deletion includes both new tables within the existing confirmation workflow.
- Disposable search format 3 includes board names, connector labels, item text, graphic labels, and planning-card titles. Search source navigation and current references reuse stable identities.
- Review renderer `review-html-v9` adds board names, canvas settings, layer order, items, and visual connectors. Prior review renderers and the 69 protected historical implementation files remain unchanged.
- `whiteboard-v1` uses versioned deterministic Arial metrics, escaped SVG text, and validated data-only images. It does not load external image resources or execute uploaded SVG.
- Limits: 12 boards per operation, 300 items and 600 connectors per board, canvases up to 3200 × 2400, 14 MiB of encoded graphic resources, 16 MiB SVG, and 10 MiB PNG. Snapshot history is paginated. Rendering deduplicates identical preview resources and limits concurrent image requests.

## Qualification

Automated coverage includes schema/identity/bounds failures, unchanged source facts, linked/independent cards, source deletion, search references, safe SVG, text overflow, 300-item rendering, revision and publication snapshots, stale-source detection, image insertion, review history, tamper rejection, backup/restore, and permanent deletion. Desktop checks exercise real mouse/keyboard editing, search, rendering, document insertion, crash recovery, all eight themes, narrow layout, backup/restore, and a 300-item board. The separate packaged candidate is checked against the compiled development files.

The retained 0.6.5 installer is unchanged. These additions are qualified in development and a separate test candidate; choosing and publishing a new release remains separate. Delivery 6 is now implemented: [alternative plans](alternative-plans-delivery.md).
