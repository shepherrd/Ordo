# Symbol selector correction — 9 October 2026

The reported Main function, Sector 1/2 and Common modifier 1/2 controls exposed two defects missed by the preceding polish sweep. This correction is in the compiled **0.6.5 development build**, with no installer or version change.

## Reproduction and correction

The main-function choices opened in an inline section below the visible screen. In the isolated reproduction its top was at 1,400 pixels in a 900-pixel viewport; focus stayed on the original button. The previous interaction test scrolled to the search control, so it did not establish that a person could see the result of clicking the button.

After closing Main function and opening Sector 1, React initially rendered the previous six-digit choices with the new two-digit field. `editNumericSegment` correctly rejected the mismatched width, but that exception occurred during thumbnail rendering and crashed the editor. Clearing choices in an effect was too late to protect the first render.

Each result page is now bound to its exact field, symbol set, search, page and retry request before it may render. Stale asynchronous replies are discarded. All five controls open a centered, searchable dialog with loading, empty and retry states, current-choice indication, keyboard navigation, Escape dismissal and focus restoration. The shared dialog respects an explicit initial-focus target before its fallback Cancel button.

An explicit Clear selection action resets only that field. Common modifiers retain all three digits. The UI explains that a sector and its common modifier occupy the same slot, and indicates when a common modifier is active instead of showing a misleading two-digit sector name. Existing numeric-code rules, metadata, symbol mappings and renderer profiles are unchanged.

## Verification

`node scripts/smoke-symbol-selectors.cjs` exercises all five controls sequentially, exact saved SIDC fields, clear/replace behavior, both 1500- and 1120-pixel window widths, pagination and no-match states, keyboard focus, cross-set confirmation/cancellation, live SVG equality against the saved definition, the shared Saved ORBAT editor, and normal offline clean exit/reopen. It explicitly checks selector bounds before scrolling or interacting with their contents. All nine checks pass with no renderer errors.

The build/type check, architecture boundaries and all 593 tests across 31 files pass. Final captures of the main, sector and common-modifier dialogs were visually inspected. The attached evidence records exact compiled inputs, the successful workflow and the frozen-file verification. Earlier diagnostic and unsuccessful test attempts remain separate.

This is a focused development correction, not a rerun or replacement of complete release qualification. Previous polish evidence still describes its original build. The personal workspace and installed application remain untouched. Save and close the old application, then run `npm start` from `C:\Ordo APP DEV` to use this correction.

See verification evidence.
