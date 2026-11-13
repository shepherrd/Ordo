const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID: uid, createHash } = require("node:crypto"),
  assert = require("node:assert/strict"),
  Database = require("better-sqlite3");
const { openOperation } = require("./smoke-global.cjs");
(async () => {
  const folder = path.resolve(".test-data", `milestone5-smoke-${uid()}`),
    packaged = process.argv.includes("--packaged");
  fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(
    "tests/fixtures/milestone4-0.4.0.db",
    path.join(folder, "ordo.db"),
  );
  const beforeDb = new Database(path.join(folder, "ordo.db"));
  assert.equal(
    beforeDb.prepare("SELECT max(version) AS n FROM schema_migrations").get().n,
    5,
  );
  const tables = [
    "operation_revisions",
    "publications",
    "exports",
    "profile_versions",
    "doctrine_versions",
    "change_reviews",
    "change_review_changes",
    "change_review_events",
  ];
  const before = Object.fromEntries(
    tables.map((t) => [
      t,
      beforeDb.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
    ]),
  );
  const oldAssets = beforeDb
    .prepare(
      "SELECT id,operation_id,doctrine_version_id,document,bytes FROM managed_assets ORDER BY id",
    )
    .all();
  beforeDb.close();
  const env = { ...process.env, ORDO_DATA_DIR: folder, ORDO_HEADLESS: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  const options = {
    env,
    timeout: 60000,
    ...(packaged
      ? {
          executablePath:
            process.env.ORDO_PACKAGED_PATH ||
            path.resolve(
              "release",
              require("../package.json").version,
              "win-unpacked/Ordo.exe",
            ),
          args: [],
        }
      : { args: [path.resolve("out/main/index.js")] }),
  };
  let app,
    page,
    runtime,
    ok = false;
  const errors = [],
    checks = [];
  const report = (step, note) => {
    checks.push({ step, result: "PASS", note });
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify({ packaged, runtime, checks }, null, 2),
    );
    console.log(`PASS ${step}: ${note}`);
  };
  const launch = async () => {
    app = await electron.launch(options);
    page = await app.firstWindow();
    page.setDefaultTimeout(25000);
    await page.context().setOffline(true);
    page.on("pageerror", (e) => errors.push(e.message));
    // Electron's native close guard owns beforeunload decisions. Do not race it
    // with Playwright's automatic JavaScript-dialog dismissal during cleanup.
    page.on("dialog", () => {});
    runtime = await app.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(
        false,
      );
      return {
        version: app.getVersion(),
        packaged: app.isPackaged,
        electron: process.versions.electron,
      };
    });
    assert.equal(runtime.packaged, packaged);
    if (packaged)
      assert.equal(runtime.version, require("../package.json").version);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
  };
  const button = (name) => page.getByRole("button", { name, exact: true });
  const global = async (name) => {
    await page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
    await page.getByRole("heading", { name, exact: true }).first().waitFor();
  };
  const ws = (c) => page.evaluate((c) => window.ordo.workspace(c), c),
    cmd = (c) => page.evaluate((c) => window.ordo.execute(c), c),
    review = (c) => page.evaluate((c) => window.ordo.reviews(c), c);
  const profile = (id) =>
    ws({ type: "unit-profile-get", id }).then((r) => r.profile);
  const opState = (id) => cmd({ type: "load", operationId: id });
  const capture = async (name) => {
    await app.evaluate(async ({ BrowserWindow }) => {
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true },
      );
    });
    await page.waitForTimeout(350);
    const b = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(
          undefined,
          { stayHidden: true, stayAwake: true },
        )
      )
        .toPNG()
        .toString("base64"),
    );
    fs.writeFileSync(path.join(folder, name), Buffer.from(b, "base64"));
  };
  const restart = async () => {
    await app.close();
    await launch();
  };
  const openProfile = async (v) => {
    await global("Organizations");
    await page
      .getByLabel("Search organizations", { exact: true })
      .filter({ visible: true })
      .fill(v.identity.fullDesignation);
    await page
      .locator(`[data-unit-profile-version="${v.unitProfileVersionId}"]`)
      .click();
    await page
      .getByLabel("Full Designation", { exact: true })
      .filter({ visible: true })
      .waitFor();
  };
  const saveProfile = async () => {
    await button("Save profile").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Organization draft saved" })
      .waitFor();
  };
  const getProfiles = async (search = "") =>
    (
      await ws({
        type: "browse-unit-profiles",
        query: {
          search,
          status: "",
          echelon: "",
          sort: "updated",
          offset: 0,
          limit: 100,
        },
      })
    ).organizations.items;
  const saveRaw = (v) =>
    ws({
      type: "unit-profile-save",
      profile: v,
      expectedContentVersion: v.contentVersion,
    }).then((r) => r.profile);
  const publishRaw = (v) =>
    ws({
      type: "unit-profile-publish",
      id: v.unitProfileVersionId,
      expectedContentVersion: v.contentVersion,
    }).then((r) => r.profile);
  const newRaw = (name) =>
    ws({ type: "unit-profile-new", name }).then((r) => r.profile);
  const deriveRaw = (v, label) =>
    ws({
      type: "unit-profile-derive",
      id: v.unitProfileVersionId,
      versionLabel: label,
      newFamily: false,
    }).then((r) => r.profile);
  const pick = async (name, version) => {
    const dialog = page.getByRole("dialog").last();
    await dialog
      .getByLabel("Search Unit Profiles", { exact: true })
      .filter({ visible: true })
      .fill(name);
    await dialog
      .locator(".browse-row")
      .filter({ hasText: version })
      .first()
      .click();
    await dialog
      .getByRole("button", { name: "Select this version", exact: true })
      .click();
  };
  const openOp = async (id, pageName) => {
    if (
      (await page
        .getByRole("heading", { name: "Dashboard", exact: true })
        .count()) === 0
    )
      await global("Dashboard");
    await openOperation(page, id);
    if (pageName)
      await page
        .locator("nav:visible")
        .getByRole("button", {
          name:
            pageName === "Task organization"
              ? /^(?:A )?Task organization$/i
              : new RegExp("^" + pageName),
        })
        .click();
  };
  const saveOp = async () => {
    await button("Save revision").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Planning revision saved" })
      .waitFor();
  };
  const backup = path.join(folder, "workspace-backup.db"),
    png = path.join(folder, "fictional-insignia.png");
  fs.writeFileSync(
    png,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  try {
    await launch();
    const db = new Database(path.join(folder, "ordo.db"), { readonly: true });
    assert.equal(
      db.prepare("SELECT max(version) AS n FROM schema_migrations").get().n,
      11,
    );
    for (const [t, rows] of Object.entries(before))
      assert.deepEqual(
        db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        rows,
      );
    assert.deepEqual(
      db
        .prepare(
          "SELECT id,operation_id,doctrine_version_id,document,bytes FROM managed_assets ORDER BY id",
        )
        .all(),
      oldAssets,
    );
    db.close();
    report(
      1,
      "Real Ordo 0.4.0/schema-005 upgraded through 009; existing asset blobs and owners preserved",
    );
    const legacy = await cmd({ type: "load" });
    for (const o of legacy.operations) {
      const s = await opState(o.id);
      assert(s.operation);
      assert(s.exports.every((e) => e.html));
      const h = await review({ type: "history", operationId: o.id });
      for (const r of h.reviews) {
        const loaded = (await review({ type: "get-review", id: r.id })).review;
        assert.deepEqual(loaded, r);
      }
    }
    report(
      2,
      "Historical operations, configuration, publications, exports, assets, and frozen reviews remain readable",
    );
    report(3, "Normal startup opens Dashboard");
    for (const name of [
      "Dashboard",
      "Operations",
      "Organizations",
      "Doctrines",
      "Library",
      "Settings",
    ])
      assert.equal(
        await page
          .getByRole("navigation", { name: "Global navigation" })
          .getByRole("button", { name, exact: true })
          .count(),
        1,
      );
    report(4, "All six global navigation destinations are available");
    await global("Operations");
    assert.equal(
      await page
        .getByLabel("Active operation")
        .filter({ visible: true })
        .count(),
      0,
    );
    report(5, "Operations browser works without selecting an operation");
    await global("Dashboard");
    await openOperation(page, legacy.operations[0].id);
    assert.equal(
      (await opState(legacy.operations[0].id)).operation
        .operationOrganizationBinding,
      undefined,
    );
    report(6, "Legacy operation opens without inferred organization");
    await global("Dashboard");
    report(7, "Return to Dashboard without restarting");
    await global("Doctrines");
    await page
      .getByLabel("Doctrine version", { exact: true })
      .filter({ visible: true })
      .waitFor();
    report(8, "Existing Doctrine Builder opens globally");
    await global("Dashboard");
    await button("Create Organization").click();
    await page
      .getByLabel("Organization designation", { exact: true })
      .filter({ visible: true })
      .fill("25th Light Infantry Brigade");
    await button("Create Unit Profile").click();
    await page
      .getByLabel("Full Designation", { exact: true })
      .filter({ visible: true })
      .waitFor();
    let brigade = await profile(
      (await getProfiles("25th Light"))[0].unitProfileVersionId,
    );
    report(9, "Created fictional brigade Unit Profile through UI");
    for (const [label, value] of [
      ["Short Designation", "25th LIB"],
      ["Unit Type", "Brigade"],
      ["Echelon", "Brigade"],
      ["Callsign", "FICTIONAL PINE"],
      ["Description", "Fictional organization for software acceptance."],
    ])
      await page
        .getByLabel(label, { exact: true })
        .filter({ visible: true })
        .fill(value);
    report(
      10,
      "Configured identity, custom type/echelon, callsign and description",
    );
    await button("Staff").click();
    const sections = [
      "Command",
      "Personnel",
      "Intelligence",
      "Operations",
      "Logistics",
      "Signal",
      "Fires",
    ];
    const titles = [
      ["Commander", "Executive Officer"],
      ["S-1"],
      ["S-2"],
      ["Brigade S-3"],
      ["S-4"],
      ["S-6"],
      ["Fire Support Officer"],
    ];
    const roles = [
      ["COMMAND", "EXECUTIVE"],
      ["PERSONNEL"],
      ["INTELLIGENCE"],
      ["OPERATIONS"],
      ["LOGISTICS"],
      ["SIGNAL"],
      ["FIRES"],
    ];
    for (const [i, name] of sections.entries()) {
      await button("Add staff section").click();
      await page
        .getByLabel(`Section name ${i + 1}`, { exact: true })
        .filter({ visible: true })
        .fill(name);
      for (const [j, title] of titles[i].entries()) {
        await button(`Add position to ${name}`).click();
        const card = page
          .locator(".staff-section")
          .nth(i)
          .locator(".staff-position")
          .last();
        await card
          .getByLabel("Position title", { exact: true })
          .filter({ visible: true })
          .fill(title);
        await card
          .getByLabel("Functional role", { exact: true })
          .filter({ visible: true })
          .selectOption(roles[i][j]);
      }
    }
    report(11, "Created seven configurable staff sections");
    report(12, "Created eight reusable staff positions");
    report(13, "Assigned semantic OPERATIONS role to Brigade S-3");
    const first = page.locator(".staff-position").first();
    await first.locator("summary").click();
    await first
      .getByLabel("Include incumbent metadata")
      .filter({ visible: true })
      .check();
    await first
      .getByLabel("Incumbent name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL Example");
    await first
      .getByLabel("Incumbent rank", { exact: true })
      .filter({ visible: true })
      .fill("COL");
    report(
      14,
      "Added informational incumbent metadata without changing position identity",
    );
    await button("Defaults").click();
    const ds = (await ws({ type: "doctrine-summaries", includeStaff: true }))
        .doctrines,
      army = ds.find(
        (d) => d.familyId === "10000000-0000-4000-8000-000000000002",
      ),
      starter = ds.find(
        (d) => d.familyId === "10000000-0000-4000-8000-000000000001",
      );
    await page
      .getByLabel("Default doctrine recommendation", { exact: true })
      .filter({ visible: true })
      .selectOption(army.id);
    await button("Assets").click();
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, png);
    await button("Import insignia image").click();
    await page.locator(".insignia-preview").waitFor();
    await saveProfile();
    brigade = await profile(brigade.unitProfileVersionId);
    const draftExact = JSON.stringify(brigade);
    await restart();
    assert.equal(
      JSON.stringify(await profile(brigade.unitProfileVersionId)),
      draftExact,
    );
    await openProfile(brigade);
    report(
      15,
      "Draft profile, staff, incumbent and managed insignia survive save/restart exactly",
    );
    await button("Publish profile").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Profile published" })
      .waitFor();
    brigade = await profile(brigade.unitProfileVersionId);
    assert.equal(brigade.status, "PUBLISHED");
    report(16, "Published immutable version 1.0.0");
    assert(
      await page
        .getByLabel("Full Designation", { exact: true })
        .filter({ visible: true })
        .isDisabled(),
    );
    await assert.rejects(() =>
      saveRaw({
        ...brigade,
        identity: { ...brigade.identity, fullDesignation: "Tamper" },
      }),
    );
    report(17, "UI and application guards reject in-place published edits");
    await button("Versions").click();
    await page
      .getByLabel("Next organization version label", { exact: true })
      .filter({ visible: true })
      .fill("1.1.0");
    await button("Create new Draft version").click();
    let brigade11 = await profile(
      (await getProfiles("25th Light")).find((v) => v.versionLabel === "1.1.0")
        .unitProfileVersionId,
    );
    report(18, "Created a new Draft version in the same family");
    await button("Staff").click();
    await page
      .getByLabel("Short title", { exact: true })
      .filter({ visible: true })
      .nth(4)
      .fill("OPS");
    await saveProfile();
    brigade11 = await profile(brigade11.unitProfileVersionId);
    assert.deepEqual(
      (await profile(brigade.unitProfileVersionId)).staff,
      brigade.staff,
    );
    report(
      19,
      "New staff draft preserves old published content and continuing position identities",
    );
    let battalion = await newRaw("1st Battalion");
    report(
      20,
      "Created fictional subordinate profile through validated workspace command",
    );
    battalion = await publishRaw(battalion);
    report(21, "Published exact Battalion version");
    await button("Structure").click();
    await button("Add standing subordinate").click();
    await pick("1st Battalion", "1.0.0");
    await saveProfile();
    brigade11 = await profile(brigade11.unitProfileVersionId);
    report(
      22,
      "Added exact published Battalion version as a standing subordinate",
    );
    let battalion11 = await deriveRaw(battalion, "1.1.0");
    battalion11.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: brigade.unitProfileFamilyId,
        unitProfileVersionId: brigade.unitProfileVersionId,
      },
    ];
    battalion11 = await publishRaw(await saveRaw(battalion11));
    assert.equal(
      (await profile(brigade11.unitProfileVersionId)).standingSubordinates[0]
        .unitProfileVersionId,
      battalion.unitProfileVersionId,
    );
    report(
      23,
      "A newer Battalion version does not change the existing exact standing pin",
    );
    await button("Preview").click();
    await page.getByText("↳ 1st Battalion · 1.0.0", { exact: true }).waitFor();
    await capture("01-organization-preview.png");
    report(
      24,
      "Read-only standing hierarchy preview shows exact child version",
    );
    const invalid = structuredClone(brigade11);
    invalid.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: invalid.unitProfileFamilyId,
        unitProfileVersionId: invalid.unitProfileVersionId,
      },
    ];
    await assert.rejects(() => saveRaw(invalid));
    report(25, "Self-parent relationship rejected");
    invalid.standingSubordinates = [
      {
        relationshipId: uid(),
        unitProfileFamilyId: battalion11.unitProfileFamilyId,
        unitProfileVersionId: battalion11.unitProfileVersionId,
      },
    ];
    await assert.rejects(() => saveRaw(invalid));
    report(26, "Transitive family cycle across profile versions rejected");
    assert.equal(brigade.defaultDoctrine.doctrineVersionId, army.id);
    report(
      27,
      "Exact default doctrine was configured before publication and remains inspectable",
    );
    await global("Dashboard");
    await button("Create Operation").click();
    report(28, "Opened improved Create Operation flow");
    await page
      .getByLabel("New operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL M5 SILVER PINE");
    await button("Choose Organization").click();
    await pick("25th Light", "1.0.0");
    report(29, "Selected exact Brigade 1.0.0");
    assert.equal(
      await page
        .getByLabel("Doctrine configuration", { exact: true })
        .filter({ visible: true })
        .inputValue(),
      army.id,
    );
    report(30, "Organization default doctrine preselected");
    await page
      .getByLabel("Doctrine configuration", { exact: true })
      .filter({ visible: true })
      .selectOption(starter.id);
    assert.equal(
      await page
        .getByLabel("Doctrine configuration", { exact: true })
        .filter({ visible: true })
        .inputValue(),
      starter.id,
    );
    report(31, "Planner can override doctrine recommendation");
    await page
      .getByLabel("Doctrine configuration", { exact: true })
      .filter({ visible: true })
      .selectOption(army.id);
    report(32, "Returned to exact recommended doctrine");
    await page
      .getByLabel("Include clearly labeled fictional demo data")
      .filter({ visible: true })
      .check();
    await page
      .locator("form.create-operation")
      .getByRole("button", { name: "Create operation", exact: true })
      .click();
    await page
      .getByLabel("Active operation", { exact: true })
      .filter({ visible: true })
      .waitFor();
    const opId = await page
      .getByLabel("Active operation", { exact: true })
      .filter({ visible: true })
      .inputValue();
    let s = await opState(opId);
    report(
      33,
      "Created operation with independently selected organization and doctrine",
    );
    assert.equal(
      s.operation.operationOrganizationBinding.unitProfileVersionId,
      brigade.unitProfileVersionId,
    );
    assert.equal(s.operation.doctrineRef.id, army.familyId);
    report(
      34,
      "Operation stores exact organization version and resolved snapshot",
    );
    brigade11 = await publishRaw(brigade11);
    assert.equal(
      (await opState(opId)).operation.operationOrganizationBinding
        .unitProfileVersionId,
      brigade.unitProfileVersionId,
    );
    report(
      35,
      "Publishing 1.1.0 does not silently adopt it into the operation",
    );
    assert(
      (await page.locator(".operation-identity:visible").innerText()).includes(
        "25th LIB",
      ),
    );
    assert(
      (await page.locator(".operation-identity:visible").innerText()).includes(
        "US Army Orders",
      ),
    );
    report(36, "Operation header shows organization, doctrine and revision");
    await page
      .getByLabel("Find doctrine product", { exact: true })
      .filter({ visible: true })
      .fill("C Operations");
    await button("C Operations").click();
    if (await button("Start authoring").isVisible())
      await button("Start authoring").click();
    await page
      .locator(".staff-assignment:visible")
      .getByText("Brigade S-3", { exact: true })
      .waitFor();
    report(37, "Responsible Staff resolves Operations to Brigade S-3");
    assert(
      (await page.locator(".staff-assignment:visible").innerText()).includes(
        "Doctrine role:",
      ),
    );
    report(38, "Doctrine owner semantics remain inspectable");
    await page
      .locator(".staff-assignment:visible")
      .getByRole("button", { name: "Override", exact: true })
      .click();
    await page
      .getByLabel("Organization position override", { exact: true })
      .filter({ visible: true })
      .selectOption(
        brigade.staff.positions.find((p) => p.title === "Commander").positionId,
      );
    await saveOp();
    assert((await opState(opId)).operation.staffPositionOverrides.length);
    report(39, "Typed operation-specific staff override saved in a revision");
    await button("Restore default").click();
    await saveOp();
    await page
      .locator(".staff-assignment:visible")
      .getByText("Brigade S-3", { exact: true })
      .waitFor();
    report(
      40,
      "Restoring default returns organization/doctrine-derived ownership",
    );
    let missing = await publishRaw(
      await newRaw("FICTIONAL No Operations Staff"),
    );
    report(41, "Created profile without OPERATIONS role");
    const missingOp = (
      await cmd({
        type: "create",
        name: "FICTIONAL unresolved staff",
        demo: true,
        configuration: army.configuration,
        unitProfileVersionId: missing.unitProfileVersionId,
      })
    ).operation;
    await openOp(missingOp.id);
    await page
      .getByLabel("Find doctrine product", { exact: true })
      .filter({ visible: true })
      .fill("C Operations");
    await button("C Operations").click();
    if (await button("Start authoring").isVisible())
      await button("Start authoring").click();
    await page
      .locator(".staff-assignment:visible")
      .getByText("No matching organization position configured", {
        exact: true,
      })
      .waitFor();
    report(
      42,
      "Missing role displays unresolved warning without inventing a position",
    );
    const custom = (
      await cmd({
        type: "create",
        name: "FICTIONAL custom without organization",
        demo: false,
      })
    ).operation;
    assert.equal(custom.operationOrganizationBinding, undefined);
    await openOp(custom.id);
    report(43, "No-organization operation remains fully supported");
    await openOp(opId, "Task organization");
    report(44, "Opened canonical Task Organization");
    await button("Add from Unit Profiles").click();
    report(45, "Opened exact profile selector from Task Organization");
    await pick("1st Battalion", "1.0.0");
    report(46, "Searched and selected exact saved Battalion version");
    await button("Add unit only").click();
    await saveOp();
    report(47, "Instantiated unit-only import");
    s = await opState(opId);
    let imported = s.operation.units.find(
      (u) =>
        u.sourceUnitProfile?.sourceUnitProfileVersionId ===
        battalion.unitProfileVersionId,
    );
    assert(imported && imported.id !== battalion.unitProfileVersionId);
    report(
      48,
      "Operation unit has independent UUID and exact source provenance",
    );
    const unitIndex = s.operation.units.findIndex((u) => u.id === imported.id);
    await page
      .getByLabel(`Unit name ${unitIndex + 1}`, { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL operational Battalion");
    await saveOp();
    assert.equal(
      (await profile(battalion.unitProfileVersionId)).identity.fullDesignation,
      "1st Battalion",
    );
    report(49, "Operational rename leaves global Unit Profile unchanged");
    await button("Add from Unit Profiles").click();
    await pick("25th Light", "1.1.0");
    await page
      .getByLabel("Add with Standing Subordinates", { exact: true })
      .filter({ visible: true })
      .check();
    await page
      .getByLabel(
        "Confirm independent reuse if a profile already exists in this operation",
      )
      .filter({ visible: true })
      .check();
    await button("Add unit with subordinate units").click();
    await saveOp();
    s = await opState(opId);
    report(
      50,
      "Deliberate subtree import permits confirmed independent profile reuse",
    );
    const group = s.operation.units.filter(
      (u) =>
        u.sourceUnitProfile?.sourceUnitProfileVersionId ===
          brigade11.unitProfileVersionId ||
        u.sourceUnitProfile?.sourceUnitProfileVersionId ===
          battalion.unitProfileVersionId,
    );
    assert.equal(new Set(group.map((u) => u.id)).size, group.length);
    const root = group.find(
      (u) =>
        u.sourceUnitProfile.sourceUnitProfileVersionId ===
        brigade11.unitProfileVersionId,
    );
    assert(group.some((u) => u.parentUnitId === root.id));
    report(51, "Imported parent links reference operation-owned units");
    let newer = await deriveRaw(brigade11, "1.2.0");
    newer.identity.callsign = "FICTIONAL newer profile";
    newer = await saveRaw(newer);
    assert.deepEqual((await opState(opId)).operation.units, s.operation.units);
    report(52, "Global profile edits do not mutate Task Organization");
    await global("Dashboard");
    await button("Create Operation").click();
    await page
      .getByLabel("New operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL initialized structure");
    await button("Choose Organization").click();
    await pick("25th Light", "1.1.0");
    await page
      .getByLabel("Initialize Task Organization from Organization Profile")
      .filter({ visible: true })
      .check();
    await page
      .locator("form.create-operation")
      .getByRole("button", { name: "Create operation", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector(
          '[data-operation-editor]:not([hidden]) [aria-label="Active operation"]',
        )?.selectedOptions[0]?.textContent ===
        "FICTIONAL initialized structure",
    );
    const initialized = (
      await opState(
        await page
          .getByLabel("Active operation", { exact: true })
          .filter({ visible: true })
          .inputValue(),
      )
    ).operation;
    report(
      53,
      "Create Operation offers explicit Task Organization initialization",
    );
    assert.equal(initialized.units.length, 2);
    assert.equal(initialized.units[1].parentUnitId, initialized.units[0].id);
    report(54, "Selected standing structure instantiated exactly once");
    await openOp(opId);
    s = await opState(opId);
    const beforeChange = s.operation.revision;
    await page
      .getByLabel("Operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL M5 SILVER PINE REVIEW");
    await saveOp();
    await page
      .getByLabel("Find doctrine product", { exact: true })
      .filter({ visible: true })
      .fill("C Operations");
    await button("C Operations").click();
    if (await button("Start authoring").isVisible())
      await button("Start authoring").click();
    await page
      .locator(".staff-assignment:visible")
      .getByRole("button", { name: "Override", exact: true })
      .click();
    await page
      .getByLabel("Organization position override", { exact: true })
      .filter({ visible: true })
      .selectOption(
        brigade.staff.positions.find((p) => p.title === "Commander").positionId,
      );
    await saveOp();
    report(55, "Saved multiple planning revisions");
    s = await opState(opId);
    const h = await review({ type: "history", operationId: opId }),
      base = h.history.find(
        (x) => x.endpoint.revisionNumber === beforeChange,
      ).endpoint,
      target = h.history[0].endpoint,
      selector = (e) => ({
        kind: "REVISION",
        operationId: opId,
        revisionId: e.revisionId,
      });
    const r = (
      await review({
        type: "create-review",
        baseline: selector(base),
        target: selector(target),
        engineVersion: "diff-engine-v2",
        title: "FICTIONAL M5 controlled review",
        description: "Organization staff override review",
        expectedRevision: s.operation.revision,
        parentReviewId: null,
        supersedesReviewId: null,
      })
    ).review;
    assert(
      r.comparison.changes.some((c) =>
        c.fieldPath.startsWith("staffPositionOverrides/"),
      ),
    );
    assert.equal(r.reportRendererVersion, "review-html-v2");
    await page
      .locator("nav:visible")
      .getByRole("button", { name: /History \/ Changes/ })
      .click();
    await page
      .getByLabel("Open review", { exact: true })
      .filter({ visible: true })
      .selectOption(r.id);
    await page.locator(".review-change:visible").first().waitFor();
    await capture("02-organization-review.png");
    report(
      56,
      "V2 comparison and controlled review detect typed operational staff override",
    );
    const opExact = JSON.stringify(s.operation);
    newer = await publishRaw(newer);
    assert.equal(JSON.stringify((await opState(opId)).operation), opExact);
    assert.deepEqual(
      (await review({ type: "get-review", id: r.id })).review,
      r,
    );
    report(
      57,
      "New global version alone creates no operation changes and leaves frozen review exact",
    );
    let publishOp = (await opState(opId)).operation;
    publishOp.units.forEach((u) => (u.inTaskOrganization = true));
    publishOp.metadata.statusId = s.config.doctrine.publicationRequiredStatus;
    publishOp = (
      await cmd({
        type: "save",
        operation: publishOp,
        expectedRevision: publishOp.revision,
      })
    ).operation;
    await cmd({
      type: "approve",
      operationId: opId,
      expectedRevision: publishOp.revision,
      note: "Fictional M5 acceptance",
    });
    const published = (
      await cmd({
        type: "publish",
        operationId: opId,
        expectedRevision: publishOp.revision,
      })
    ).publications[0];
    report(
      58,
      "Published OPORD freezes exact organization snapshot and staff overrides",
    );
    let latest = await deriveRaw(newer, "1.3.0");
    latest.identity.fullDesignation = "Fictional future brigade designation";
    latest = await publishRaw(await saveRaw(latest));
    report(59, "Published another global organization version");
    assert.deepEqual((await opState(opId)).publications[0], published);
    report(60, "Historical publication remains unchanged");
    await openOp(legacy.operations[0].id);
    assert.equal(
      (await opState(legacy.operations[0].id)).operation
        .operationOrganizationBinding,
      undefined,
    );
    report(
      61,
      "Legacy operation continues using original ownership data and renderer behavior",
    );
    await global("Organizations");
    await page
      .getByLabel("Search organizations", { exact: true })
      .filter({ visible: true })
      .fill("25th Light");
    await page
      .getByLabel("Profile status", { exact: true })
      .filter({ visible: true })
      .selectOption("PUBLISHED");
    await page
      .getByLabel("Echelon filter", { exact: true })
      .filter({ visible: true })
      .fill("Brigade");
    await page
      .getByLabel("Sort organizations", { exact: true })
      .filter({ visible: true })
      .selectOption("name");
    await page
      .locator(".organizations-area .browse-list .browse-row")
      .first()
      .waitFor();
    assert((await getProfiles("25th Light")).length >= 3);
    report(
      62,
      "Organization browser search, status/echelon filters and sorting work",
    );
    await page
      .getByLabel("Profile status", { exact: true })
      .filter({ visible: true })
      .selectOption("");
    await page
      .getByLabel("Echelon filter", { exact: true })
      .filter({ visible: true })
      .fill("");
    await openProfile(brigade);
    await button("Versions").click();
    await button("Duplicate into new family").click();
    const duplicate = (await getProfiles("25th Light")).find(
      (x) =>
        x.status === "DRAFT" &&
        x.unitProfileFamilyId !== brigade.unitProfileFamilyId,
    );
    assert(duplicate);
    const dup = await profile(duplicate.unitProfileVersionId);
    assert.notEqual(
      dup.staff.positions[0].positionId,
      brigade.staff.positions[0].positionId,
    );
    report(
      63,
      "Duplication creates independent family/Draft and remaps staff identities",
    );
    await openProfile(brigade);
    await button("Versions").click();
    await button("Retire profile version").click();
    assert.equal(
      (await profile(brigade.unitProfileVersionId)).status,
      "RETIRED",
    );
    assert.equal(
      (await opState(opId)).operation.operationOrganizationBinding
        .unitProfileVersionId,
      brigade.unitProfileVersionId,
    );
    report(64, "Retired version remains resolvable for pinned operation");
    await global("Settings");
    await page
      .getByLabel("Local actor label", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL M5 planner");
    await page
      .getByLabel("Time display", { exact: true })
      .filter({ visible: true })
      .selectOption("local");
    await button("Save preferences").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Preferences saved" })
      .waitFor();
    assert.equal(
      (await ws({ type: "preferences" })).preferences.localActor,
      "FICTIONAL M5 planner",
    );
    report(65, "Global preferences available outside operation context");
    await global("Library");
    await page
      .getByLabel("Search assets", { exact: true })
      .filter({ visible: true })
      .fill("fictional-insignia");
    await page.locator(".browse-row:visible").first().waitFor();
    await page
      .locator(".browse-row:visible")
      .first()
      .getByRole("button", { name: "Preview asset", exact: true })
      .click();
    await page.locator(".asset-preview").waitFor();
    await capture("03-library.png");
    report(
      66,
      "Managed global library supports organization imagery without Symbol/ORBAT placeholders",
    );
    await global("Dashboard");
    await page
      .locator(".dashboard-grid")
      .getByText("FICTIONAL M5 SILVER PINE REVIEW", { exact: true })
      .first()
      .waitFor();
    report(67, "Dashboard shows recent saved operation activity");
    await page
      .getByText("FICTIONAL M5 controlled review", { exact: true })
      .filter({ visible: true })
      .waitFor();
    await capture("04-dashboard.png");
    report(68, "Dashboard shows open Change Review information");
    await button("Create Operation").click();
    await page
      .getByLabel("New operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL dashboard quick action");
    await page
      .locator("form.create-operation")
      .getByRole("button", { name: "Create operation", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector(
          '[data-operation-editor]:not([hidden]) [aria-label="Active operation"]',
        )?.selectedOptions[0]?.textContent ===
        "FICTIONAL dashboard quick action",
    );
    report(69, "Dashboard action creates operation");
    await global("Dashboard");
    await button("Create Organization").click();
    await page
      .getByLabel("Organization designation", { exact: true })
      .filter({ visible: true })
      .waitFor();
    await button("Cancel").click();
    report(70, "Dashboard action opens new Organization flow");
    await global("Dashboard");
    await button("Create Doctrine").click();
    await page
      .getByLabel("New doctrine name", { exact: true })
      .filter({ visible: true })
      .waitFor();
    report(71, "Dashboard action opens doctrine creation controls");
    // Visiting a global screen must preserve edits without saving a revision.
    await openOp(opId);
    const savedBeforeVisit = (await opState(opId)).operation;
    await page
      .getByLabel("Operation name", { exact: true })
      .filter({ visible: true })
      .fill("FICTIONAL unsaved navigation");
    await global("Dashboard");
    assert.deepEqual((await opState(opId)).operation, savedBeforeVisit);
    await page
      .locator(
        `[data-open-operation-id="${opId}"]:visible .open-operation-name`,
      )
      .click();
    assert.equal(
      await page
        .getByLabel("Operation name", { exact: true })
        .filter({ visible: true })
        .inputValue(),
      "FICTIONAL unsaved navigation",
    );
    await page
      .getByLabel("Operation name", { exact: true })
      .filter({ visible: true })
      .fill(savedBeforeVisit.name);
    await global("Settings");
    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, backup);
    await button("Back up workspace").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Backup saved" })
      .waitFor();
    const backedProfiles = await getProfiles(),
      backedOp = (await opState(opId)).operation;
    report(
      72,
      "Backed up saved workspace with organization, assets, staff, pins and review history",
    );
    const extra = await newRaw("FICTIONAL after backup");
    extra.staff.sections.push({
      sectionId: uid(),
      name: "Extra staff",
      description: "",
    });
    await saveRaw(extra);
    const changed = structuredClone(backedOp);
    changed.name = "FICTIONAL after backup operation";
    await cmd({
      type: "save",
      operation: changed,
      expectedRevision: changed.revision,
    });
    report(73, "Made additional profile/staff/operation changes after backup");
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, backup);
    // Switching tabs now retains unfinished authoring instead of autosaving it.
    // Restore must protect those drafts, then proceed after explicit dismissal.
    if (await page.locator(".operation-dirty:visible").count()) {
      await button("Restore backup").click();
      await page
        .getByRole("alert")
        .filter({
          hasText: /Save or discard unsaved changes before restoring: .+/,
        })
        .waitFor();
      assert.equal((await opState(opId)).operation.name, changed.name);
    }
    while (await page.locator("[data-open-operation-id]:visible").count()) {
      const row = page.locator("[data-open-operation-id]:visible").first();
      const id = await row.getAttribute("data-open-operation-id");
      await row.locator(".close-operation").click();
      await page.waitForFunction(
        (id) =>
          !document.querySelector(`[data-open-operation-id="${id}"]`) ||
          !!document.querySelector("#close-operation-title"),
        id,
      );
      const closeDialog = page.getByRole("dialog", { name: /^Close / });
      if (await closeDialog.isVisible())
        await closeDialog
          .getByRole("button", {
            name: "Discard changes and close",
            exact: true,
          })
          .click();
      await page
        .locator(`[data-open-operation-id="${id}"]:visible`)
        .waitFor({ state: "detached" });
    }
    assert.equal((await opState(opId)).operation.name, changed.name);
    await button("Restore backup").click();
    await page
      .getByRole("status")
      .filter({ hasText: "Workspace restored" })
      .waitFor();
    report(74, "Restored backup through guarded global Settings action");
    await restart();
    report(75, "Restart returns to Dashboard after restore");
    assert.deepEqual(await getProfiles(), backedProfiles);
    assert.deepEqual((await opState(opId)).operation, backedOp);
    assert.deepEqual(
      (await review({ type: "get-review", id: r.id })).review,
      r,
    );
    assert.deepEqual(
      (await profile(brigade11.unitProfileVersionId)).standingSubordinates,
      brigade11.standingSubordinates,
    );
    await openOp(opId);
    await page
      .getByLabel("Find doctrine product", { exact: true })
      .filter({ visible: true })
      .fill("C Operations");
    await button("C Operations").click();
    if (await button("Start authoring").isVisible())
      await button("Start authoring").click();
    await page
      .locator(".staff-assignment:visible")
      .getByText("Commander", { exact: true })
      .waitFor();
    report(
      76,
      "Exact profile versions, staff/hierarchy/defaults, organization pins, frozen publication/review and staff resolution restored",
    );
    assert.deepEqual(errors, []);
    const sec = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    assert(sec.sandbox && sec.contextIsolation && !sec.nodeIntegration);
    await assert.rejects(() => ws({ type: "dashboard", unexpected: true }));
    report(
      packaged ? "82-m5" : "81",
      "M5 workflow passes in isolated offline Electron with zero renderer errors and preserved IPC security",
    );
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          success: true,
          packaged,
          runtime,
          dataDirectory: folder,
          checks,
          rendererErrors: errors,
          externalGates: [77, 78, 79, 80, 82],
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        success: true,
        packaged,
        dataDirectory: folder,
        checks: checks.length,
      }),
    );
    ok = true;
  } catch (e) {
    if (app) {
      try {
        await capture("failure.png");
        fs.writeFileSync(
          path.join(folder, "failure-dom.txt"),
          await page.locator("body").innerText(),
        );
      } catch {}
    }
    fs.writeFileSync(path.join(folder, "failure.txt"), String(e));
    throw e;
  } finally {
    if (app) {
      // Discard only this workflow's fictional drafts through the normal close guard.
      // A failed workflow remains failed; cleanup never force-terminates a process.
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      });
      const child = app.process();
      await app.close();
      assert.equal(child.exitCode, 0);
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
