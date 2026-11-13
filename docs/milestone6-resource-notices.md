# Ordo symbol and ORBAT resources

Ordo 1.0.0 includes the following resources.

- The archived-record reader uses `@noble/hashes@2.4.0` under the MIT license. Its notice is in `milestone6-third-party-notices.txt`.
- `milsymbol@3.0.4`, `milstandard-e@0.2.14`, `mil-std-2525@0.2.5` and `flag-icons@7.5.0`: MIT notices are retained in `milestone6-third-party-notices.txt`.
- Crosswalk targets verified against `@orbat-mapper/convert-symbology@1.0.2`: MIT, copyright Kjell Magne Fauske. Its mapping data credits Esri's Joint Military Symbology Markup Language project (Apache-2.0). Both license texts are retained in `milestone6-crosswalk-third-party-notices.txt`. Ordo uses a static inspected subset, with its own strict read-only preview; it does not use the upstream closest-match converter. Only mappings verified against the licensed data are enabled.
- NATO replacement flag: [Wikimedia Commons, Flag of NATO.svg](https://commons.wikimedia.org/wiki/File:Flag_of_NATO.svg), revision 6 September 2024, current revision by Kwamikagami. Source SHA-256 `81e92b6f2a5223a43089f30717f51619b0abcc160b96b52696a69a3e10dd0533`. The source states public-domain status in the United States because copyright was not renewed; this is not a claim about other jurisdictions or insignia restrictions. Ordo changes only intrinsic dimensions to an equivalent viewBox and a static fill style to an attribute.
- `ordo-arial-advances-v1`: independently captured advance-width measurements from the installed Arial regular/bold fonts, with exact font hashes and method in the resource. Font files and outlines are not bundled. SVG text still uses installed fonts; PNG exports retain the rasterizer/font provenance. Font fallback and kerning can differ across machines.
- AIA-authored FM catalog and reviewed layout/compatibility behavior: direct rights-holder authorization is recorded in `milestone6-provenance.json`. This does not supersede third-party rights. Unresolved crosswalk attribution remains explicitly open.

The installer includes these notices and the resource provenance manifest in `resources/licenses`.
