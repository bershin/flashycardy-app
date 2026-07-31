"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Plugin } from "@tiptap/pm/state";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Code,
  Heading2,
  ImagePlus,
  Undo,
  Redo,
} from "lucide-react";
import { useEffect, useCallback } from "react";

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex size-7 items-center justify-center rounded text-sm transition-colors disabled:opacity-50 ${
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Images are stored inline as base64 in the card's HTML, which means every one
 * of them is carried in the synced `data.json` — and base64 inflates by a
 * further third when that file is uploaded. A photo straight off a phone can be
 * several megabytes; a handful of them would push the file toward GitHub's
 * 100 MB ceiling.
 *
 * Downscaling on the way in keeps that in check. 1600px is well beyond what the
 * card view renders, so there is no visible loss.
 */
const MAX_IMAGE_EDGE = 1600;
const IMAGE_QUALITY = 0.85;

function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = reader.result as string;

      // GIFs would lose their animation, and SVGs are vectors already.
      if (file.type === "image/gif" || file.type === "image/svg+xml") {
        resolve(dataUrl);
        return;
      }

      const image = new window.Image();
      // If decoding fails for any reason, fall back to the original rather
      // than losing the user's paste.
      image.onerror = () => resolve(dataUrl);
      image.onload = () => {
        const scale = Math.min(
          1,
          MAX_IMAGE_EDGE / Math.max(image.width, image.height),
        );
        if (scale === 1 && file.size < 512 * 1024) {
          resolve(dataUrl);
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);

        const context = canvas.getContext("2d");
        if (!context) {
          resolve(dataUrl);
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        // PNGs with transparency have to stay PNG; everything else compresses
        // far better as JPEG.
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        const resized = canvas.toDataURL(type, IMAGE_QUALITY);
        resolve(resized.length < dataUrl.length ? resized : dataUrl);
      };
      image.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

function insertImageFile(editor: Editor, file: File) {
  void downscaleImage(file).then((src) => {
    editor.chain().focus().setImage({ src }).run();
  });
}

function Toolbar({ editor }: { editor: Editor }) {
  const handleImageUpload = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) insertImageFile(editor, file);
    };
    input.click();
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1">
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold"
      >
        <Bold className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic"
      >
        <Italic className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
        title="Underline"
      >
        <UnderlineIcon className="size-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-border" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading"
      >
        <Heading2 className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <List className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered list"
      >
        <ListOrdered className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code block"
      >
        <Code className="size-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-border" />

      <ToolbarButton
        onClick={handleImageUpload}
        title="Insert image"
      >
        <ImagePlus className="size-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-border" />

      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo"
      >
        <Undo className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo"
      >
        <Redo className="size-3.5" />
      </ToolbarButton>
    </div>
  );
}

import { Extension } from "@tiptap/react";

const imagePastePlugin = Extension.create({
  name: "imagePaste",
  addProseMirrorPlugins() {
    const editorInstance = this.editor;
    return [
      new Plugin({
        props: {
          handlePaste(_view, event) {
            const items = event.clipboardData?.items;
            if (!items) return false;
            for (const item of items) {
              if (item.type.startsWith("image/")) {
                event.preventDefault();
                const file = item.getAsFile();
                if (file) insertImageFile(editorInstance, file);
                return true;
              }
            }
            return false;
          },
          handleDrop(_view, event) {
            const files = event.dataTransfer?.files;
            if (!files?.length) return false;
            for (const file of files) {
              if (file.type.startsWith("image/")) {
                event.preventDefault();
                insertImageFile(editorInstance, file);
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

export function RichTextEditor({
  content,
  onChange,
  placeholder,
  disabled,
  id,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
      Image.configure({ inline: false, allowBase64: true }),
      imagePastePlugin,
    ],
    content,
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    editorProps: {
      attributes: {
        id: id ?? "",
        class: "prose prose-sm dark:prose-invert max-w-none px-3 py-2 min-h-[80px] focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (editor && disabled !== undefined) {
      editor.setEditable(!disabled);
    }
  }, [editor, disabled]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-md border border-input bg-background ring-ring/10 focus-within:ring-2 focus-within:ring-ring">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
