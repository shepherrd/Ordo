// Real desktop workflow with fictional records and a normal offline lifecycle.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { fixtureOrbatUnit } = require("./fixture-orbat-unit.cjs");
(async () => {
  const folder = path.resolve(
    ".test-data",
    "organization-orbat-" + randomUUID(),
  );
  fs.mkdirSync(folder, { recursive: true });
  const env = { ...process.env, ORDO_DATA_DIR: path.join(folder, "workspace") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ORDO_HEADLESS;
  const checks = [],
    errors = [],
    events = [],
    captures = [];
  const buildFiles = fs
    .readdirSync("out", { recursive: true })
    .filter((p) => fs.statSync(path.join("out", p)).isFile())
    .sort()
    .map((p) => ({
      path: p,
      sha256: createHash("sha256")
        .update(fs.readFileSync(path.join("out", p)))
        .digest("hex"),
    }));
  let app, page, failure;
  const write = () =>
    fs.writeFileSync(
      path.join(folder, "acceptance.json"),
      JSON.stringify(
        {
          version: require("../package.json").version,
          packaged: false,
          buildFiles,
          checks,
          errors,
          events,
          captures,
          ...(failure ? { failure: String(failure) } : {}),
        },
        null,
        2,
      ),
    );
  const pass = (name) => {
    checks.push(name);
    write();
    console.log("PASS " + name);
  };
  const button = (name) =>
    page.getByRole("button", { name, exact: true }).filter({ visible: true });
  const field = (name) =>
    page.getByLabel(name, { exact: true }).filter({ visible: true });
  const call = (method, ...args) =>
    page.evaluate(({ method, args }) => window.ordo[method](...args), {
      method,
      args,
    });
  const clean = () =>
    page
      .locator('[data-workspace-busy="false"][data-workspace-dirty="false"]')
      .waitFor();
  const nav = async (name) =>
    page
      .getByRole("navigation", { name: "Global navigation" })
      .getByRole("button", { name, exact: true })
      .click();
  const graphic = () =>
    page
      .locator(
        '.organization-orbat-map .graphic-canvas[aria-busy="false"] > div > svg',
      )
      .waitFor();
  const inspector = () =>
    page.getByRole("region", { name: "Selected unit profile" });
  const overview = () => page.locator(".organization-staff-view");
  const showStaff = async () => {
    if (await button("View in ORBAT").count())
      await button("View in ORBAT").click();
    await page.getByRole("tab", { name: "Staff & roles", exact: true }).click();
    await overview().waitFor();
    assert.equal(
      await overview()
        .locator("input, textarea, select, [contenteditable=true]")
        .count(),
      0,
    );
    assert.equal(
      await overview()
        .getByRole("button", { name: /Add|Remove|Duplicate/ })
        .count(),
      0,
    );
  };
  const editStaff = async () => {
    if (!(await page.locator(".organization-staff-page:visible").count())) {
      await showStaff();
      const selectedName = await inspector().locator("h3").innerText();
      await button("Edit staff & roles").click();
      await field("Staff unit").waitFor();
      assert.equal(await inspector().locator("h3").innerText(), selectedName);
    }
    await field("Staff unit").waitFor();
    const section = inspector()
      .locator(".staff-section > .staff-disclosure-heading")
      .first();
    if (
      (await section.count()) &&
      (await section.getAttribute("aria-expanded")) === "false"
    )
      await section.click();
    const position = inspector()
      .locator(".staff-position > .staff-disclosure-heading")
      .first();
    if (
      (await position.count()) &&
      (await position.getAttribute("aria-expanded")) === "false"
    )
      await position.click();
  };
  const select = async (node) => {
    if (await button("View in ORBAT").count())
      await button("View in ORBAT").click();
    await graphic();
    await page
      .locator(`.organization-orbat-map [data-unit-id="${node}"]`)
      .click();
    await page
      .locator(".organization-orbat-map .graphic-canvas")
      .evaluate((el, id) => {
        if (el.dataset.selectedUnit !== id)
          throw Error("Node click did not select unit");
      }, node);
    assert.equal(await field("Selected unit").count(), 0);
  };
  const launch = async () => {
    events.push({ stage: "launch", at: new Date().toISOString() });
    write();
    app = await electron.launch({
      args: [path.resolve("out/main/index.js")],
      env,
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.context().setOffline(true);
    await page
      .getByRole("heading", { name: "Dashboard", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 1500, height: 1000 });
    events.push({ stage: "ready", pid: app.process().pid });
    write();
  };
  const close = async () => {
    await clean();
    const proc = app.process();
    const pids = await app.evaluate(({ app }) =>
      app.getAppMetrics().map((m) => m.pid),
    );
    await app.close();
    app = null;
    assert.equal(proc.exitCode, 0);
    for (const pid of pids) {
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
        alive = false;
      }
      assert(!alive, "Lingering process " + pid);
    }
    events.push({ stage: "fully-exited", pids });
    write();
  };
  const capture = async (name) => {
    await page
      .locator(".panel")
      .filter({ has: page.locator(".organization-orbat") })
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await graphic();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert(
      await button("Save organization").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }),
      "Save organization is outside the visible editor",
    );
    assert(
      await page
        .locator(".organization-orbat-map .graphic-canvas")
        .evaluate((el) => {
          const canvas = el.getBoundingClientRect();
          return [...el.querySelectorAll("[data-unit-id]")].every((node) => {
            const r = node.getBoundingClientRect();
            return (
              r.left >= canvas.left - 1 &&
              r.right <= canvas.right + 1 &&
              r.top >= canvas.top - 1 &&
              r.bottom <= canvas.bottom + 1
            );
          });
        }),
      "Fitted organization diagram clips a unit",
    );
    assert(
      await page
        .locator(".organization-orbat")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      "Organization panel overflows",
    );
    await page.screenshot({ path: path.join(folder, name + ".png") });
    captures.push(name + ".png");
    write();
  };
  const open = async (id) => {
    await page.locator(`[data-unit-profile-version="${id}"]`).click();
    await button("ORBAT").click();
  };
  const searchOrganizationUnit = async (name) => {
    await page.keyboard.press("Control+k");
    const dialog = page.locator('[aria-label="Search Ordo"]');
    await dialog.getByRole("textbox", { name: "Find in Ordo" }).fill(name);
    const result = dialog
      .locator(".search-result")
      .filter({ hasText: "Fictional North Division" });
    await result.waitFor();
    await result.click();
    await dialog
      .getByRole("button", { name: "Open source", exact: true })
      .click();
    await graphic();
    await inspector().getByRole("heading", { name, exact: true }).waitFor();
  };
  try {
    await launch();
    await nav("Operations");
    assert.equal(await button("New operation").count(), 0);
    assert.equal(await button("Create operation").count(), 1);
    await button("Create operation").click();
    await page.getByRole("dialog", { name: "Create an operation" }).waitFor();
    await page.keyboard.press("Escape");
    pass("Operations has one creation action, which opens the creation dialog");
    const sym = (
      await call("symbols", {
        type: "new",
        kind: "SYMBOL",
        name: "Fictional infantry symbol",
      })
    ).symbol;
    const pin = (
      await call("symbols", { type: "symbol-pin", id: sym.versionId })
    ).pin;
    let tree = (
      await call("symbols", {
        type: "new",
        kind: "ORBAT",
        name: "Fictional shared formation",
      })
    ).orbat;
    const root = fixtureOrbatUnit(tree.rootNodeId, "Formation Headquarters"),
      child = fixtureOrbatUnit(randomUUID(), "Fictional Relief Company"),
      grand = fixtureOrbatUnit(randomUUID(), "Fictional Medical Platoon");
    child.parentNodeId = root.nodeId;
    grand.parentNodeId = child.nodeId;
    for (const node of [root, child, grand])
      node.unit.symbol = {
        definition: pin.definition,
        source: {
          familyId: pin.familyId,
          versionId: pin.versionId,
          contentHash: pin.contentHash,
        },
      };
    tree.nodes = [root, child, grand];
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    const a = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "Fictional North Division",
      })
    ).profile;
    const b = (
      await call("workspace", {
        type: "unit-profile-new",
        name: "Fictional South Division",
      })
    ).profile;
    await nav("Organizations");
    await open(a.unitProfileVersionId);
    await field("Assigned ORBAT").selectOption(tree.versionId);
    await graphic();
    await button("Save organization").click();
    await clean();
    await button("Identity").click();
    await searchOrganizationUnit("Fictional Relief Company");
    assert.equal(
      await field("Full Designation").inputValue(),
      "Fictional Relief Company",
    );
    pass(
      "Working organization search includes untouched ORBAT units and opens their organization profiles",
    );
    await nav("Operations");
    tree.nodes[1].nameOverride = "Fictional Rescue Company";
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    await searchOrganizationUnit("Fictional Rescue Company");
    assert.equal(
      await field("Full Designation").inputValue(),
      "Fictional Rescue Company",
    );
    tree.nodes[1].nameOverride = null;
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    await button("Refresh ORBAT").click();
    await field("Full Designation").filter({ visible: true }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".organization-orbat input")].some(
        (el) => el.value === "Fictional Relief Company",
      ),
    );
    pass(
      "Source edits refresh saved organization search while an inactive editor is open, and navigation loads the current unit",
    );
    await nav("Operations");
    await button("Create operation").click();
    await button("Choose organization").click();
    const picker = page.getByRole("dialog", {
      name: "Choose organization",
      exact: true,
    });
    await picker
      .getByRole("button", { name: /Fictional North Division/ })
      .click();
    await picker
      .getByText("Assigned ORBAT: Fictional shared formation", { exact: true })
      .waitFor();
    assert.match(
      await picker.locator(".selection-preview").innerText(),
      /3 subordinate units/,
    );
    assert.doesNotMatch(
      await picker.locator(".selection-preview").innerText(),
      /0 standing subordinates/,
    );
    await page.screenshot({
      path: path.join(folder, "organization-picker-orbat-count.png"),
    });
    captures.push("organization-picker-orbat-count.png");
    await picker
      .getByRole("button", { name: /Fictional South Division/ })
      .click();
    await picker
      .locator(".selection-preview h3")
      .filter({ hasText: "Fictional South Division" })
      .waitFor();
    assert.match(
      await picker.locator(".selection-preview").innerText(),
      /0 standing subordinates/,
    );
    assert.doesNotMatch(
      await picker.locator(".selection-preview").innerText(),
      /Assigned ORBAT/,
    );
    await picker
      .getByRole("button", { name: /Fictional North Division/ })
      .click();
    await picker
      .getByText("Assigned ORBAT: Fictional shared formation", { exact: true })
      .waitFor();
    await button("Use organization").click();
    assert.match(
      await page.locator(".create-operation .selection-preview").innerText(),
      /Fictional North Division/,
    );
    await button("Cancel").click();
    pass(
      "Organization picker counts all units in the assigned ORBAT and keeps each selection's count separate from legacy relationships",
    );
    await nav("Organizations");
    await open(a.unitProfileVersionId);
    await graphic();
    await select(child.nodeId);
    await field("Full Designation").fill("North Relief Company");
    await editStaff();
    await button("Add staff section").click();
    await field("Section name 1").fill("Headquarters");
    await button("Add position to Headquarters").click();
    await field("Position title").fill("Commander");
    await field("Person filling this role").fill("Alex North");
    await field("Rank / grade").fill("Captain");
    await field("Position description").fill(
      "Coordinates fictional relief personnel.",
    );
    await inspector().getByText("Personnel details", { exact: true }).click();
    await field("Contact").fill("north@example.invalid");
    await field("Functional role").selectOption("COMMAND");
    await field("Default position for this functional role").check();
    await inspector()
      .locator(".staff-position > .staff-disclosure-heading")
      .first()
      .click();
    await button("Add position to Headquarters").click();
    await field("Position title").fill("Deputy commander");
    await field("Functional role").selectOption("COMMAND");
    await field("Default position for this functional role").check();
    assert.equal(
      await page
        .getByText(/Multiple defaults for COMMAND/)
        .filter({ visible: true })
        .count(),
      1,
    );
    assert.equal(await button("Save organization").isEnabled(), false);
    await field("Default position for this functional role").uncheck();
    assert.equal(
      await page
        .getByText(/Multiple defaults for COMMAND/)
        .filter({ visible: true })
        .count(),
      0,
    );
    pass(
      "Staff validation shows one warning per problem and clears it when corrected",
    );
    await inspector()
      .locator(".staff-position > .staff-disclosure-heading")
      .last()
      .click();
    await button("Save organization").click();
    await clean();
    let stored = await call("organizations", {
      type: "get",
      id: a.unitProfileVersionId,
    });
    assert.equal(
      stored.orbatWorkspace.profiles[0].staff.positions[0].incumbent.name,
      "Alex North",
    );
    assert.equal(
      stored.orbatWorkspace.profiles[0].identity.fullDesignation,
      "North Relief Company",
    );
    pass(
      "Assign saved ORBAT, click its subordinate, edit identity, role and personnel, and save the organization",
    );
    await showStaff();
    assert.match(
      await overview().innerText(),
      /Commander[\s\S]*Captain[\s\S]*Alex North/,
    );
    assert.match(await overview().innerText(), /1 of 2 filled/);
    assert.match(await overview().innerText(), /Deputy commander[\s\S]*Vacant/);
    await overview()
      .locator(".staff-position > .staff-disclosure-heading")
      .first()
      .click();
    assert.match(
      await overview().innerText(),
      /Coordinates fictional relief personnel/,
    );
    assert.match(await overview().innerText(), /north@example.invalid/);
    assert.equal(
      await overview()
        .locator("input, textarea, select, [contenteditable=true]")
        .count(),
      0,
    );
    const sectionHeading = () =>
      inspector().locator(".staff-section > .staff-disclosure-heading").first();
    await sectionHeading().click();
    assert.equal(await sectionHeading().getAttribute("aria-expanded"), "false");
    await button("Edit staff & roles").click();
    assert.equal(await sectionHeading().getAttribute("aria-expanded"), "false");
    assert.equal(await field("Person filling this role").count(), 0);
    await field("Staff unit").selectOption(`${tree.versionId}:${grand.nodeId}`);
    assert.equal(await inspector().locator(".staff-section").count(), 0);
    await field("Staff unit").selectOption(`${tree.versionId}:${child.nodeId}`);
    assert.equal(await sectionHeading().getAttribute("aria-expanded"), "false");
    await sectionHeading().focus();
    await page.keyboard.press("Enter");
    await editStaff();
    assert.equal(
      await field("Person filling this role").inputValue(),
      "Alex North",
    );
    await inspector()
      .locator(".staff-position > .staff-disclosure-heading")
      .first()
      .click();
    assert.equal(await field("Person filling this role").count(), 0);
    await editStaff();
    await field("Person filling this role").fill("Alex Draft");
    await showStaff();
    assert.match(await overview().innerText(), /Alex Draft/);
    assert.equal(await button("Save organization").isEnabled(), true);
    await button("Discard edits").click();
    await clean();
    assert.match(await overview().innerText(), /Alex North/);
    await button("Identity").click();
    await button("Staff & roles").click();
    await editStaff();
    assert.match(
      await inspector().locator("h3").innerText(),
      /North Relief Company/,
    );
    pass(
      "ORBAT staff is read-only; direct editing, keyboard collapse, tab context, and unsaved edits share the same unit records",
    );
    await select(grand.nodeId);
    assert.equal(await field("Person filling this role").count(), 0);
    await select(child.nodeId);
    await editStaff();
    assert.equal(
      await field("Person filling this role").inputValue(),
      "Alex North",
    );
    await select(root.nodeId);
    await page.getByRole("tab", { name: "Information", exact: true }).click();
    assert.equal(
      await field("Full Designation").inputValue(),
      "Formation Headquarters",
    );
    await field("Callsign").fill("FORMATION");
    await editStaff();
    await button("Add staff section").click();
    await field("Section name 1").fill("Formation command");
    await button("Add position to Formation command").click();
    await field("Position title").fill("Commander");
    await field("Person filling this role").fill("Taylor Formation");
    await button("Save organization").click();
    await clean();
    assert.equal(await field("Staff unit").locator("option").count(), 4);
    await field("Staff unit").selectOption("organization");
    assert.equal(await inspector().locator(".staff-section").count(), 0);
    await button("Add staff section").click();
    await field("Section name 1").fill("Master command");
    await button("Add position to Master command").click();
    await field("Person filling this role").fill("Morgan Master");
    await button("Save organization").click();
    await clean();
    await button("Identity").click();
    assert.equal(await field("Callsign").inputValue(), "");
    await button("ORBAT").click();
    await button("Select master organization").click();
    await page.getByRole("tab", { name: "Information", exact: true }).click();
    assert.equal(
      await field("Full Designation").inputValue(),
      "Fictional North Division",
    );
    await field("Callsign").fill("NORTH");
    await button("Save organization").click();
    await clean();
    await select(root.nodeId);
    assert.equal(await field("Callsign").inputValue(), "FORMATION");
    await editStaff();
    assert.equal(
      await field("Person filling this role").inputValue(),
      "Taylor Formation",
    );
    await button("View in ORBAT").click();
    await button("Select master organization").click();
    await showStaff();
    assert.match(await overview().innerText(), /Morgan Master/);
    pass(
      "The master organization and every assigned ORBAT unit have separate identities and staff, including the ORBAT root",
    );
    await select(child.nodeId);
    const before = await call("symbols", {
      type: "get",
      kind: "ORBAT",
      id: tree.versionId,
    });
    const box = await page
      .locator(`.organization-orbat-map [data-unit-id="${child.nodeId}"]`)
      .boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 60,
      box.y + box.height / 2 + 50,
      { steps: 8 },
    );
    await page.mouse.up();
    assert.deepEqual(
      await call("symbols", { type: "get", kind: "ORBAT", id: tree.versionId }),
      before,
    );
    assert.equal(await button("Save organization").isEnabled(), false);
    await page
      .locator(`.organization-orbat-map [data-unit-id="${grand.nodeId}"]`)
      .focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await inspector().locator("h3").innerText(),
      "Fictional Medical Platoon",
    );
    pass(
      "Organization diagram is fixed against dragging and supports keyboard selection",
    );
    await select(child.nodeId);
    await showStaff();
    for (const width of [1500, 1280, 1000]) {
      await page.setViewportSize({ width, height: 1000 });
      await capture("organization-orbat-" + width);
    }
    await page.setViewportSize({ width: 1500, height: 1000 });
    await editStaff();
    await button("Add staff section").click();
    await field("Section name 2").fill("Logistics");
    await button("Add position to Logistics").click();
    await field("Person filling this role").last().fill("Pat Logistics");
    await button("Save organization").click();
    await clean();
    await button("Collapse all").click();
    assert.equal(await button("Save organization").isEnabled(), false);
    assert.equal(
      await inspector()
        .locator('.staff-disclosure-heading[aria-expanded="true"]')
        .count(),
      0,
    );
    assert.equal(await field("Person filling this role").count(), 0);
    assert.equal(await button("Expand all").isEnabled(), true);
    await button("Expand all").click();
    assert.equal(
      await inspector()
        .locator(
          '.staff-section > .staff-disclosure-heading[aria-expanded="true"]',
        )
        .count(),
      2,
    );
    assert.equal(await field("Person filling this role").count(), 3);
    await button("Collapse all").click();
    await inspector()
      .locator(".staff-section > .staff-disclosure-heading")
      .first()
      .click();
    assert.equal(
      await inspector()
        .locator(
          '.staff-position > .staff-disclosure-heading[aria-expanded="true"]',
        )
        .count(),
      0,
    );
    await field("Staff unit").selectOption(`${tree.versionId}:${root.nodeId}`);
    await field("Staff unit").selectOption(`${tree.versionId}:${child.nodeId}`);
    assert.equal(await field("Person filling this role").count(), 0);
    await button("View in ORBAT").click();
    assert.equal(
      await overview()
        .locator(
          '.staff-position > .staff-disclosure-heading[aria-expanded="true"]',
        )
        .count(),
      0,
    );
    await button("Collapse all").click();
    assert.equal(
      await overview()
        .locator(
          '.staff-section > .staff-disclosure-heading[aria-expanded="true"]',
        )
        .count(),
      0,
    );
    await button("Edit staff & roles").click();
    for (const width of [1500, 1000]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator(".organization-staff-page").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(folder, `staff-collapsed-${width}.png`),
      });
      captures.push(`staff-collapsed-${width}.png`);
    }
    await page.setViewportSize({ width: 1500, height: 1000 });
    await editStaff();
    assert.equal(
      await field("Person filling this role").inputValue(),
      "Alex North",
    );
    // Remove the extra section only after verifying all sections collapse together.
    await inspector()
      .locator(".staff-section > .staff-disclosure-heading")
      .last()
      .click();
    await inspector()
      .locator(".staff-section")
      .last()
      .locator(".staff-position > .staff-disclosure-heading")
      .click();
    await inspector()
      .locator(".staff-section")
      .last()
      .getByRole("button", { name: "Remove position", exact: true })
      .click();
    await inspector()
      .locator(".staff-section")
      .last()
      .getByRole("button", { name: "Remove empty section", exact: true })
      .click();
    await button("Save organization").click();
    await clean();
    pass(
      "Collapse all and Expand all toggle all sections and nested roles without modifying saved data",
    );
    // Editor actions remain available inside collapsible role cards.
    await button("Duplicate position").click();
    await field("Position title").last().fill("Temporary role");
    await button("Remove position").last().click();
    await button("Add staff section").click();
    await field("Section name 2").fill("Temporary section");
    await button("Remove empty section").last().click();
    await button("Add position to Headquarters").click();
    await field("Position title").last().fill("Temporary role");
    await button("Position up").last().click();
    assert.match(
      await inspector().locator(".staff-position").nth(1).innerText(),
      /Temporary role/,
    );
    await inspector()
      .locator(".staff-position")
      .nth(1)
      .getByRole("button", { name: "Position down", exact: true })
      .click();
    await button("Remove position").last().click();
    await field("Rank / grade").first().fill("Captain (OF-2)");
    await button("Save organization").click();
    await clean();
    await field("Rank / grade").first().scrollIntoViewIfNeeded();
    await field("Rank / grade").first().focus();
    const scrollBefore = await page
      .locator(".global-workspace")
      .evaluate((el) => el.scrollTop);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForTimeout(700);
    assert.equal(
      await field("Rank / grade")
        .first()
        .evaluate((el) => el === document.activeElement),
      true,
    );
    assert(
      Math.abs(
        (await page
          .locator(".global-workspace")
          .evaluate((el) => el.scrollTop)) - scrollBefore,
      ) < 2,
    );
    pass(
      "Returning focus refreshes the linked ORBAT without moving the staff editor or changing keyboard focus",
    );
    for (const width of [1500, 1000]) {
      await page.setViewportSize({ width, height: 1000 });
      await page
        .locator(".panel")
        .filter({ has: page.locator(".organization-staff-page") })
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
      assert(
        await page
          .locator(".organization-staff-page")
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({
        path: path.join(folder, `organization-staff-${width}.png`),
      });
      captures.push(`organization-staff-${width}.png`);
    }
    pass(
      "Role add, duplicate, reorder and remove work in the dedicated editor; both views fit desktop and narrower layouts",
    );
    await page.setViewportSize({ width: 1500, height: 1000 });
    await open(b.unitProfileVersionId);
    await button("Staff & roles").click();
    await field("Staff unit").waitFor();
    assert.equal(
      await inspector().locator("h3").innerText(),
      "Fictional South Division",
    );
    await button("Add staff section").click();
    await field("Section name 1").fill("Command");
    await button("Add position to Command").click();
    await field("Position title").fill("Commander");
    await field("Person filling this role").fill("Morgan South");
    await button("Save organization").click();
    await clean();
    await button("ORBAT").click();
    pass(
      "Organization headquarters staff can be edited without assigning an ORBAT",
    );
    await field("Assigned ORBAT").selectOption(tree.versionId);
    await button("Save organization").click();
    await clean();
    await select(child.nodeId);
    await editStaff();
    assert.equal(await field("Person filling this role").count(), 0);
    await button("Add staff section").click();
    await field("Section name 1").fill("Headquarters");
    await button("Add position to Headquarters").click();
    await field("Person filling this role").fill("Blair South");
    await button("Save organization").click();
    await clean();
    await open(a.unitProfileVersionId);
    await select(child.nodeId);
    await editStaff();
    assert.equal(
      await field("Person filling this role").inputValue(),
      "Alex North",
    );
    pass(
      "Two organizations sharing the same ORBAT keep different unit identities and personnel",
    );
    await field("Person filling this role").fill("Alex Unfinished");
    await page
      .getByText("Recovery copy saved locally · save your edits to finish", {
        exact: true,
      })
      .filter({ visible: true })
      .waitFor();
    const recovery = await call("recovery", {
      type: "get",
      key: { kind: "unit-profile", id: a.unitProfileVersionId, scope: null },
    });
    assert.equal(
      JSON.parse(recovery.draft.value).orbatWorkspace.profiles[0].staff
        .positions[0].incumbent.name,
      "Alex Unfinished",
    );
    assert.equal(
      await page
        .locator(`[data-unit-profile-version="${b.unitProfileVersionId}"]`)
        .isEnabled(),
      false,
    );
    await button("Discard edits").click();
    await clean();
    assert.equal(
      await field("Person filling this role").inputValue(),
      "Alex North",
    );
    pass(
      "Unfinished subordinate edits receive a recovery copy and block organization switching; discard restores saved staff",
    );
    await nav("Symbols & ORBATs");
    const replacement = { ...structuredClone(child), nodeId: randomUUID() };
    tree.nodes = [root, replacement, { ...grand, parentNodeId: root.nodeId }];
    tree.layout.commandLevels = 3;
    tree = (
      await call("symbols", {
        type: "save-orbat",
        value: tree,
        expected: tree.contentVersion,
      })
    ).orbat;
    await nav("Organizations");
    await button("ORBAT").click();
    await graphic();
    assert.equal(
      await page
        .locator(`.organization-orbat-map [data-unit-id="${child.nodeId}"]`)
        .count(),
      0,
    );
    assert.equal(
      await page
        .locator(
          `.organization-orbat-map [data-unit-id="${replacement.nodeId}"]`,
        )
        .count(),
      1,
    );
    await select(replacement.nodeId);
    await showStaff();
    assert.equal(await field("Person filling this role").count(), 0);
    await page
      .locator(".organization-retained-profiles")
      .getByRole("button", { name: "North Relief Company", exact: true })
      .click();
    await editStaff();
    assert.equal(
      await field("Person filling this role").inputValue(),
      "Alex North",
    );
    await showStaff();
    await capture("retained-personnel");
    pass(
      "Saved source changes update the diagram; removed personnel remain editable and matching replacement names never inherit them",
    );
    await field("Assigned ORBAT").selectOption("");
    await button("Save organization").click();
    await clean();
    assert.equal(
      (await call("organizations", { type: "get", id: a.unitProfileVersionId }))
        .orbatWorkspace.profiles[0].staff.positions[0].incumbent.name,
      "Alex North",
    );
    await field("Assigned ORBAT").selectOption(tree.versionId);
    await button("Save organization").click();
    await clean();
    pass("Unassigning and reassigning keeps organization-owned personnel");
    assert.deepEqual(errors, []);
    await close();
    await launch();
    await nav("Organizations");
    await open(a.unitProfileVersionId);
    await graphic();
    await page
      .locator(".organization-retained-profiles")
      .getByRole("button", { name: "North Relief Company", exact: true })
      .click();
    await editStaff();
    assert.equal(
      await field("Person filling this role").inputValue(),
      "Alex North",
    );
    assert.deepEqual(errors, []);
    await close();
    pass(
      "Normal offline exit and reopen retain the assignment, structure and personnel without renderer errors",
    );
  } catch (e) {
    failure = e;
    write();
    if (page) {
      await page
        .screenshot({ path: path.join(folder, "failure.png") })
        .catch(() => {});
      fs.writeFileSync(
        path.join(folder, "failure-dom.txt"),
        await page
          .locator("body")
          .innerText()
          .catch(() => ""),
      );
    }
    throw e;
  } finally {
    if (app) await app.close();
    write();
    console.log(folder);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
