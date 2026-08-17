"use client";

import {
  useEditor,
  useEditorState,
  EditorContent,
  type Editor,
} from "@tiptap/react";
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
  SquareCode,
  Heading2,
  ImagePlus,
  ScanText,
  Undo,
  Redo,
} from "lucide-react";
import { useEffect, useCallback, useState } from "react";
import { transcribeImageAction } from "@/app/deck/actions";

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
 * The dimensions matter twice over, and the second time is the expensive one: a
 * decoded image costs width × height × 4 bytes of memory however well it
 * compressed, so 1600px meant about 3 MB of bitmap for every scan on screen.
 *
 * 1200px is still more than twice what the card view renders, so the picture on
 * the card is unchanged; only opening one at full resolution is softer, and
 * against roughly half the memory that is the better bargain.
 */
const MAX_IMAGE_EDGE = 1200;
const IMAGE_QUALITY = 0.8;

/**
 * How large a single encoded image may be, counted in characters of its base64
 * data URL. Comfortably under the per-field limit in `deck/actions.ts`, so a
 * card can hold several images without the save being rejected.
 */
const IMAGE_BUDGET = 400_000;

/**
 * Encode a canvas, preferring WebP.
 *
 * WebP keeps transparency *and* compresses screenshots to a fraction of PNG.
 * That combination matters: the old code kept PNG sources as PNG to preserve
 * the alpha channel, but `toDataURL` ignores the quality argument for PNG
 * because PNG is lossless — so a pasted screenshot came through at full size
 * and was rejected by the save.
 */
function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
  sourceType: string,
): string {
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;

  // A browser that cannot write WebP quietly hands back PNG instead, so fall
  // back explicitly — to PNG where transparency might matter, JPEG otherwise.
  const fallback = sourceType === "image/png" ? "image/png" : "image/jpeg";
  return canvas.toDataURL(fallback, quality);
}

function renderAt(
  image: HTMLImageElement,
  edge: number,
  quality: number,
  sourceType: string,
): string | null {
  const scale = Math.min(1, edge / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return encodeCanvas(canvas, quality, sourceType);
}

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
        let best = dataUrl;
        let edge = MAX_IMAGE_EDGE;
        let quality = IMAGE_QUALITY;

        // Give up dimensions and quality only as far as the budget demands. A
        // screenshot almost always fits on the first pass; a photograph off a
        // phone may take one or two more.
        for (let attempt = 0; attempt < 4; attempt++) {
          const encoded = renderAt(image, edge, quality, file.type);
          if (encoded !== null && encoded.length < best.length) best = encoded;
          if (best.length <= IMAGE_BUDGET) break;
          edge = Math.round(edge * 0.75);
          quality = Math.max(0.5, quality - 0.1);
        }

        resolve(best);
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

/**
 * Turn the selected image into the text printed on it.
 *
 * Only offered while an image is selected, because that is the only time it
 * means anything — and it replaces that image alone, leaving the rest of the
 * card untouched. A picture with nothing to read says so and stays put: a
 * shape puzzle is the picture, and swapping it for a description would destroy
 * the card rather than convert it.
 */
function ConvertImageButton({ editor }: { editor: Editor }) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Subscribed rather than read: selecting an image changes the selection but
  // not the document, and the toolbar only re-renders for document changes on
  // its own. Without this the button would never appear.
  const selectedImage = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e.isActive("image")
        ? (e.getAttributes("image").src as string | undefined)
        : undefined,
  });

  async function convert() {
    if (!selectedImage) return;
    setPending(true);
    setNote(null);
    try {
      const text = await transcribeImageAction(selectedImage);
      if (text === null) {
        setNote("No text found in that image — leaving it as it is.");
        return;
      }
      // Paragraph per line, so a transcribed list keeps its shape instead of
      // collapsing into one run-on block.
      const html = text
        .split(/\n{2,}|\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("");
      editor.chain().focus().deleteSelection().insertContent(html).run();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Couldn't read that image.");
    } finally {
      setPending(false);
    }
  }

  if (!selectedImage) return null;

  return (
    <>
      <div className="mx-1 h-4 w-px bg-border" />
      <button
        type="button"
        onClick={convert}
        disabled={pending}
        title="Replace this image with the text printed on it"
        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <ScanText className="size-3.5" />
        {pending ? "Reading…" : "Image to text"}
      </button>
      {note && (
        <span className="ml-1 text-xs text-muted-foreground">{note}</span>
      )}
    </>
  );
}

/** Transcribed text is content, not markup — it goes in as characters. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      {/* Inline code sits next to the block form because the two are easy to
          confuse: this one highlights a word mid-sentence, the other takes a
          whole paragraph. */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code (⌘E)"
      >
        <Code className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code block"
      >
        <SquareCode className="size-3.5" />
      </ToolbarButton>

      <div className="mx-1 h-4 w-px bg-border" />

      <ToolbarButton
        onClick={handleImageUpload}
        title="Insert image"
      >
        <ImagePlus className="size-3.5" />
      </ToolbarButton>

      <ConvertImageButton editor={editor} />

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

  /**
   * Follow `content` when the parent changes it.
   *
   * TipTap reads `content` only when the editor is created, so a dialog that
   * stays mounted kept showing the previous card's text — reopening "Add card"
   * arrived with the last card's answer already filled in.
   *
   * Comparing against the current HTML stops this fighting with typing: each
   * keystroke round-trips through the parent and comes back identical, so the
   * effect does nothing. `emitUpdate: false` keeps a programmatic reset from
   * being reported back as a user edit.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (content === editor.getHTML()) return;
    editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div className="overflow-hidden rounded-md border border-input bg-background ring-ring/10 focus-within:ring-2 focus-within:ring-ring">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
