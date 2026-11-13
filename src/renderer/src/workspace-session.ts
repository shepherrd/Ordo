import type { DesktopApi } from "../../application/bridge";
import type { DraftSummary } from "../../application/working-drafts";
import { SearchSession } from "./search-session";

export type EditorProtection = {
  name: string;
  dirty: boolean;
  busy: boolean;
  scope?: string;
  primary?: boolean;
  unappliedSymbolField?: boolean;
};

// This state belongs to the desktop workspace, never to operation history.
// An API captured by an old editor cannot issue commands after a restore.
export class WorkspaceSession {
  readonly search = new SearchSession();
  private editors = new Map<symbol, EditorProtection>();
  private pending = new Map<symbol, { writing: boolean; scope?: string }>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private retired = false;
  private restoring = false;
  readonly api: DesktopApi;
  recoveryTarget: (DraftSummary & { nonce: number }) | null = null;
  openRecovery(draft: DraftSummary) {
    this.recoveryTarget = {
      ...draft,
      nonce: (this.recoveryTarget?.nonce ?? 0) + 1,
    };
    this.emit();
  }

  constructor(
    private readonly raw: DesktopApi,
    private readonly onRestored: () => void,
    readonly restored = false,
  ) {
    this.api = this.apiForScope();
  }
  apiForScope(scope?: string): DesktopApi {
    return Object.fromEntries(
      Object.keys(this.raw).map((method) => [
        method,
        (...args: unknown[]) =>
          this.invoke(method as keyof DesktopApi, args, scope),
      ]),
    ) as unknown as DesktopApi;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getRevision = () => this.revision;
  private emit() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
  update(id: symbol, status: EditorProtection) {
    const previous = this.editors.get(id);
    if (
      previous?.name === status.name &&
      previous.dirty === status.dirty &&
      previous.busy === status.busy &&
      previous.scope === status.scope &&
      previous.primary === status.primary &&
      previous.unappliedSymbolField === status.unappliedSymbolField
    )
      return;
    this.editors.set(id, status);
    this.emit();
  }
  remove(id: symbol) {
    if (this.editors.delete(id)) this.emit();
  }
  snapshot() {
    const editors = [...this.editors.values()];
    return {
      dirty: editors.filter((e) => e.dirty),
      busy: editors.filter((e) => e.busy),
      pending: this.pending.size,
      writing: [...this.pending.values()].some((p) => p.writing),
      restoring: this.restoring,
    };
  }
  protectionFor(scope?: string) {
    return {
      editors: [...this.editors.values()].filter((e) => e.scope === scope),
      pending: [...this.pending.values()].some((p) => p.scope === scope),
    };
  }
  protectsClose() {
    const state = this.snapshot();
    return !!(
      state.dirty.length ||
      state.busy.length ||
      state.pending ||
      state.restoring
    );
  }
  private assertCurrent(allowRestore = false) {
    if (this.retired)
      throw Error(
        "This editor belongs to the previous workspace. Reopen it from the current catalog.",
      );
    if (this.restoring && !allowRestore)
      throw Error("Workspace restore is in progress. Please wait.");
  }
  private async restore() {
    this.assertCurrent();
    const state = this.snapshot();
    if (state.dirty.length)
      throw Error(
        `Save or discard unsaved changes before restoring: ${state.dirty.map((s) => s.name).join(", ")}.`,
      );
    if (state.busy.length || state.pending)
      throw Error(
        `Wait for ongoing workspace work before restoring${state.busy.length ? `: ${state.busy.map((s) => s.name).join(", ")}` : ""}.`,
      );
    this.restoring = true;
    this.emit();
    try {
      const result = await this.raw.restore();
      if (result) {
        this.retired = true;
        this.search.clear();
        this.onRestored();
      }
      return result;
    } finally {
      this.restoring = false;
      this.emit();
    }
  }
  private async invoke(
    method: keyof DesktopApi,
    args: unknown[],
    scope?: string,
  ) {
    // Cleanup can cancel old worker/import requests after their editor unmounts.
    if (method === "cancelGraphic" || method === "cancelLibraryImport")
      return (this.raw[method] as (...args: unknown[]) => Promise<unknown>)(
        ...args,
      );
    if (method === "restore") return this.restore();
    const id = Symbol(method);
    const background =
      method === "renderGraphic" ||
      method === "symbolCatalog" ||
      method === "search" ||
      method === "searchUsage" ||
      method === "resolveSearch" ||
      method === "recovery";
    this.assertCurrent(method !== "recovery" && background);
    if (!background) {
      this.pending.set(id, { writing: writesWorkspace(method, args), scope });
      this.emit();
    }
    try {
      const result = await (
        this.raw[method] as (...args: unknown[]) => Promise<unknown>
      )(...args);
      this.assertCurrent(background);
      return result;
    } finally {
      if (this.pending.delete(id)) this.emit();
    }
  }
}

function writesWorkspace(method: keyof DesktopApi, args: unknown[]): boolean {
  const command = args[0] as
    { type?: string; preferences?: unknown } | undefined;
  if (
    method === "search" ||
    method === "resolveSearch" ||
    method === "searchUsage"
  )
    return false;
  // Opening a saved draft can adopt a compatible doctrine update.
  if (method === "execute") return true;
  if (method === "graphicImage") return false;
  if (method === "office")
    return !["list", "inspect"].includes(command?.type ?? "");
  if (method === "whiteboards")
    return !["list", "preview"].includes(command?.type ?? "");
  if (method === "documents") return command?.type !== "list";
  if (method === "organizations") return command?.type === "save";
  if (method === "workspace") {
    if (command?.type === "preferences") return !!command.preferences;
    return ![
      "dashboard",
      "browse-operations",
      "doctrine-summaries",
      "browse-unit-profiles",
      "unit-profile-get",
      "library",
    ].includes(command?.type ?? "");
  }
  if (method === "symbols")
    return !["browse", "get", "symbol-pin", "profile-node"].includes(
      command?.type ?? "",
    );
  return [
    "deleteItem",
    "reviews",
    "files",
    "backup",
    "commitLibraryImport",
    "exportGraphic",
    "saveGraphic",
    "saveHtml",
    "saveReviewReport",
  ].includes(method);
}
