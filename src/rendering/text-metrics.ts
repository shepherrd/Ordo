import metrics from "./resources/arial-metrics-v1.json";

// This immutable resource defines layout geometry. No canvas/font lookup occurs here.
export function textWidth(
  text: string,
  size: number,
  padding = 0,
  bold = false,
): number {
  if (!text) return 0;
  const widths: Record<string, number> = bold
    ? metrics.bold.widths
    : metrics.regular.widths;
  return (
    [...text].reduce(
      (sum, ch) => sum + (widths[ch] ?? metrics.fallback) * size,
      0,
    ) + padding
  );
}
export function splitDesignation(text: string): [string, string] {
  if (text.length <= 15) return [text, ""];
  const words = text.split(" ");
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    if (a.length > text.length / 2) {
      const b = words.slice(i).join(" "),
        c = words.slice(0, i - 1).join(" "),
        d = words.slice(i - 1).join(" ");
      return Math.max(textWidth(a, 40, 20, true), textWidth(b, 40, 20, true)) <
        Math.max(textWidth(c, 40, 20, true), textWidth(d, 40, 20, true))
        ? [a, b]
        : [c, d];
    }
  }
  return [text, ""];
}
