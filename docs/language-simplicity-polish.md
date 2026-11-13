# Language and simplicity polish — 8 October 2026

The user authorized this pass with “Let's start with the language and simplicity pass.” It updates the **0.6.5 development build**. This is a presentation change; no database migration, catalog lifecycle change, new feature, or installer is included.

## Wording decisions

- Use sentence case for actions, and name the thing being created, saved, selected, or removed.
- Use “organization” in ordinary navigation and selection. Keep technical profile identities in expandable reference details.
- Explain the effect of an action in planning terms. Reusable items supply independent copies to an operation; edits to a saved library item do not automatically change copies already in use.
- Keep operation revision and publication language where it describes an actual planning workflow. Reusable symbols, ORBATs, organizations, and doctrines do not ask the user to publish a draft or create a version.
- Keep military terms, SIDCs, FM source references, and unsupported/conversion-loss disclosures intact. Diagnostics remain accessible; source data and stored enum values are unchanged.
- Use singular/plural counts correctly and show an empty picker range as 0–0.

## Changes

| Area                         | Examples                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organizations and symbols    | “New Unit Profile” becomes “New organization”; “Create Saved Symbol” becomes “Create symbol”; “Saved structured symbol definition” becomes “Symbol saved.”                                                                                                                                                                                   |
| ORBATs                       | “Create inline ORBAT” becomes “Create ORBAT”; “Add inline child” becomes “Add subordinate unit”; “Duplicate ORBAT family” becomes “Duplicate ORBAT.” Tray buttons say “Load into editor” and “Add subordinate.”                                                                                                                              |
| Operation symbols            | Label choices say “Use unit name,” “Use parent unit name,” “Use original symbol text,” and “Use custom text.” Editing and restoring the symbol explain their effect on this operation.                                                                                                                                                       |
| Doctrine and order authoring | Removed obsolete versioned-profile advice and milestone references. Linked facts, section configuration, inclusion choices, and fallback editors use planning language.                                                                                                                                                                      |
| Import/export                | “Dependency handling” becomes “Linked symbols and organizations.” The report uses readable action names while retaining the exact source fields and before/after values. Correction instructions distinguish invalid source fields from missing or conflicting linked items. Ordo JSON explains that it creates editable copies on reimport. |
| History and recovery         | Export, review, and recovery messages describe what is saved and what the user should do next. Recovery no longer tells reusable-library users to save an operation revision.                                                                                                                                                                |
| Navigation and settings      | Dashboard actions use consistent names. Library files have plain preview/save/delete actions. The local actor setting is labeled “Planner name.”                                                                                                                                                                                             |
| Technical details            | Definition IDs, render-profile identities, file hashes, configuration versions, and export internals move into expandable details. Exact stored references and historical rendering behavior remain intact.                                                                                                                                  |

Presentation errors reuse the existing field-aware formatter so Electron IPC wrappers do not obscure the actionable error. Validation, import acknowledgement, conflict handling, and permanent-deletion behavior remain unchanged.

## Verification

The current evidence is recorded in `language-simplicity-polish-evidence.json`. The retained regression suite and the existing catalog desktop workflow run against the current compiled development build. The desktop workflow uses an isolated fictional workspace, includes an import-screen capture, and checks normal clean exit/reopen at the unchanged 60-second lifecycle timeout.

Final results: **580 tests across 29 files and all 13 desktop checks pass**. Type checking, compilation, import boundaries (911 module references), and diff whitespace checks pass. Six current Electron captures were inspected. An earlier desktop attempt stopped at the import dropdown's accessible label; the label was corrected, the app rebuilt, and the complete desktop workflow rerun from the beginning. That earlier attempt remains failed evidence.

All application, domain, persistence, export/rendering source, migrations, and package metadata retain their pre-pass hashes. The 69 frozen historical files retain their expected hashes. Changes are confined to renderer presentation, the existing desktop workflow's labels/capture, and documentation.

The personal workspace is not opened by these checks. Earlier acceptance artifacts remain unchanged and are not used to qualify this build. No packaged or 1.0 release qualification is claimed.

## Remaining polish

Visual consistency, editing feedback, keyboard/focus behavior, Symbol/ORBAT interaction comfort, and rich-text/document layout review remain separate parts of the overall polish plan. User testing follows that initial sweep, followed by feedback fixes and qualification of the exact final build.
