import type { ReactNode } from "react";

const icons = {
  paragraph: <path d="M13 20V4H9a5 5 0 0 0 0 10h4M18 4v16M13 4h7" />,
  heading: <path d="M5 4v16M19 4v16M5 12h14" />,
  bold: <path d="M6 4h7a4 4 0 0 1 0 8H6zm0 8h8a4 4 0 0 1 0 8H6z" />,
  italic: <path d="M10 4h9M5 20h9M15 4 9 20" />,
  underline: <path d="M6 3v7a6 6 0 0 0 12 0V3M4 21h16" />,
  bullet: (
    <>
      <path d="M9 5h12M9 12h12M9 19h12" />
      <circle cx="4" cy="5" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="19" r="1" />
    </>
  ),
  numbered: (
    <>
      <path d="M10 5h11M10 12h11M10 19h11" />
      <g
        fill="currentColor"
        stroke="none"
        fontSize="8"
        fontFamily="Arial, sans-serif"
      >
        <text x="2" y="8">
          1
        </text>
        <text x="2" y="15">
          2
        </text>
        <text x="2" y="22">
          3
        </text>
      </g>
    </>
  ),
  quote: (
    <>
      <path d="M4 5h6v7H4zM10 12c0 5-2 7-6 7M14 5h6v7h-6zM20 12c0 5-2 7-6 7" />
    </>
  ),
  clear: <path d="m4 12 9-9 8 8-9 9H8l-5-5a2 2 0 0 1 1-3zm3-3 8 8M12 20h9" />,
  undo: <path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-2" />,
  redo: <path d="m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12h2" />,
  link: (
    <path d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
  ),
  unlink: (
    <path d="m9 15-2 2a4 4 0 0 1-6-6l2-2m12 0 2-2a4 4 0 0 1 6 6l-2 2M4 3l17 18M12 3v3M3 20l3-3M18 3l-3 3" />
  ),
  expand: (
    <path d="M9 3H3v6M3 3l6 6M15 3h6v6M21 3l-6 6M3 15v6h6M3 21l6-6M21 15v6h-6M21 21l-6-6" />
  ),
  collapse: (
    <path d="M3 9h6V3M9 9 3 3M15 3v6h6M15 9l6-6M3 15h6v6M9 15l-6 6M15 21v-6h6M15 15l6 6" />
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 5-5 4 4 4-5 5 6" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type RichTextIconName = keyof typeof icons;

export function RichTextIcon({ name }: { name: RichTextIconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {icons[name]}
    </svg>
  );
}
