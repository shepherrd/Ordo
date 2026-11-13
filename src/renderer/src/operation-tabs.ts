// Open editors are local presentation state, never operation workflow state.
export interface OperationEditorStatus {
  name: string;
  dirty: boolean;
  busy: boolean;
}
export interface OperationEditorHandle {
  save: () => Promise<void>;
}
export interface OperationTab extends OperationEditorStatus {
  id: string;
  requestPage: string;
  requestNonce: number;
}
export const operationTabsKey = "ordo.open-operation-tabs.v1";
export const newOperationTab = (
  id: string,
  page = "overview",
): OperationTab => ({
  id,
  name: "Opening operation…",
  dirty: false,
  busy: true,
  requestPage: page,
  requestNonce: 0,
});
export function restoreOperationTabs(): OperationTab[] {
  try {
    const ids: unknown = JSON.parse(
      localStorage.getItem(operationTabsKey) ?? "[]",
    );
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids)]
      .filter(
        (id): id is string =>
          typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id),
      )
      .map((id) => newOperationTab(id));
  } catch {
    return [];
  }
}
