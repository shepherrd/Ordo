// Explicit build-time measurement of installed font metrics, not font redistribution.
// hmtx advances are independent of canvas, display, GPU, kerning and OS text layout.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
function capture(file) {
  const b = fs.readFileSync(file),
    u16 = (o) => b.readUInt16BE(o),
    u32 = (o) => b.readUInt32BE(o),
    i16 = (o) => b.readInt16BE(o);
  const tables = {};
  for (let i = 0; i < u16(4); i++) {
    const o = 12 + 16 * i;
    tables[b.toString("ascii", o, o + 4)] = {
      offset: u32(o + 8),
      length: u32(o + 12),
    };
  }
  for (const k of ["head", "hhea", "hmtx", "cmap"])
    if (!tables[k]) throw Error("Required font table missing: " + k);
  const em = u16(tables.head.offset + 18),
    metrics = u16(tables.hhea.offset + 34),
    map = tables.cmap.offset;
  let cmap;
  for (let i = 0; i < u16(map + 2); i++) {
    const o = map + 4 + 8 * i,
      sub = map + u32(o + 4);
    if (u16(sub) === 4 && (u16(o) === 0 || (u16(o) === 3 && u16(o + 2) === 1)))
      cmap = sub;
  }
  if (!cmap) throw Error("Unicode BMP cmap required");
  const segments = u16(cmap + 6) / 2,
    end = cmap + 14,
    start = end + 2 * segments + 2,
    delta = start + 2 * segments,
    range = delta + 2 * segments;
  function glyph(code) {
    for (let i = 0; i < segments; i++) {
      if (code > u16(end + 2 * i)) continue;
      if (code < u16(start + 2 * i)) return 0;
      const d = i16(delta + 2 * i),
        r = u16(range + 2 * i);
      let g = r
        ? u16(range + 2 * i + r + 2 * (code - u16(start + 2 * i)))
        : code;
      return g ? (g + d) & 65535 : 0;
    }
    return 0;
  }
  const widths = {};
  for (let code = 32; code <= 1279; code++) {
    const g = glyph(code);
    if (g)
      widths[String.fromCodePoint(code)] =
        u16(tables.hmtx.offset + 4 * Math.min(g, metrics - 1)) / em;
  }
  return {
    fontSha256: crypto.createHash("sha256").update(b).digest("hex"),
    widths,
  };
}
const dir = path.join(process.env.WINDIR || "C:/Windows", "Fonts");
const profile = {
  schemaVersion: 1,
  id: "ordo-arial-advances-v1",
  fontFamily: "Arial",
  method:
    "Unicode BMP cmap and hmtx advance width divided by head unitsPerEm; no kerning; codepoints 32-1279",
  fallback: 1,
  regular: capture(path.join(dir, "arial.ttf")),
  bold: capture(path.join(dir, "arialbd.ttf")),
};
fs.writeFileSync(
  "src/rendering/resources/arial-metrics-v1.json",
  JSON.stringify(profile, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    id: profile.id,
    regularCharacters: Object.keys(profile.regular.widths).length,
    boldCharacters: Object.keys(profile.bold.widths).length,
    regularFont: profile.regular.fontSha256,
    boldFont: profile.bold.fontSha256,
  }),
);
