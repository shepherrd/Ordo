# Milestone 1 acceptance walkthrough

Use fictional data only. Start a fresh instance and choose **Explore fictional demo**.

1. Open **Signal data**. Change **Channel / frequency 1** to `DEMO REVIEW CHANNEL`, then **Save revision**.
2. Open **Base order → Full OPORD preview**. The Signal section contains that value and the detailed architecture/spectrum/maintenance notes.
3. Open **Export studio → Communications card**. Its read-only preview contains `DEMO REVIEW CHANNEL` but excludes those detailed notes.
4. Uncheck **Channel** under Net fields. The channel disappears from the preview. Generate an export; it retains the new profile version and excludes the channel in saved HTML.
5. Recheck **Channel**, select **DEMO UNIT A** and **DEMO PHASE I**, and generate again. Only the matching command net appears. The second artifact records the exact new profile version.
6. Open **Validation**. The deliberately seeded finding explains that DEMO UNIT B participates in a net but is not in task organization. Open **Task organization**, include DEMO UNIT B, and save.
7. Return to **Overview** to select the operation in the inspector. Set **Workflow status → Approved**, then save. Open **Publications**, enter a **Revision approval note**, and click **Approve Revision N**. Confirm the approval names revision N and shows its local actor, time, scope, note, and stable ID.
8. In **Publications**, publish the OPORD snapshot. Inspect its source revision, publication version, exact approval ID, resolved configuration, and timestamp. Publishing is disabled until the revision has its own explicit approval.
9. Edit the first Signal channel again and save. The planning state returns to Draft and the new revision has no approval. The earlier approval remains visible in history. The live card and full order reflect the new channel; the published snapshot retains `DEMO REVIEW CHANNEL`. The generated card that included the channel becomes Outdated. The artifact that excluded it remains unchanged unless another selected dependency changed.
10. Back up the workspace from **Configuration**. Make another saved edit, then restore the backup. Confirm the old data and publication/export/approval history return. Close and reopen the app; the restored workspace persists.

## Additional acceptance

11. Open **Timeline** and observe DEMO H-HOUR at 14:00 UTC with DEMO REVIEW at +60 minutes. Change H-HOUR to 18:00 UTC once and save. Timeline resolves 18:00/19:00; the live Full OPORD shows the same times. View the published snapshot: it retains 14:00/15:00.
12. Generate a current Communications Card with DEMO UNIT A / DEMO PHASE I and all matching nets. Add a fictional net in Signal with that participant and phase. Save. The live card includes it and the old artifact becomes Outdated with `selection/radio-nets` among its changed dependencies.
13. The integration suite seeds a second fictional operation and rejects foreign task, unit, objective, phase, event, net, PACE, and attachment links without partial saves.
14. The suite demonstrates that approval N survives editing, cannot authorize N+1, and a new explicit approval is required.
15. The suite retains v1 projection semantics while v2 exists; renderer-only changes remain operationally current and unsupported projection versions report a separate compatibility state.

## Automated checks

The Vitest suite exercises configuration schemas, stable identity, hierarchy constraints, relative event resolution, cross-object findings, cross-operation foreign keys, transactional rollback, revision conflicts, immutable history, publication prerequisites/supersession, exact profile versions, export exclusions, dependency changes, backup validation, and HTML escaping.

The Playwright Electron smoke test drives the real desktop UI and IPC bridge with an isolated database. It covers source editing, live derivation, field selection, profile versions, publication, staleness, approval invalidation, HTML file saving, backup/restore, renderer isolation, and reopening persisted state. Only native dialogs are stubbed to paths inside the isolated test folder; database and filesystem operations are real.

Run `npm run smoke -- --packaged` after packaging to exercise the shipped executable with no development server. Screenshots and generated files are retained in the reported `.test-data/smoke-*` folder.
