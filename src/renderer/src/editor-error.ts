type Issue = { path?: PropertyKey[]; message: string };
const labels: Record<string, string> = {
  displayName: "Doctrine name",
  fullDesignation: "Full designation",
  shortDesignation: "Short designation",
  staff: "Staff",
  positions: "Positions",
  sections: "Sections",
  defaultSymbol: "Symbol",
  standingSubordinates: "Structure",
  orbatWorkspace: "ORBAT",
  profiles: "Unit profiles",
  insigniaAssetId: "Insignia",
  roleMappings: "Staff assignments",
  definition: "Symbol",
  sidc: "Symbol code",
};
export function fieldIssue(issue: Issue): string {
  const path = (issue.path ?? [])
    .filter(
      (p) => !["config", "content", "identity", "doctrine"].includes(String(p)),
    )
    .map((p) =>
      typeof p === "number"
        ? String(p + 1)
        : (labels[String(p)] ?? String(p).replace(/([A-Z])/g, " $1")),
    );
  return `${path.join(" → ")}${path.length ? ": " : ""}${issue.message}`;
}
export function editorError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray(error.issues)
  )
    return [...new Set(error.issues.map(fieldIssue))].join("\n");
  const text = (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': Error: /,
    "",
  );
  const start = text.indexOf("[");
  if (start >= 0)
    try {
      const issues = JSON.parse(text.slice(start));
      if (
        Array.isArray(issues) &&
        issues.every((i) => typeof i.message === "string")
      )
        return [...new Set(issues.map(fieldIssue))].join("\n");
    } catch {}
  return text;
}
