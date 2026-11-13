export const globalPages = [
  "Dashboard",
  "Operations",
  "Organizations",
  "Doctrines",
  "Military Symbols",
  "ORBATs",
  "Library",
  "Settings",
] as const;
export type GlobalPage = (typeof globalPages)[number];
export type WorkspaceLocation =
  | { area: "global"; page: GlobalPage }
  | { area: "operation"; operationId: string; page: string };
export const startupLocation = (): WorkspaceLocation => ({
  area: "global",
  page: "Dashboard",
});
export function enterOperation(
  operationId: string,
  page = "overview",
): WorkspaceLocation {
  return { area: "operation", operationId, page };
}
export function leaveOperation(
  page: GlobalPage = "Dashboard",
): WorkspaceLocation {
  return { area: "global", page };
}
