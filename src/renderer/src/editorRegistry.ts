import { resolveEditor, type EditorCapability } from "../../domain/doctrine";
import { moduleTypes, type ModuleType } from "../../domain/modules";

// UI implementations are registered here. Doctrine contains capabilities only.
export const editorRegistry: Record<
  EditorCapability,
  {
    label: string;
    implementation:
      | "narrative"
      | "units"
      | "matrix"
      | "checklist"
      | "generic"
      | "reports"
      | "distribution"
      | "signal";
  }
> = {
  NARRATIVE_DOCUMENT: {
    label: "Narrative document",
    implementation: "narrative",
  },
  FIVE_PARAGRAPH_ATTACHMENT: {
    label: "Five-paragraph attachment",
    implementation: "narrative",
  },
  TASK_ORGANIZATION_TREE: {
    label: "Task organization",
    implementation: "units",
  },
  MATRIX: { label: "Matrix", implementation: "matrix" },
  CHECKLIST: { label: "Checklist", implementation: "checklist" },
  PRODUCT_COLLECTION: {
    label: "Product collection",
    implementation: "generic",
  },
  REPORT_CATALOG: { label: "Report catalog", implementation: "reports" },
  DISTRIBUTION_LIST: {
    label: "Distribution list",
    implementation: "distribution",
  },
  SIGNAL_WORKSPACE: { label: "Signal workspace", implementation: "signal" },
  PLACEHOLDER_GRAPHIC: {
    label: "Graphic reference placeholder",
    implementation: "generic",
  },
  GENERIC_STRUCTURED_PRODUCT: {
    label: "Generic structured product",
    implementation: "generic",
  },
};
export function registeredEditor(hint: string) {
  const resolved = resolveEditor(hint);
  return { ...resolved, ...editorRegistry[resolved.capability] };
}

// This presentation registry controls the available first-party module editors.
// These implementation choices never become doctrine configuration.
export const moduleCapabilityRegistry: Record<
  ModuleType,
  { implementation: "module" | "units" | "signal" | "structured" }
> = {
  PLAIN_TEXT: { implementation: "module" },
  RICH_TEXT: { implementation: "module" },
  KEY_VALUE: { implementation: "module" },
  TABLE: { implementation: "module" },
  MATRIX: { implementation: "module" },
  CHECKLIST: { implementation: "module" },
  TIMELINE: { implementation: "module" },
  CHART: { implementation: "module" },
  IMAGE: { implementation: "module" },
  IMAGE_GALLERY: { implementation: "module" },
  FILE_ATTACHMENT: { implementation: "module" },
  CANONICAL_REFERENCES: { implementation: "module" },
  PLANNING_CARDS: { implementation: "module" },
  TASK_ORGANIZATION: { implementation: "units" },
  SIGNAL_NET_MATRIX: { implementation: "signal" },
  PACE: { implementation: "signal" },
  REPORT_CATALOG: { implementation: "structured" },
  DISTRIBUTION_LIST: { implementation: "structured" },
};
export const moduleOptions = moduleTypes.map((id) => ({
  id,
  name: id.replaceAll("_", " "),
}));
export function registeredModule(type: string) {
  return Object.hasOwn(moduleCapabilityRegistry, type)
    ? moduleCapabilityRegistry[type as ModuleType]
    : { implementation: "unsupported" as const };
}
