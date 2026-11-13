const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
(async () => {
  const folder = path.resolve(".test-data", "search-runtime-" + randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  const results = [];
  for (const packaged of [false, true]) {
    const env = {
      ...process.env,
      ORDO_DATA_DIR: path.join(folder, packaged ? "packaged" : "development"),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ORDO_HEADLESS;
    const app = await electron.launch({
      env,
      timeout: 60000,
      ...(packaged
        ? {
            executablePath: path.resolve(
              process.argv[2] ?? "release/0.6.5/win-unpacked/Ordo.exe",
            ),
            args: [],
          }
        : { args: [path.resolve("out/main/index.js")] }),
    });
    try {
      const page = await app.firstWindow();
      await page.context().setOffline(true);
      await page
        .getByRole("heading", { name: "Dashboard", exact: true })
        .waitFor();
      const runtime = await app.evaluate(({ app }) => {
        const createRequire = process.getBuiltinModule("module").createRequire;
        const load = createRequire(
          process
            .getBuiltinModule("path")
            .join(app.getAppPath(), "package.json"),
        );
        const Database = load("better-sqlite3");
        const db = new Database(":memory:");
        try {
          db.exec(
            "CREATE VIRTUAL TABLE probe USING fts5(body, tokenize='unicode61 remove_diacritics 2'); INSERT INTO probe(body) VALUES('38th unité planning');",
          );
          return {
            packaged: app.isPackaged,
            electron: process.versions.electron,
            sqlite: db.prepare("SELECT sqlite_version() version").get().version,
            fts5:
              db
                .prepare("SELECT count(*) n FROM probe WHERE probe MATCH ?")
                .get('"unite"*').n === 1,
          };
        } finally {
          db.close();
        }
      });
      assert.equal(runtime.fts5, true);
      results.push(runtime);
    } finally {
      const proc = app.process();
      await app.close();
      assert.equal(proc.exitCode, 0);
    }
  }
  fs.writeFileSync(
    path.join(folder, "acceptance.json"),
    JSON.stringify(
      {
        results,
        note: process.argv[2]
          ? "Final candidate runtime probe"
          : "Retained 0.6.5 baseline runtime probe",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ folder, results }));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
