# Organization hierarchy and staff controls — 20 October 2026

The global header no longer repeats the operation creation action. Operations retains its **Create operation** button, and Dashboard retains its own creation action.

**Collapse all** is available in the organization’s **Staff & roles** editor and the read-only ORBAT staff view. It closes every section and nested role for the selected unit, then becomes **Expand all**. Collapse state stays with that unit when switching views; it does not change the saved organization or mark it as edited. The subsequent [staff-controls correction](staff-controls-and-doctrine-updates.md) also removes repeated validation warnings and preserves scroll position during linked-ORBAT refresh.

An assigned ORBAT now supplies subordinate units to its master organization. Its top unit has its own identity and staff, just like every other ORBAT unit. The master organization is selectable above the fixed diagram and remains available in the Staff unit selector. The saved ORBAT hierarchy, layout, and artwork remain linked.

When an organization is used to initialize an operation, the hierarchy is master organization → assigned ORBAT root → existing ORBAT descendants. This preserves the ORBAT’s internal relationships rather than flattening them. The snapshot cache distinguishes this structure from earlier snapshots that merged the ORBAT root with the organization. Existing operation snapshots remain unchanged.

Existing master organization information stays on the master organization. Existing organization-owned ORBAT profiles, including any retained root profile, remain attached to their original node identities.

Validation:

- Build and type checking passed.
- Organization, catalog, and search regression suites: 34 tests passed.
- Desktop organization workflow: 13 checks passed, including isolated offline save/reopen, separate master/root staff, linked structure refresh, retained personnel, keyboard selection, and Collapse all without dirtying data.
- Visually checked wide and narrow layouts in Forest, plus Operations, master selection, and collapsed staff in Charcoal.
- Formatting, unused-code checks, and architecture boundaries passed. All 69 frozen historical implementation hashes are unchanged.

Desktop evidence: `.test-data/organization-orbat-e6b2c9d2-d100-4b39-bc84-ff037b63d20c/acceptance.json` and `dark-theme-check.json`.

These checks use the development build and isolated fictional records. No installer or packaged release was replaced.

## Organization picker count correction

The shared organization picker now reads the assigned ORBAT's current unit count, including its root and all nested units, and displays its name. It no longer reports the legacy standing-relationship count for organizations with assigned ORBATs. Retained profiles do not contribute to the active count. Organizations without an assigned ORBAT continue to show their standing relationships.

Previewing an organization does not create consumption snapshots. Switching selections clears the previous preview and ignores outdated responses. The selected organization is highlighted.

Validation: 36 organization/catalog/search regression tests, 14 desktop organization checks, build/type checking, and lint passed. The final picker layout and Use organization action were checked in Forest and Charcoal. Evidence is in `.test-data/organization-orbat-d1d9a510-4312-4939-80ea-b03d0632fb27/acceptance.json` and `picker-final-check.json`.

## Application-wide organization audit

The follow-up audit found additional active paths that still relied on manual standing relationships or only on already-edited ORBAT profiles.

| Area                                              | Current behavior                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unified search                                    | Every assigned ORBAT node is searchable within its organization, including untouched nodes and the ORBAT root. Organization-owned identity and staff overrides take precedence. Detached saved profiles remain searchable and open their retained profile.            |
| Search freshness                                  | Saving an ORBAT atomically refreshes all linked organization search entries. Result tokens include the ORBAT revision, so stale results are rejected. Existing indexes rebuild automatically in bounded batches.                                                      |
| Working-copy search                               | The organization editor and its search provider share one loaded ORBAT. Unsaved local edits replace saved search entries without hiding untouched subordinate units. An inactive saved editor no longer masks newer catalog results.                                  |
| Organization listings                             | Retained manual relationships are excluded from current parent names while an assigned ORBAT supplies that organization's structure. ORBAT nodes are not matched to separate catalog organizations by name.                                                           |
| Structure validation                              | Cycle checks follow active manual relationships and stop at assigned ORBATs. Retained references still require an existing organization. Removing an assignment revalidates the reactivated manual structure, including cycles through the organization being edited. |
| Legacy Structure editor                           | Loads the direct relationships it displays, avoiding an obsolete recursive walk through inactive descendants and its separate 30-level limit.                                                                                                                         |
| Operation creation and existing-operation imports | Consumption snapshots include master organization → ORBAT root → ORBAT descendants. Legacy parent organizations can contain organizations with assigned ORBATs. The explicit “unit only” option imports only the master.                                              |
| Creating an ORBAT from an organization            | Includes the master and every active subordinate with their parent relationships, identity, symbols, and frozen staff profile references.                                                                                                                             |
| Duplication                                       | Copies organization-owned profiles independently while retaining the shared ORBAT assignment. Later personnel edits in either organization do not affect the other.                                                                                                   |
| Export, backup, deletion and recovery             | Existing operation/export snapshots retain their historical hierarchy. Backup and recovery preserve organization-owned records. Assigned ORBAT deletion and retained relationship references remain protected.                                                        |

Operation creation and import controls now say **subordinate units**, covering both assigned ORBATs and legacy manual structures.

Regression coverage includes source renames/removals, per-organization overrides, retained staff, assignment changes, stale search hits, transactional rollback, bounded index repair, mixed legacy/ORBAT hierarchies, duplication, and both operation import options. The full suite passed 728 tests across 43 files. Build/type checking and lint passed. The desktop workflow passed 16 checks, including the two new search/navigation cases, and saved/reopened without renderer errors. Wide ORBAT and narrow Staff & roles screenshots were visually checked.

Desktop evidence: `.test-data/organization-orbat-3c27b8e8-41ac-4e37-a43e-216fc4743139/acceptance.json`. This remains a development-build change; no installer was replaced.
