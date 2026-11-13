import type { ReactNode } from "react";
import { ModalBackdrop } from "./ModalBackdrop";

export function BuilderDialog({
  title,
  children,
  onClose,
  busy = false,
  closeLabel = "Close",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  closeLabel?: string;
}) {
  return (
    <ModalBackdrop>
      <section className="modal builder-dialog" aria-label={title}>
        <header className="builder-dialog-heading">
          <h2>{title}</h2>
          <button data-dialog-cancel disabled={busy} onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        {children}
      </section>
    </ModalBackdrop>
  );
}
