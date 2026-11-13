const fs = require("node:fs"),
  path = require("node:path");
const root = process.cwd(),
  seen = new Set(),
  records = [];
function locate(from, name) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    if (dir === path.dirname(dir)) throw Error("Missing dependency " + name);
  }
}
function visit(dir) {
  if (seen.has(dir)) return;
  seen.add(dir);
  const p = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  let names = fs
    .readdirSync(dir)
    .filter(
      (n) =>
        /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(n) &&
        fs.statSync(path.join(dir, n)).isFile(),
    );
  if (!names.length && fs.existsSync(path.join(dir, "LICENSES")))
    names = ["LICENSES"];
  let text = names
    .map((n) => fs.readFileSync(path.join(dir, n), "utf8"))
    .join("\n\n");
  if (!text) {
    const readme = fs
      .readdirSync(dir)
      .find((n) => /^readme(?:\.md|\.markdown)?$/i.test(n));
    if (readme) {
      const body = fs.readFileSync(path.join(dir, readme), "utf8");
      const start = body.search(/^(?:#{1,6}\s+)?licen[sc]e\b/im);
      if (start >= 0) text = body.slice(start);
    }
  }
  if (!text && require("node:module").isBuiltin(p.name))
    text = `Metadata-only placeholder package; uses the built-in runtime module. Declared license: ${p.license}. The runtime's notices are distributed with Electron.`;
  if (!text && p.name === "saxes" && p.version === "5.0.1")
    text =
      "Source: https://raw.githubusercontent.com/lddubeau/saxes/v5.0.1/LICENSE\n\n" +
      fs.readFileSync("docs/office-license-saxes.txt", "utf8");
  if (!text) {
    text =
      "The package supplies license metadata without a separate notice file:\n" +
      JSON.stringify(
        {
          author: p.author,
          license: p.license,
          licenses: p.licenses,
          repository: p.repository,
        },
        null,
        2,
      );
    console.log("Metadata notice: " + p.name + " " + p.version);
  }
  records.push({ name: p.name, version: p.version, license: p.license, text });
  for (const name of Object.keys(p.dependencies ?? {}))
    visit(locate(dir, name));
}
for (const name of ["docx", "pptxgenjs", "exceljs", "parse5", "yauzl"])
  visit(locate(root, name));
records.sort(
  (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
);
fs.writeFileSync(
  "docs/office-third-party-notices.txt",
  "Office exchange third-party software notices\nGenerated from installed locked production dependencies.\n\n" +
    records
      .map(
        (r) =>
          `${r.name} ${r.version} (${typeof r.license === "string" ? r.license : JSON.stringify(r.license)})\n${"=".repeat(72)}\n${r.text}`,
      )
      .join("\n\n"),
);
console.log(`${records.length} dependency notices written.`);
