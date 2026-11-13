// Separate replacement resource. Never copies the unlicensed reference vector.
const fs = require("node:fs"),
  crypto = require("node:crypto");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const raw = fs.readFileSync(process.argv[2]);
if (
  sha(raw) !==
  "81e92b6f2a5223a43089f30717f51619b0abcc160b96b52696a69a3e10dd0533"
)
  throw Error("Unreviewed flag revision");
const svg = raw
  .toString()
  .trim()
  .replace('height="768" width="1024"', 'viewBox="0 0 1024 768"')
  .replace('style="fill:#004990;fill-opacity:1"', 'fill="#004990"');
const resource = {
  schemaVersion: 1,
  id: "ordo-nato-flag-replacement-v1",
  source: "https://commons.wikimedia.org/wiki/File:Flag_of_NATO.svg",
  revision: "2024-09-06T18:21:00Z",
  sourceSha256: sha(raw),
  attribution:
    "Wikimedia Commons contributors; current revision by Kwamikagami",
  copyrightStatus:
    "Public domain in the United States, as stated by the source page (PD-US-not renewed). No claim about other jurisdictions or insignia restrictions.",
  modifications:
    "Replace explicit intrinsic dimensions with the identical viewBox; replace static fill style with an equivalent fill attribute.",
  flags: {
    NATO: { name: "North Atlantic Treaty Organization", svg, sha256: sha(svg) },
  },
};
fs.writeFileSync(
  "src/rendering/resources/nato-flag-replacement-v1.json",
  JSON.stringify(resource, null, 2) + "\n",
);
console.log(JSON.stringify({ id: resource.id, sha256: sha(svg) }));
