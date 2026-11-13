import countries from "./resources/flags-7.5.0.json";
import nato from "./resources/nato-flag-replacement-v1.json";
export const flagResources: Record<
  string,
  { name: string; svg: string; sha256: string }
> = { ...countries, ...nato.flags };
