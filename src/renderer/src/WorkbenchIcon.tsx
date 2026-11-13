/** Small toolbar symbols; the owning button supplies its label and tooltip. */
export function WorkbenchIcon({
  name,
}: {
  name: "undo" | "redo" | "reset" | "pan" | "expand" | "collapse" | "locate";
}) {
  const paths = {
    undo: "M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12",
    redo: "m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12",
    reset: "M4 10a8 8 0 1 1 0 5M4 4v6h6",
    pan: "M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3",
    expand: "M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6",
    collapse: "M3 9h6V3m6 0v6h6M3 15h6v6m6 0v-6h6",
    locate: "M12 2v4m0 12v4M2 12h4m12 0h4M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12",
  };
  return (
    <svg
      className="workbench-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  );
}
