/** Exact version tuples: adding an engine never changes historical dispatch. */
export const reviewSemantics = {
  "diff-engine-v1": {
    schemaVersion: 1,
    impact: "impact-v1",
    report: "review-html-v1",
  },
  "diff-engine-v2": {
    schemaVersion: 1,
    impact: "impact-v2",
    report: "review-html-v2",
  },
  "diff-engine-v3": {
    schemaVersion: 2,
    impact: "impact-v3",
    report: "review-html-v3",
  },
} as const;
export type DiffVersion = keyof typeof reviewSemantics;
