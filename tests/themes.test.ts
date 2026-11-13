import { afterEach, describe, expect, it, vi } from "vitest";
import {
  themes,
  themeFromId,
  themeStorageKey,
  readTheme,
  saveTheme,
} from "../src/renderer/src/themes";

function luminance(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((n) => parseInt(n, 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const light = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light[0] + 0.05) / (light[1] + 0.05);
}
afterEach(() => vi.unstubAllGlobals());
describe("workspace themes", () => {
  it("offers eight complete themes, including four light and four dark", () => {
    expect(themes).toHaveLength(8);
    expect(new Set(themes.map((t) => t.id)).size).toBe(8);
    expect(themes.filter((t) => t.mode === "light")).toHaveLength(4);
    expect(themes.filter((t) => t.mode === "dark")).toHaveLength(4);
    for (const t of themes) {
      expect(Object.keys(t.colors)).toEqual(Object.keys(themes[0].colors));
      for (const color of Object.values(t.colors))
        expect(color).toMatch(/^#[\da-f]{6}(?:[\da-f]{2})?$/i);
      expect(t.colors["diagram-paper"]).toBe("#ffffff");
      expect(t.colors["document-paper"]).toBe("#ffffff");
    }
  });
  for (const t of themes)
    it(`${t.name} keeps text and controls readable`, () => {
      const c = t.colors;
      const textPairs: [keyof typeof c, keyof typeof c][] = [
        ["ink", "background"],
        ["ink", "paper"],
        ["ink", "surface"],
        ["muted", "background"],
        ["muted", "paper"],
        ["muted", "surface"],
        ["muted", "accent-soft"],
        ["accent-ink", "paper"],
        ["accent-ink", "accent-soft"],
        ["on-accent", "accent"],
        ["on-accent", "accent-hover"],
        ["nav-text", "nav"],
        ["nav-text", "nav-selected"],
        ["nav-muted", "nav"],
        ["nav-muted", "nav-selected"],
        ["warning", "warning-bg"],
        ["danger", "danger-bg"],
        ["success", "success-bg"],
        ["diagram-ink", "diagram-tint"],
      ];
      for (const [fg, bg] of textPairs)
        expect(
          contrast(c[fg], c[bg]),
          `${t.name}: ${fg} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      for (const surface of ["paper", "surface", "background"] as const)
        expect(
          contrast(c.focus, c[surface]),
          `${t.name}: focus on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(c["control-line"], c.paper),
        `${t.name}: control border`,
      ).toBeGreaterThanOrEqual(3);
    });
  it("restores only known theme IDs and falls back safely for damaged/unavailable storage", () => {
    expect(themeFromId('url("https://invalid.example")')).toBe(themes[0]);
    expect(themeFromId(null)).toBe(themes[0]);
    vi.stubGlobal("localStorage", { getItem: () => "midnight" });
    expect(readTheme().id).toBe("midnight");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw Error("Unavailable");
      },
    });
    expect(readTheme()).toBe(themes[0]);
  });
  it("applies immediately, persists only the theme ID, and stays usable if persistence fails", () => {
    const stored = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: { colorScheme: "", setProperty: vi.fn() },
    };
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("localStorage", {
      setItem: (key: string, value: string) => stored.set(key, value),
      getItem: (key: string) => stored.get(key) ?? null,
    });
    expect(saveTheme(themes[4])).toBe(true);
    expect(stored).toEqual(new Map([[themeStorageKey, "midnight"]]));
    expect(readTheme().id).toBe("midnight");
    expect(root.style.colorScheme).toBe("dark");
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw Error("Unavailable");
      },
    });
    expect(saveTheme(themes[1])).toBe(false);
    expect(root.dataset.theme).toBe("ocean");
    expect(root.style.colorScheme).toBe("light");
  });
});
