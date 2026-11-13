import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../src/application/bridge";
import type { AppState } from "../src/application/service";
import { WorkspaceSession } from "../src/renderer/src/workspace-session";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const restored = { operations: [] } as unknown as AppState;
const fixture = (overrides: Partial<DesktopApi> = {}) => {
  const raw = {
    restore: vi.fn(async () => restored),
    execute: vi.fn(async () => restored),
    ...overrides,
  } as unknown as DesktopApi;
  const remount = vi.fn();
  return { raw, remount, session: new WorkspaceSession(raw, remount) };
};

describe("workspace lifecycle protection", () => {
  it("keeps unapplied symbol fields scoped independently from saved draft changes", () => {
    const { session } = fixture();
    const field = Symbol("field");
    const updates = vi.fn();
    session.subscribe(updates);
    session.update(field, {
      name: "Legacy function",
      dirty: true,
      busy: false,
      scope: "symbol-a",
    });
    session.update(field, {
      name: "Legacy function",
      dirty: true,
      busy: false,
      scope: "symbol-a",
      unappliedSymbolField: true,
    });
    expect(updates).toHaveBeenCalledTimes(2);
    expect(
      session.protectionFor("symbol-a").editors[0].unappliedSymbolField,
    ).toBe(true);
    expect(session.protectionFor("symbol-b").editors).toEqual([]);
    expect(session.protectsClose()).toBe(true);
    session.update(field, {
      name: "Legacy function",
      dirty: false,
      busy: false,
      scope: "symbol-a",
      unappliedSymbolField: true,
    });
    expect(session.protectsClose()).toBe(false);
  });

  it("attributes nested editor drafts and pending commands to their operation tab", async () => {
    const pending = deferred<AppState>();
    const { session } = fixture({ execute: () => pending.promise });
    session.update(Symbol(), {
      name: "Unapplied symbol field",
      dirty: true,
      busy: false,
      scope: "operation-a",
    });
    const request = session
      .apiForScope("operation-a")
      .execute({ type: "load" });
    expect(session.protectionFor("operation-a").pending).toBe(true);
    expect(session.protectionFor("operation-a").editors[0].dirty).toBe(true);
    expect(session.protectionFor("operation-b")).toEqual({
      pending: false,
      editors: [],
    });
    pending.resolve(restored);
    await request;
    expect(session.protectionFor("operation-a").pending).toBe(false);
  });

  it("lets independent previews finish during a canceled restore without losing their result", async () => {
    const dialog = deferred<AppState | null>();
    const { session } = fixture({
      restore: () => dialog.promise,
      renderGraphic: async () =>
        ({ result: { svg: "exact preview" } }) as never,
    });
    const restoring = session.api.restore();
    await expect(
      session.api.renderGraphic("request", {} as never),
    ).resolves.toEqual({ result: { svg: "exact preview" } });
    dialog.resolve(null);
    await restoring;
    expect(session.protectsClose()).toBe(false);
  });

  it("reports every hidden dirty editor and does not open a restore dialog", async () => {
    const { raw, session } = fixture();
    for (const name of [
      "Symbols — draft",
      "ORBATs — draft",
      "Organizations",
      "Doctrine Builder",
      "Operation",
      "Local preferences",
    ])
      session.update(Symbol(name), { name, dirty: true, busy: false });
    expect(session.protectsClose()).toBe(true);
    await expect(session.api.restore()).rejects.toThrow(
      /Symbols.*ORBATs.*Organizations.*Doctrine Builder.*Operation.*Local preferences/,
    );
    expect(raw.restore).not.toHaveBeenCalled();
  });

  it("keeps a save protected until both persistence and editor acknowledgement finish", async () => {
    const save = deferred<AppState>();
    const { session } = fixture({ execute: () => save.promise });
    const editor = Symbol();
    session.update(editor, { name: "Operation", dirty: true, busy: true });
    const saving = session.api.execute({ type: "load" });
    expect(session.snapshot().pending).toBe(1);
    save.resolve(restored);
    await saving;
    expect(session.snapshot().pending).toBe(0);
    expect(session.protectsClose()).toBe(true);
    await expect(session.api.restore()).rejects.toThrow(/Operation/);
    session.update(editor, { name: "Operation", dirty: false, busy: false });
    expect(session.protectsClose()).toBe(false);
  });

  it("does not clear a draft when its persistence request fails", async () => {
    const { session } = fixture({
      execute: async () => {
        throw Error("disk write failed");
      },
    });
    session.update(Symbol(), { name: "Draft", dirty: true, busy: false });
    await expect(session.api.execute({ type: "load" })).rejects.toThrow(
      "disk write failed",
    );
    expect(session.snapshot().pending).toBe(0);
    expect(session.protectsClose()).toBe(true);
    await expect(session.api.restore()).rejects.toThrow(/Draft/);
  });

  it("blocks restore during an in-flight request even before a React busy update", async () => {
    const request = deferred<AppState>();
    const { session, raw } = fixture({ execute: () => request.promise });
    const response = session.api.execute({ type: "load" });
    await expect(session.api.restore()).rejects.toThrow(
      /ongoing workspace work/,
    );
    expect(raw.restore).not.toHaveBeenCalled();
    request.resolve(restored);
    await response;
    await expect(session.api.restore()).resolves.toEqual(restored);
  });

  it.each(["cancel", "fail"])(
    "preserves the current session after restore %s",
    async (mode) => {
      const { session, remount } = fixture({
        restore: async () => {
          if (mode === "fail") throw Error("Invalid backup");
          return null;
        },
      });
      if (mode === "fail")
        await expect(session.api.restore()).rejects.toThrow("Invalid backup");
      else expect(await session.api.restore()).toBeNull();
      expect(remount).not.toHaveBeenCalled();
      expect(session.snapshot().restoring).toBe(false);
      await expect(session.api.execute({ type: "load" })).resolves.toEqual(
        restored,
      );
    },
  );

  it("blocks new commands and duplicate restore while the restore dialog is open", async () => {
    const dialog = deferred<AppState | null>();
    const { session, raw } = fixture({ restore: () => dialog.promise });
    const restoring = session.api.restore();
    expect(session.protectsClose()).toBe(true);
    await expect(session.api.execute({ type: "load" })).rejects.toThrow(
      /restore is in progress/,
    );
    await expect(session.api.restore()).rejects.toThrow(
      /restore is in progress/,
    );
    expect(raw.execute).not.toHaveBeenCalled();
    dialog.resolve(null);
    await restoring;
    expect(session.protectsClose()).toBe(false);
  });

  it("rejects old callbacks after successful restore before they reach the new database", async () => {
    const { session, raw, remount } = fixture();
    session.search.register("operation:fixture", []);
    const capturedApi = session.api;
    await session.api.restore();
    expect(session.search.owners()).toEqual([]);
    expect(remount).toHaveBeenCalledOnce();
    await expect(capturedApi.execute({ type: "load" })).rejects.toThrow(
      /previous workspace/,
    );
    expect(raw.execute).not.toHaveBeenCalled();
    await expect(
      new WorkspaceSession(raw, () => {}).api.execute({ type: "load" }),
    ).resolves.toEqual(restored);
  });

  it("rejects a stale background render response while still allowing cleanup cancellation", async () => {
    const render = deferred<Awaited<ReturnType<DesktopApi["renderGraphic"]>>>();
    const cancelGraphic = vi.fn(async () => {});
    const { session } = fixture({
      renderGraphic: () => render.promise,
      cancelGraphic,
    });
    const pending = session.api.renderGraphic("request", {} as never);
    // Preview workers must not make a workspace permanently unrestorable.
    expect(session.protectsClose()).toBe(false);
    await session.api.restore();
    render.resolve({} as never);
    await expect(pending).rejects.toThrow(/previous workspace/);
    await session.api.cancelGraphic("request");
    expect(cancelGraphic).toHaveBeenCalledWith("request");
  });

  it("removes only the unmounted editor and still protects other drafts", () => {
    const { session } = fixture();
    const a = Symbol(),
      b = Symbol();
    session.update(a, { name: "A", dirty: true, busy: false });
    session.update(b, { name: "B", dirty: true, busy: false });
    session.remove(a);
    expect(session.snapshot().dirty.map((s) => s.name)).toEqual(["B"]);
    session.update(b, { name: "B", dirty: false, busy: false });
    expect(session.protectsClose()).toBe(false);
  });
});
