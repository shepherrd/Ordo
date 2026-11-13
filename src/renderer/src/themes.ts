type Palette = {
  background: string;
  paper: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  control: string;
  accent: string;
  hover: string;
  onAccent: string;
  tint: string;
  accentInk: string;
  nav: string;
  navSurface: string;
  navSelected: string;
  navLine: string;
  navMuted: string;
  navAccent: string;
  diagramAccent: string;
  diagramTint: string;
};

function theme(
  id: string,
  name: string,
  mode: "light" | "dark",
  description: string,
  p: Palette,
) {
  const dark = mode === "dark";
  return {
    id,
    name,
    mode,
    description,
    colors: {
      background: p.background,
      paper: p.paper,
      surface: p.surface,
      ink: p.ink,
      muted: p.muted,
      line: p.line,
      "control-line": p.control,
      green: p.accent,
      accent: p.accent,
      "accent-hover": p.hover,
      "on-accent": p.onAccent,
      "accent-soft": p.tint,
      "accent-ink": p.accentInk,
      focus: p.accent,
      nav: p.nav,
      "nav-surface": p.navSurface,
      "nav-hover": p.navSurface,
      "nav-selected": p.navSelected,
      "nav-line": p.navLine,
      "nav-text": "#f1f5f4",
      "nav-muted": p.navMuted,
      "nav-accent": p.navAccent,
      warning: dark ? "#f3ce85" : "#775414",
      "warning-bg": dark ? "#3a3020" : "#fff4db",
      "warning-line": dark ? "#aa8344" : "#b88a36",
      danger: dark ? "#ffb7ad" : "#943c31",
      "danger-bg": dark ? "#3d2629" : "#fcebe7",
      "danger-line": dark ? "#c37670" : "#bf776d",
      success: dark ? "#a7dfba" : "#306548",
      "success-bg": dark ? "#23382d" : "#e9f4ec",
      "success-line": dark ? "#648c74" : "#76a486",
      shadow: dark ? "#00000055" : "#15251e15",
      overlay: dark ? "#060b12b3" : "#13231b80",
      // Graphic and document colors do not inherit the application color scheme.
      "diagram-paper": "#ffffff",
      "diagram-grid": "#f2f4f3",
      "diagram-ink": "#243b34",
      "diagram-accent": p.diagramAccent,
      "diagram-tint": p.diagramTint,
      "document-paper": "#ffffff",
    },
  };
}

export const themes = [
  theme(
    "forest",
    "Forest",
    "light",
    "Ordo’s familiar green, with soft neutral surfaces.",
    {
      background: "#eff2ef",
      paper: "#fcfdfb",
      surface: "#eaf0eb",
      ink: "#253c38",
      muted: "#52685c",
      line: "#cbd8cf",
      control: "#80988b",
      accent: "#2e604d",
      hover: "#204c3b",
      onAccent: "#ffffff",
      tint: "#dcebe4",
      accentInk: "#244f3e",
      nav: "#192d29",
      navSurface: "#243f36",
      navSelected: "#385348",
      navLine: "#4c685b",
      navMuted: "#b1c7b9",
      navAccent: "#c4dcae",
      diagramAccent: "#2e604d",
      diagramTint: "#e0eee5",
    },
  ),
  theme(
    "ocean",
    "Ocean",
    "light",
    "Cool blue accents and crisp, pale surfaces.",
    {
      background: "#eef3f8",
      paper: "#fbfdff",
      surface: "#e6eef6",
      ink: "#233a50",
      muted: "#4e667b",
      line: "#c7d6e3",
      control: "#7d96ad",
      accent: "#285e89",
      hover: "#1e486c",
      onAccent: "#ffffff",
      tint: "#dbeaf6",
      accentInk: "#244f73",
      nav: "#182b40",
      navSurface: "#243e56",
      navSelected: "#365773",
      navLine: "#506f89",
      navMuted: "#b7cbdc",
      navAccent: "#b0daf2",
      diagramAccent: "#285e89",
      diagramTint: "#dbeaf6",
    },
  ),
  theme("sand", "Sand", "light", "Warm parchment tones with bronze accents.", {
    background: "#f4f0e8",
    paper: "#fffdf7",
    surface: "#eee7d9",
    ink: "#40372b",
    muted: "#6c5f4b",
    line: "#d9cdb9",
    control: "#a28d6c",
    accent: "#79592e",
    hover: "#5e4321",
    onAccent: "#ffffff",
    tint: "#ede1cb",
    accentInk: "#654823",
    nav: "#30291f",
    navSurface: "#453a2b",
    navSelected: "#62513a",
    navLine: "#7a694f",
    navMuted: "#d4c6ac",
    navAccent: "#ead29d",
    diagramAccent: "#79592e",
    diagramTint: "#ede1cb",
  }),
  theme(
    "plum",
    "Plum",
    "light",
    "Muted violet accents on a soft ivory background.",
    {
      background: "#f3eff5",
      paper: "#fefcff",
      surface: "#ece5f0",
      ink: "#403447",
      muted: "#6c5975",
      line: "#d8cadf",
      control: "#a18ba9",
      accent: "#745181",
      hover: "#593b65",
      onAccent: "#ffffff",
      tint: "#e9ddef",
      accentInk: "#603c70",
      nav: "#2c2333",
      navSurface: "#403148",
      navSelected: "#5d4766",
      navLine: "#806789",
      navMuted: "#d0bed8",
      navAccent: "#e1c3ed",
      diagramAccent: "#745181",
      diagramTint: "#e9ddef",
    },
  ),
  theme(
    "midnight",
    "Midnight",
    "dark",
    "Deep navy surfaces with clear blue accents.",
    {
      background: "#101a28",
      paper: "#192638",
      surface: "#223249",
      ink: "#e5edf7",
      muted: "#a8bad0",
      line: "#384b64",
      control: "#617996",
      accent: "#95c8f5",
      hover: "#b1d9fc",
      onAccent: "#13283e",
      tint: "#2a4561",
      accentInk: "#c4e2ff",
      nav: "#0b1420",
      navSurface: "#1b3047",
      navSelected: "#2a4561",
      navLine: "#3e5875",
      navMuted: "#a7bdd5",
      navAccent: "#a8d5fb",
      diagramAccent: "#285e89",
      diagramTint: "#dbeaf6",
    },
  ),
  theme(
    "charcoal",
    "Charcoal",
    "dark",
    "Quiet graphite surfaces with silver accents.",
    {
      background: "#181b1e",
      paper: "#23282d",
      surface: "#2e343a",
      ink: "#edf0f2",
      muted: "#b6c0c8",
      line: "#48515a",
      control: "#73828d",
      accent: "#becdd7",
      hover: "#d9e2e8",
      onAccent: "#202b33",
      tint: "#3c4c58",
      accentInk: "#e2eaf0",
      nav: "#101418",
      navSurface: "#242e37",
      navSelected: "#3c4c58",
      navLine: "#52616d",
      navMuted: "#b8c6d0",
      navAccent: "#dce5eb",
      diagramAccent: "#4b6170",
      diagramTint: "#e3e9ed",
    },
  ),
  theme(
    "pine",
    "Pine",
    "dark",
    "Deep woodland greens with gentle mint accents.",
    {
      background: "#14231d",
      paper: "#1e3027",
      surface: "#293e32",
      ink: "#e6f0e9",
      muted: "#b5c8b7",
      line: "#405b49",
      control: "#6b8a75",
      accent: "#a3d0ae",
      hover: "#bee3c6",
      onAccent: "#183721",
      tint: "#345642",
      accentInk: "#d4edda",
      nav: "#0d1b15",
      navSurface: "#213b2c",
      navSelected: "#345642",
      navLine: "#486951",
      navMuted: "#afc6b5",
      navAccent: "#c3e4ba",
      diagramAccent: "#366447",
      diagramTint: "#dfeee2",
    },
  ),
  theme(
    "ember",
    "Ember",
    "dark",
    "Warm charcoal surfaces with restrained copper accents.",
    {
      background: "#251b19",
      paper: "#332622",
      surface: "#41302a",
      ink: "#f5e9df",
      muted: "#d3bdad",
      line: "#654b40",
      control: "#a07b66",
      accent: "#efb58c",
      hover: "#f7ceb0",
      onAccent: "#3f2619",
      tint: "#654633",
      accentInk: "#ffddbf",
      nav: "#1b1210",
      navSurface: "#3b2921",
      navSelected: "#654633",
      navLine: "#805d46",
      navMuted: "#d7bda8",
      navAccent: "#f2c293",
      diagramAccent: "#805331",
      diagramTint: "#f1e3d5",
    },
  ),
] as const;

export type AppTheme = (typeof themes)[number];
export const themeStorageKey = "ordo.appearance.theme";
export const themeFromId = (id: string | null | undefined): AppTheme =>
  themes.find((t) => t.id === id) ?? themes[0];

export function readTheme(): AppTheme {
  try {
    return themeFromId(localStorage.getItem(themeStorageKey));
  } catch {
    return themes[0];
  }
}
export function applyTheme(value: AppTheme) {
  const root = document.documentElement;
  root.dataset.theme = value.id;
  root.style.colorScheme = value.mode;
  for (const [key, color] of Object.entries(value.colors))
    root.style.setProperty(`--${key}`, color);
}
export function saveTheme(value: AppTheme): boolean {
  applyTheme(value);
  try {
    localStorage.setItem(themeStorageKey, value.id);
    return true;
  } catch {
    return false;
  }
}
