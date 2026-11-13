// Build-time only: exact licensed packages become separately hashed resources.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve("src/rendering/resources");
fs.mkdirSync(root, { recursive: true });
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const metadata = require("milstandard-e").ms2525e;
if (
  require("milstandard-e/package.json").version !== "0.2.14" ||
  require("flag-icons/package.json").version !== "7.5.0"
)
  throw Error("Resource version mismatch");
const metadataText = JSON.stringify(metadata);
fs.writeFileSync(path.join(root, "metadata-0.2.14.json"), metadataText + "\n");
const countries = require("flag-icons/country.json"),
  flags = {};
for (const c of countries) {
  const svg = fs.readFileSync(
    path.join("node_modules/flag-icons", c.flag_4x3),
    "utf8",
  );
  if (
    /<(?:script|foreignObject|image|iframe|style)\b|\son[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?!#)|url\(\s*["']?(?!#)/i.test(
      svg,
    )
  )
    throw Error(`Unexpected active flag resource ${c.code}`);
  flags[c.code.toUpperCase()] = { name: c.name, svg, sha256: sha(svg) };
}
const flagText = JSON.stringify(flags);
fs.writeFileSync(path.join(root, "flags-7.5.0.json"), flagText + "\n");
const resources = {
  schemaVersion: 1,
  metadata: { release: "milstandard-e@0.2.14", hash: sha(metadataText) },
  flags: {
    id: "flag-icons@7.5.0-4x3",
    hash: sha(flagText),
    license: "MIT",
    source: "https://github.com/lipis/flag-icons/tree/v7.5.0",
    entries: Object.keys(flags).length,
  },
};
fs.writeFileSync(
  path.join(root, "resource-manifest.json"),
  JSON.stringify(resources, null, 2) + "\n",
);
const notices = ["milsymbol", "milstandard-e", "mil-std-2525", "flag-icons"]
  .map(
    (name) =>
      name +
      "\n" +
      fs.readFileSync(path.join("node_modules", name, "LICENSE"), "utf8"),
  )
  .join("\n\n-----\n\n");
fs.writeFileSync("docs/milestone6-third-party-notices.txt", notices);
console.log(
  JSON.stringify({
    metadataHash: resources.metadata.hash,
    flagHash: resources.flags.hash,
    flags: resources.flags.entries,
  }),
);
