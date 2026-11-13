const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { openOperation, navigateOperation } = require("./smoke-global.cjs");

(async () => {
  const folder = path.resolve(
    ".test-data",
    "timeline-calendar-" + randomUUID(),
  );
  fs.mkdirSync(folder, { recursive: true });
  const env = {
    ...process.env,
    ORDO_HEADLESS: "1",
    ORDO_DATA_DIR: path.join(folder, "workspace"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    args: [path.resolve("out/main/index.js")],
    env,
  });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: 1600, height: 1000 });
    const execute = (command) =>
      page.evaluate((c) => window.ordo.execute(c), command);
    const button = (name) =>
      page.getByRole("button", { name, exact: true }).filter({ visible: true });
    const field = (name) =>
      page.getByLabel(name, { exact: true }).filter({ visible: true });
    const region = page.getByRole("region", {
      name: "Timeline calendar",
      exact: true,
    });
    const starter = (await execute({ type: "load" })).configurations.find(
      (c) => !c.doctrine.catalog,
    );
    const { operation } = await execute({
      type: "create",
      name: "Exercise North Sound",
      demo: false,
      configuration: {
        id: starter.doctrine.id,
        version: starter.doctrine.version,
      },
    });
    const event = (name, at, durationMinutes, laneId) => ({
      id: randomUUID(),
      name,
      metadata: operation.metadata,
      phaseId: null,
      relativeToEventId: null,
      offsetMinutes: 0,
      at,
      schedule: {
        schemaVersion: 1,
        durationMinutes,
        unitId: null,
        relativeAnchor: "START",
        ...(laneId ? { laneId } : {}),
      },
    });
    const rehearsal = event(
      "Rehearsal window",
      "2026-06-25T00:00:00.000Z",
      4 * 1440,
      "key-dates",
    );
    const execution = event("Exercise execution", null, 6 * 1440, "key-dates");
    execution.relativeToEventId = rehearsal.id;
    execution.schedule.relativeAnchor = "END";
    const handover = event("Handover", null, 0, "battle-rhythm");
    handover.relativeToEventId = execution.id;
    handover.schedule.relativeAnchor = "END";
    operation.events = [
      rehearsal,
      execution,
      handover,
      event("Staff update", "2026-06-26T08:00:00.000Z", 60, "battle-rhythm"),
      event("Staff update II", "2026-06-29T08:00:00.000Z", 60, "battle-rhythm"),
      event("Supply window", "2026-06-28T00:00:00.000Z", 4 * 1440),
      event("Follow-up briefing", null, 0),
    ];
    // Duplicating an older module also duplicated its item IDs.
    const sharedItemId = randomUUID();
    const annexModule = (code, name, title) => {
      const attachment = {
        id: randomUUID(),
        name,
        kind: "annex",
        code,
        parentId: operation.orderId,
        catalogId: null,
        metadata: operation.metadata,
        narrative: "",
        phaseIds: [],
        unitIds: [],
        required: false,
      };
      operation.attachments.push(attachment);
      return {
        moduleInstanceId: randomUUID(),
        operationId: operation.id,
        productInstanceId: attachment.id,
        moduleDefinitionId: null,
        localDefinition: {
          moduleDefinitionId: randomUUID(),
          stableKey: "timing-" + code,
          moduleType: "TIMELINE",
          title: "Timing",
          description: "",
          guidance: "",
          position: 0,
          required: false,
          defaultVisible: true,
          configuration: {},
          provenance: {
            sourceClass: "ORDO_DEFAULT",
            sourceReferences: [],
            notes: "",
          },
        },
        content: {
          type: "TIMELINE",
          items: [
            {
              id: sharedItemId,
              title,
              description: "Original description",
              phaseId: null,
              timing: { mode: "ABSOLUTE", at: "2026-06-27T12:00:00.000Z" },
            },
          ],
        },
        origin: "OPERATION",
        position: 0,
        layoutState: "ACTIVE",
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
      };
    };
    const fires = annexModule("D", "Fires", "Fires rehearsal");
    const signal = annexModule("H", "Signal", "Signal check");
    operation.modules = {
      schemaVersion: 1,
      instances: [fires, signal],
      assets: [],
    };
    await execute({
      type: "save",
      operation,
      expectedRevision: operation.revision,
    });
    const open = async () => {
      await openOperation(page, operation.id);
      await navigateOperation(page, "Timeline");
      await region.waitFor();
    };
    await open();
    assert.equal(await region.locator(".timeline-band").count(), 3);
    assert.equal(await region.locator("[data-timeline-link]").count(), 2);
    assert(await button("Follow-up briefing").isVisible());
    await field("D-Day (UTC)").fill("2026-06-29");
    await region.locator(".timeline-zero").waitFor();
    assert.match(await region.innerText(), /D−1/);
    assert.match(await region.innerText(), /Jul 2026/);
    await button("Add lane").click();
    const dialog = page.getByRole("dialog", { name: "Add lane" });
    await dialog.getByLabel("Lane name").fill("Logistics");
    await dialog.getByLabel("amber").check();
    await dialog.getByRole("button", { name: "Add lane", exact: true }).click();
    await button("Supply window").click();
    await field("Event lane").selectOption({ label: "Logistics" });
    await button("Close event editor").click();
    await region
      .getByRole("region", { name: "Logistics", exact: true })
      .getByRole("button", { name: "Supply window" })
      .waitFor();
    await region.screenshot({ path: path.join(folder, "calendar.png") });
    await field("Timeline scale").selectOption("day");
    const sticky = await region.evaluate((el) => {
      const left = el
        .querySelector(".timeline-gutter")
        .getBoundingClientRect().left;
      el.scrollLeft = 400;
      return (
        el.scrollLeft > 0 &&
        Math.abs(
          el.querySelector(".timeline-gutter").getBoundingClientRect().left -
            left,
        ) < 2
      );
    });
    assert(sticky);
    await field("Timeline scale").selectOption("fit");
    await page.setViewportSize({ width: 1050, height: 850 });
    await page.waitForFunction(() => {
      const chart = document.querySelector(".planning-chart-scroll");
      return chart.scrollWidth <= chart.clientWidth + 1;
    });
    await button("Add event to Logistics").click();
    assert.equal(
      await field("Event lane").locator("option:checked").innerText(),
      "Logistics",
    );
    await field("Event name").fill("Delivery review");
    await button("Save revision").click();
    await page
      .locator('[data-workspace-dirty="false"][data-workspace-busy="false"]')
      .first()
      .waitFor();
    await page.reload();
    await open();
    const { operation: saved } = await execute({
      type: "load",
      operationId: operation.id,
    });
    assert.equal(saved.timeline.dDay, "2026-06-29");
    const lane = saved.timeline.lanes.find((l) => l.name === "Logistics");
    assert.equal(lane.color, "amber");
    assert.equal(
      saved.events.find((e) => e.name === "Delivery review").schedule.laneId,
      lane.id,
    );
    await button("Edit lane Logistics").click();
    await button("Remove lane").click();
    assert(
      await region
        .getByRole("region", { name: "Unsorted events", exact: true })
        .getByRole("button", { name: "Supply window" })
        .isVisible(),
    );
    await button("Save revision").click();
    await page
      .locator('[data-workspace-dirty="false"][data-workspace-busy="false"]')
      .first()
      .waitFor();
    const sourceMenu = page.locator(".timeline-sources");
    await sourceMenu.locator("summary").click();
    await sourceMenu.getByLabel(/Fires/).uncheck();
    assert.equal(await button("Fires rehearsal").count(), 0);
    assert(await button("Signal check").isVisible());
    await button("Hide all synced timelines").click();
    assert.equal(await button("Signal check").count(), 0);
    assert(await button("Rehearsal window").isVisible());
    await button("Show all synced timelines").click();
    await button("Fires rehearsal").click();
    await field("Event name").fill("Revised fires rehearsal");
    await field("Duration in minutes").fill("90");
    await page.locator("nav .tree-item").filter({ hasText: "Fires" }).click();
    const module = page.locator(
      '[data-module-id="' + fires.moduleInstanceId + '"]',
    );
    await module
      .getByRole("button", { name: "Revised fires rehearsal", exact: true })
      .click();
    assert.equal(
      await module.getByLabel("Duration in minutes").inputValue(),
      "90",
    );
    assert.equal(
      await module.getByRole("button", { name: "Rehearsal window" }).count(),
      0,
    );
    assert.equal(
      await module.getByRole("button", { name: "Signal check" }).count(),
      0,
    );
    await module
      .getByRole("button", { name: "+ Add event", exact: true })
      .click();
    await module.getByLabel("Event name").fill("Release");
    await module
      .getByLabel("Relative to event")
      .selectOption({ label: "Revised fires rehearsal" });
    await module.getByLabel("Follow linked event").selectOption("END");
    await module.getByLabel("Offset in minutes").fill("10");
    await navigateOperation(page, "Timeline");
    await button("Release").click();
    assert.match(
      await page.locator(".planning-resolved:visible").innerText(),
      /13:40/,
    );
    await button("Save revision").click();
    await page
      .locator('[data-workspace-dirty="false"][data-workspace-busy="false"]')
      .first()
      .waitFor();
    await page.reload();
    await open();
    assert(await button("Release").isVisible());
    assert(await button("Signal check").isVisible());
    const final = (await execute({ type: "load", operationId: operation.id }))
      .operation;
    assert.equal(
      final.events.some((e) => e.name === "Release"),
      false,
    );
    assert.equal(
      final.modules.instances.find(
        (m) => m.moduleInstanceId === signal.moduleInstanceId,
      ).content.items[0].title,
      "Signal check",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS Calendar lanes, custom colors, UTC and D-Day rows, dependency arrows, unscheduled events, scroll/fitting, lane edits and save/reopen.",
    );
    console.log(folder);
  } catch (e) {
    // A failed assertion may leave a dirty editor in this disposable workspace.
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    throw e;
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
