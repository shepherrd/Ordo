export function SaveStatus({
  busy,
  dirty,
  pending = false,
}: {
  busy: boolean;
  dirty: boolean;
  pending?: boolean;
}) {
  return (
    <span
      className={`save-status ${dirty || pending ? "unsaved" : "saved"}`}
      role="status"
      aria-live="polite"
    >
      {busy
        ? "Working…"
        : pending
          ? "Apply or discard highlighted field edits"
          : dirty
            ? "Unsaved changes"
            : "Saved"}
    </span>
  );
}
