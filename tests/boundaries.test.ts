import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const { checkSource } = createRequire(import.meta.url)(
  "../scripts/check-boundaries.cjs",
);
describe("architectural dependency guard", () => {
  it.each([
    'import { app } from "electron"',
    'const db = require("better-sqlite3")',
    'const ui = import("../renderer/src/App")',
    'export { db } from "../persistence/repository"',
    'type UI = import("react").ReactNode',
    'const fs = import("node:fs")',
    'import hidden from "@infrastructure/db"',
    "const unknown = import(variable)",
  ])("rejects infrastructure dependency: %s", (source) => {
    expect(() => checkSource("src/domain/fixture.ts", source)).toThrow();
  });
  it("permits the application port to depend on framework-free projection and domain", () => {
    expect(
      checkSource(
        "src/application/fixture.ts",
        'import type { Operation } from "../domain/model"; export { project } from "../export/projection";',
      ),
    ).toBe(2);
  });
});
