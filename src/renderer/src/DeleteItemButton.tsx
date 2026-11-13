import { useState } from "react";
import type { DeletionTarget } from "../../application/deletion-service";
import { useWorkspaceApi, useEditorProtection } from "./WorkspaceContext";

export function DeleteItemButton({
  target,
  label,
  ariaLabel,
  disabled = false,
  onDeleted,
}: {
  target: DeletionTarget;
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  onDeleted: () => void | Promise<void>;
}) {
  const api = useWorkspaceApi();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEditorProtection({ name: label, dirty: false, busy });
  return (
    <span className="delete-item-action">
      <button
        className="danger"
        aria-label={ariaLabel}
        data-delete-kind={target.kind}
        data-delete-id={target.id}
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          setBusy(true);
          setMessage("");
          void api
            .deleteItem(target)
            .then(async (result) => {
              if (result.deleted) await onDeleted();
              else
                setMessage(
                  result.reason === "referenced"
                    ? "This item is still in use. Nothing was removed."
                    : "Deletion canceled.",
                );
            })
            .catch((error) => setMessage(String(error)))
            .finally(() => setBusy(false));
        }}
      >
        {label}
      </button>
      {message && <small role="status">{message}</small>}
    </span>
  );
}
