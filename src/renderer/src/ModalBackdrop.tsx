import { useLayoutEffect, useRef, type ReactNode } from "react";

const dialogs: HTMLElement[] = [];
const focusable = (element: HTMLElement) =>
  [
    ...element.querySelectorAll<HTMLElement>(
      'button,input,select,textarea,a[href],[tabindex],[contenteditable="true"]',
    ),
  ].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(":disabled") &&
      !el.closest("[hidden],[inert]") &&
      el.getClientRects().length,
  );

/** Owns only focus and dismissal; the caller owns all edits and confirmation. */
export function ModalBackdrop({
  children,
  returnFocus,
}: {
  children: ReactNode;
  returnFocus?: HTMLElement | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = root.current!,
      dialog = host.querySelector<HTMLElement>(".modal,[role=dialog]")!;
    const previous =
      returnFocus ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;
    if (
      !dialog.hasAttribute("aria-label") &&
      !dialog.hasAttribute("aria-labelledby")
    ) {
      const heading = dialog.querySelector("h2,h3");
      if (heading) {
        heading.id ||= `dialog-${crypto.randomUUID()}`;
        dialog.setAttribute("aria-labelledby", heading.id);
      }
    }
    dialogs.push(dialog);
    const active = () => dialogs.at(-1) === dialog;
    let lastFocused: HTMLElement | null = null;
    const initial = () =>
      dialog.querySelector<HTMLElement>(
        "[data-dialog-initial]:not(:disabled)",
      ) ??
      dialog.querySelector<HTMLElement>(
        ".profile-picker input:not(:disabled),.create-operation input:not(:disabled),[data-dialog-cancel]:not(:disabled)",
      ) ??
      focusable(dialog)[0] ??
      dialog;
    initial().focus({ preventScroll: true });
    const restore = () => {
      const target =
        lastFocused?.isConnected &&
        !lastFocused.matches(":disabled") &&
        lastFocused.getClientRects().length
          ? lastFocused
          : initial();
      target.focus({ preventScroll: true });
    };
    const keydown = (event: KeyboardEvent) => {
      if (!active() || event.defaultPrevented) return;
      if (event.key === "Escape") {
        const cancel = dialog.querySelector<HTMLButtonElement>(
          "[data-dialog-cancel]",
        );
        if (cancel && !cancel.matches(":disabled")) {
          event.preventDefault();
          event.stopPropagation();
          cancel.click();
        }
      }
      if (event.key === "Tab") {
        const items = focusable(dialog),
          first = items[0] ?? dialog,
          last = items.at(-1) ?? dialog;
        if (
          !items.length ||
          (event.shiftKey
            ? document.activeElement === first ||
              document.activeElement === dialog
            : document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    const focus = (event: FocusEvent) => {
      if (!active()) return;
      if (dialog.contains(event.target as Node)) {
        if (event.target instanceof HTMLElement) lastFocused = event.target;
      } else restore();
    };
    host.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focus);
    return () => {
      dialogs.splice(dialogs.indexOf(dialog), 1);
      host.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focus);
      queueMicrotask(() => {
        if (previous?.isConnected && !previous.closest("[hidden],[inert]"))
          previous.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <div ref={root} className="modal-backdrop">
      {children}
    </div>
  );
}
