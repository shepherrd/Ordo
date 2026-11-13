const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("@babel/parser");
const allowed = {
  domain: ["domain"],
  application: ["application", "domain", "export", "validation"],
  validation: ["validation", "domain"],
  export: ["export", "domain"],
  config: ["config", "domain"],
  demo: ["demo", "domain"],
  renderer: ["renderer", "domain", "application", "export", "validation"],
  preload: ["preload", "application"],
  rendering: ["rendering", "domain", "application", "export", "validation"],
};
const externals = {
  domain: ["zod", "@noble/hashes/sha2.js", "@noble/hashes/utils.js"],
  application: ["zod"],
  validation: [],
  export: [],
  config: [],
  demo: [],
  renderer: [
    "react",
    "react-dom", // UI portals; remains forbidden outside the renderer.
    "react-dom/client",
    "@tiptap/react",
    "@tiptap/core",
    "@tiptap/starter-kit",
  ],
  preload: ["electron"],
  rendering: ["milsymbol", "zod", "node:crypto"],
};
function checkSource(file, source) {
  const layer = path
    .relative(path.resolve("src"), path.resolve(file))
    .split(path.sep)[0];
  if (!allowed[layer]) return 0;
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    createImportExpressions: true,
  });
  let count = 0;
  const check = (node) => {
    if (!node || node.type !== "StringLiteral")
      throw Error(`Computed module import forbidden in ${file}`);
    const spec = node.value;
    if (spec.startsWith(".")) {
      const target = path
        .relative(
          path.resolve("src"),
          path.resolve(path.dirname(file), spec.split("?")[0]),
        )
        .split(path.sep)[0];
      if (!allowed[layer].includes(target))
        throw Error(`Boundary violation in ${file}: ${spec}`);
    } else if (!externals[layer].includes(spec))
      throw Error(`Boundary violation in ${file}: ${spec}`);
    count++;
  };
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (file.replaceAll("\\", "/").includes("/rendering/orbat-layout/")) {
      if (
        node.type === "Identifier" &&
        [
          "Date",
          "document",
          "window",
          "process",
          "globalThis",
          "performance",
          "crypto",
          "require",
          "fetch",
        ].includes(node.name)
      )
        throw Error(`Impure layout dependency in ${file}: ${node.name}`);
      if (
        node.type === "MemberExpression" &&
        node.object?.name === "Math" &&
        (node.property?.name === "random" || node.property?.value === "random")
      )
        throw Error(`Random layout state forbidden in ${file}`);
      if (
        node.type === "ImportDeclaration" &&
        !node.source.value.startsWith(".")
      )
        throw Error(`External layout dependency forbidden in ${file}`);
    }
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
      ].includes(node.type) &&
      node.source
    )
      check(node.source);
    if (node.type === "ImportExpression") check(node.source);
    if (node.type === "TSImportType") check(node.argument);
    if (node.type === "TSExternalModuleReference") check(node.expression);
    if (
      node.type === "CallExpression" &&
      (node.callee?.type === "Import" ||
        (node.callee?.type === "Identifier" && node.callee.name === "require"))
    )
      check(node.arguments[0]);
    for (const [key, value] of Object.entries(node))
      if (
        !["loc", "start", "end", "extra", "comments", "tokens"].includes(key)
      ) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") walk(value);
      }
  };
  walk(ast);
  return count;
}
if (require.main === module) {
  let count = 0;
  for (const layer of Object.keys(allowed))
    for (const file of fs
      .readdirSync(path.join("src", layer), { recursive: true })
      .filter((f) => /\.tsx?$/.test(f))) {
      const target = path.join("src", layer, file);
      count += checkSource(target, fs.readFileSync(target, "utf8"));
    }
  console.log(
    `Architecture boundaries verified (${count} module references; static, dynamic, require, and type imports).`,
  );
}
module.exports = { checkSource };
