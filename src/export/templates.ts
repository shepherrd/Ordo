import {
  renderTemplateSchema,
  type ExportProfile,
  type RenderTemplate,
} from "../domain/model";

// Presentation data has its own immutable identity, independent of doctrine,
// inclusion profiles, and the implementation that renders HTML.
export const builtInTemplates: readonly RenderTemplate[] = [
  renderTemplateSchema.parse({
    schemaVersion: 1,
    id: "40000000-0000-4000-8000-000000000001",
    version: 1,
    name: "Full OPORD",
    product: "opord",
    layout: "order-sections",
    accent: "#2b655e",
  }),
  renderTemplateSchema.parse({
    schemaVersion: 1,
    id: "40000000-0000-4000-8000-000000000002",
    version: 1,
    name: "Communications Card",
    product: "communications-card",
    layout: "signal-card",
    accent: "#2b655e",
  }),
];
export function templateFor(product: ExportProfile["product"]): RenderTemplate {
  return builtInTemplates.find((t) => t.product === product)!;
}
