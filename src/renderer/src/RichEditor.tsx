import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { RichTextIcon, type RichTextIconName } from "./RichTextIcon";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  richDocumentSchema,
  safeUrl,
  type RichNode,
} from "../../domain/modules";

function ToolbarButton({
  label,
  icon,
  ...props
}: Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "title" | "aria-label"
> & { label: string; icon: RichTextIconName }) {
  return (
    <button
      {...props}
      type="button"
      className="rich-icon-button"
      aria-label={label}
      title={label}
    >
      <RichTextIcon name={icon} />
    </button>
  );
}
export function RichEditor({
  value,
  onChange,
  label,
  assets = {},
  importImage,
}: {
  value: RichNode;
  onChange: (v: RichNode) => void;
  label: string;
  assets?: Record<string, string>;
  importImage?: () => Promise<string | null>;
}) {
  const [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [linkOpen, setLinkOpen] = useState(false),
    [expanded, setExpanded] = useState(false);
  const changed = useRef(onChange),
    resources = useRef(assets),
    linkInput = useRef<HTMLInputElement>(null),
    linkSelection = useRef<{ from: number; to: number } | null>(null);
  changed.current = onChange;
  resources.current = assets;
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          code: false,
          codeBlock: false,
          strike: false,
          horizontalRule: false,
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false, autolink: false },
        }),
        Node.create({
          name: "image",
          group: "inline",
          inline: true,
          atom: true,
          addAttributes() {
            return {
              assetId: { default: null },
              alt: { default: "" },
              title: { default: null },
            };
          },
          parseHTML() {
            return [];
          },
          renderHTML({ node }) {
            return [
              "img",
              {
                src: resources.current[node.attrs.assetId] ?? "",
                alt: node.attrs.alt,
                title: node.attrs.title,
                "data-managed-image": node.attrs.assetId,
              },
            ];
          },
        }),
      ],
      content: value,
      editorProps: {
        attributes: {
          "aria-label": label,
          role: "textbox",
          "aria-multiline": "true",
          class: "rich-document",
        },
      },
      onUpdate: ({ editor }) => {
        const result = richDocumentSchema.safeParse(editor.getJSON());
        if (result.success) {
          try {
            changed.current(result.data);
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        } else setError(result.error.issues[0].message);
      },
    },
    [],
  );
  const formatting = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            paragraph: e.isActive("paragraph"),
            heading: e.isActive("heading"),
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            bullet: e.isActive("bulletList"),
            numbered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            link: e.isActive("link"),
            undo: e.can().undo(),
            redo: e.can().redo(),
            editable: e.isEditable,
          }
        : null,
  });
  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        attributes: {
          "aria-label": label,
          role: "textbox",
          "aria-multiline": "true",
          class: "rich-document",
        },
      },
    });
  }, [editor, label]);
  useEffect(() => {
    for (const image of editor?.view.dom.querySelectorAll<HTMLImageElement>(
      "img[data-managed-image]",
    ) ?? [])
      image.src = assets[image.dataset.managedImage ?? ""] ?? "";
  }, [editor, assets]);
  useEffect(() => {
    if (linkOpen) linkInput.current?.focus();
  }, [linkOpen]);
  useEffect(() => {
    if (editor && !editor.state.doc.eq(editor.schema.nodeFromJSON(value)))
      editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);
  useEffect(() => {
    if (!editor) return;
    const sync = () =>
      editor.setEditable(
        !editor.view.dom.closest("fieldset:disabled,[inert]"),
        false,
      );
    const observer = new MutationObserver(sync);
    for (
      let parent = editor.view.dom.parentElement;
      parent;
      parent = parent.parentElement
    )
      observer.observe(parent, {
        attributes: true,
        attributeFilter: ["disabled", "inert"],
      });
    sync();
    return () => observer.disconnect();
  }, [editor]);
  if (!editor) return null;
  const applyLink = () => {
    const href = link.trim();
    if (href && !safeUrl.safeParse(href).success) {
      setError("Use an http, https, or mailto link.");
      return;
    }
    const chain = editor.chain().focus();
    if (linkSelection.current) chain.setTextSelection(linkSelection.current);
    chain.extendMarkRange("link");
    if (href) chain.setLink({ href }).run();
    else chain.unsetLink().run();
    setError("");
    setLinkOpen(false);
  };
  return (
    <div
      className={`rich-editor${expanded ? " editor-expanded" : ""}`}
      onKeyDown={(e) => {
        if (e.altKey && e.key === "F10") {
          e.preventDefault();
          e.currentTarget
            .querySelector<HTMLButtonElement>(
              ".rich-toolbar button:not(:disabled)",
            )
            ?.focus();
        }
      }}
    >
      <div
        className="rich-toolbar"
        role="toolbar"
        aria-label={`${label} formatting`}
      >
        <ToolbarButton
          label="Paragraph"
          icon="paragraph"
          aria-pressed={formatting?.paragraph && !formatting?.heading}
          onClick={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolbarButton
          label="Heading"
          icon="heading"
          aria-pressed={formatting?.heading}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <ToolbarButton
          label="Bold"
          icon="bold"
          aria-pressed={formatting?.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          icon="italic"
          aria-pressed={formatting?.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Underline"
          icon="underline"
          aria-pressed={formatting?.underline}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          label="Bullet list"
          icon="bullet"
          aria-pressed={formatting?.bullet}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbered list"
          icon="numbered"
          aria-pressed={formatting?.numbered}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Quote"
          icon="quote"
          aria-pressed={formatting?.quote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label="Clear formatting"
          icon="clear"
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
        />
        <ToolbarButton
          label="Undo text"
          icon="undo"
          disabled={!formatting?.undo}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          label="Redo text"
          icon="redo"
          disabled={!formatting?.redo}
          onClick={() => editor.chain().focus().redo().run()}
        />
        <ToolbarButton
          label={formatting?.link ? "Edit link" : "Add link"}
          icon="link"
          aria-expanded={linkOpen}
          aria-pressed={formatting?.link}
          onClick={() => {
            linkSelection.current = {
              from: editor.state.selection.from,
              to: editor.state.selection.to,
            };
            setLink(editor.getAttributes("link").href ?? "");
            setError("");
            setLinkOpen(true);
          }}
        />
        {formatting?.link && (
          <ToolbarButton
            label="Remove link"
            icon="unlink"
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              setLinkOpen(false);
            }}
          />
        )}
        <ToolbarButton
          label={expanded ? "Collapse editor" : "Expand editor"}
          icon={expanded ? "collapse" : "expand"}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        />
        {importImage && (
          <ToolbarButton
            label="Insert managed image"
            icon="image"
            onClick={async () => {
              try {
                const id = await importImage();
                if (id)
                  editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: "image",
                      attrs: { assetId: id, alt: "Managed image", title: null },
                    })
                    .run();
              } catch (e) {
                setError(String(e));
              }
            }}
          />
        )}
      </div>
      {linkOpen && (
        <div
          className="rich-link-editor"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyLink();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setLinkOpen(false);
              setError("");
              editor.commands.focus();
            }
          }}
        >
          <label>
            Link address
            <input
              ref={linkInput}
              aria-label={`${label} link URL`}
              placeholder="https://…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
          <button type="button" onClick={applyLink}>
            Apply link
          </button>
          <button
            type="button"
            onClick={() => {
              setLinkOpen(false);
              setError("");
              editor.commands.focus();
            }}
          >
            Cancel link
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
