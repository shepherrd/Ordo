import { randomUUID } from "node:crypto";
// Retained milestone evidence is read-only. Each current test run writes separately.
export const visualTestOutput = `.test-data/current-visual-${randomUUID()}`;
