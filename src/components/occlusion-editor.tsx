"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Loader2, ScanText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { boxStyle, usePictureUrl } from "@/components/occlusion-picture";
import { transcribeImageAction } from "@/app/deck/actions";
import {
  MIN_BOX,
  clampBox,
  newOcclusionId,
  type OcclusionBox,
} from "@/lib/occlusion";

type Drag =
  | { kind: "draw"; startX: number; startY: number; box: OcclusionBox }
  | { kind: "move"; startX: number; startY: number; from: OcclusionBox }
  | { kind: "resize"; startX: number; startY: number; from: OcclusionBox };

/**
 * Cover a picture's labels: drag across each word, then say what it was.
 *
 * Each box becomes a card when the set is saved. Boxes are kept as fractions of
 * the picture, so they stay on their words whatever size it is shown at.
 */
export function OcclusionEditor({
  src,
  boxes,
  onChange,
  disabled,
}: {
  /** The picture as the question holds it: `data:` or `cue:`. */
  src: string;
  boxes: OcclusionBox[];
  onChange: (boxes: OcclusionBox[]) => void;
  disabled?: boolean;
}) {
  const url = usePictureUrl(src);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  /**
   * The same drag, readable from the next event. A quick flick can deliver its
   * last move and the release before React has drawn the move, and a release
   * reading the drawn state then sees a box with no size and drops it.
   */
  const dragRef = useRef<Drag | null>(null);
  function setDrag(next: Drag | null) {
    dragRef.current = next;
    setDragState(next);
  }
  const [reading, setReading] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [note, setNote] = useState<string | null>(null);
  const inlineRef = useRef<HTMLInputElement>(null);
  /** Set when a box has just been drawn, so its label field takes the keys. */
  const focusLabel = useRef(false);

  // Into the field under the box, not the list: the list is below the picture,
  // and scrolling to it would carry the picture away just as the next label is
  // about to be covered. Before paint, so the first key typed lands in it.
  useLayoutEffect(() => {
    if (!focusLabel.current || !inlineRef.current) return;
    focusLabel.current = false;
    inlineRef.current.focus({ preventScroll: true });
  });

  /** The pointer as a fraction of the picture. */
  function at(e: React.PointerEvent) {
    const r = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
      y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
    };
  }

  /** What is on screen: the box being drawn or dragged replaces its old self. */
  const shown =
    drag?.kind === "draw" ? [...boxes, drag.box] : boxes;

  function startDraw(e: React.PointerEvent) {
    if (disabled || e.button !== 0) return;
    const p = at(e);
    stageRef.current!.setPointerCapture(e.pointerId);
    setSelected(null);
    setDrag({
      kind: "draw",
      startX: p.x,
      startY: p.y,
      box: { id: newOcclusionId(), x: p.x, y: p.y, w: 0, h: 0, label: "" },
    });
  }

  function startOnBox(e: React.PointerEvent, box: OcclusionBox, kind: "move" | "resize") {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    const p = at(e);
    stageRef.current!.setPointerCapture(e.pointerId);
    setSelected(box.id);
    setDrag({ kind, startX: p.x, startY: p.y, from: box });
  }

  /** The box being drawn, stretched to the pointer. */
  function drawn(drag: Extract<Drag, { kind: "draw" }>, e: React.PointerEvent) {
    const p = at(e);
    return {
      ...drag.box,
      x: Math.min(drag.startX, p.x),
      y: Math.min(drag.startY, p.y),
      w: Math.abs(p.x - drag.startX),
      h: Math.abs(p.y - drag.startY),
    };
  }

  function onMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = at(e);
    if (drag.kind === "draw") {
      setDrag({ ...drag, box: drawn(drag, e) });
      return;
    }
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    const moved =
      drag.kind === "move"
        ? {
            ...drag.from,
            x: Math.min(Math.max(drag.from.x + dx, 0), 1 - drag.from.w),
            y: Math.min(Math.max(drag.from.y + dy, 0), 1 - drag.from.h),
          }
        : clampBox({ ...drag.from, w: drag.from.w + dx, h: drag.from.h + dy });
    onChange(boxes.map((b) => (b.id === moved.id ? moved : b)));
  }

  function onUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (drag?.kind === "draw") {
      const box = drawn(drag, e);
      // A click, not a drag: nothing to cover.
      if (box.w >= MIN_BOX * 2 && box.h >= MIN_BOX) {
        onChange([...boxes, clampBox(box)]);
        setSelected(box.id);
        focusLabel.current = true;
      }
    }
    setDrag(null);
  }

  function remove(id: string) {
    onChange(boxes.filter((b) => b.id !== id));
    if (selected === id) setSelected(null);
  }

  function setLabel(id: string, label: string) {
    onChange(boxes.map((b) => (b.id === id ? { ...b, label } : b)));
  }

  /**
   * Read each unlabelled box's word off the picture.
   *
   * One box at a time, cut out and enlarged: a whole diagram read in one go
   * comes back as a list of words with no way to tell which box each belongs
   * to, whereas a crop of one label can only be that label.
   */
  async function readLabels() {
    const image = imageRef.current;
    if (!image) return;
    const todo = boxes.filter((b) => !b.label.trim());
    if (todo.length === 0) return;
    setNote(null);
    setReading({ done: 0, total: todo.length });
    let current = boxes;
    try {
      for (const [i, box] of todo.entries()) {
        const text = await transcribeImageAction(crop(image, box));
        if (text) {
          const label = text.replace(/\s+/g, " ").trim();
          current = current.map((b) => (b.id === box.id ? { ...b, label } : b));
          onChange(current);
        }
        setReading({ done: i + 1, total: todo.length });
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Couldn't read the picture.");
    } finally {
      setReading(null);
    }
  }

  const unlabelled = boxes.filter((b) => !b.label.trim()).length;
  const current = boxes.find((b) => b.id === selected);

  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted-foreground">
        Drag across each word you want hidden, then type what it says. Drag a
        box to move it; click it to show its corner for resizing.
      </p>

      <div
        ref={stageRef}
        onPointerDown={startDraw}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        className={`relative mx-auto w-fit max-w-full touch-none select-none ${
          disabled ? "opacity-60" : "cursor-crosshair"
        }`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- an object or data URL, which next/image cannot optimise
          <img
            ref={imageRef}
            src={url}
            alt="The picture whose labels are being hidden"
            draggable={false}
            className="pointer-events-none block h-auto max-h-[60vh] max-w-full rounded-md"
          />
        ) : (
          <div className="flex h-40 w-64 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            Loading picture…
          </div>
        )}
        {url &&
          shown.map((box, index) => (
            <div
              key={box.id}
              style={boxStyle(box)}
              onPointerDown={(e) => startOnBox(e, box, "move")}
              className={`absolute flex cursor-move items-center justify-center rounded-sm border-2 text-xs font-bold ${
                box.id === selected
                  ? "border-violet-600 bg-violet-500/40 text-white"
                  : "border-amber-500 bg-amber-300/60 text-amber-950"
              }`}
            >
              {index + 1}
              {box.id === selected && (
                <span
                  onPointerDown={(e) => startOnBox(e, box, "resize")}
                  className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-full border-2 border-white bg-violet-600"
                />
              )}
            </div>
          ))}
        {url && current && !drag && (
          <input
            ref={inlineRef}
            value={current.label}
            disabled={disabled}
            placeholder="What's under it?"
            aria-label="Label for the selected box"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setLabel(current.id, e.target.value)}
            onKeyDown={(e) => {
              // Enter finishes this label rather than submitting the card.
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setSelected(null);
              }
            }}
            style={{
              left: `${Math.min(current.x, 0.6) * 100}%`,
              top: `calc(${(current.y + current.h) * 100}% + 4px)`,
            }}
            className="absolute z-10 h-7 w-40 rounded-md border border-violet-500 bg-background px-2 text-xs shadow-md outline-none"
          />
        )}
      </div>

      {boxes.length > 0 && (
        <ol className="grid gap-1.5">
          {boxes.map((box, index) => (
            <li
              key={box.id}
              className={`flex items-center gap-2 rounded-md px-1 ${
                box.id === selected ? "bg-violet-500/10" : ""
              }`}
            >
              <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <Input
                id={`occlusion-label-${box.id}`}
                value={box.label}
                disabled={disabled}
                placeholder="What's under this box?"
                aria-label={`Label for box ${index + 1}`}
                onFocus={() => setSelected(box.id)}
                onChange={(e) => setLabel(box.id, e.target.value)}
                // Enter here would submit the card with the other labels unfilled.
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                onClick={() => remove(box.id)}
              >
                <X className="size-4" />
                <span className="sr-only">Remove box {index + 1}</span>
              </Button>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {unlabelled > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || reading !== null}
            onClick={() => void readLabels()}
          >
            {reading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ScanText className="size-3.5" />
            )}
            {reading
              ? `Reading ${reading.done + 1} of ${reading.total}…`
              : `Fill in ${unlabelled === 1 ? "the label" : `${unlabelled} labels`} from the picture`}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {boxes.length === 0
            ? "Each box becomes its own card."
            : `Saving makes ${boxes.length} card${boxes.length === 1 ? "" : "s"}, one per box, sharing this picture.`}
        </p>
      </div>
      {note && <p className="text-xs text-destructive">{note}</p>}
    </div>
  );
}

/** One box cut out of the picture, enlarged so small print reads clearly. */
function crop(image: HTMLImageElement, box: OcclusionBox): string {
  const sw = box.w * image.naturalWidth;
  const sh = box.h * image.naturalHeight;
  const scale = Math.max(1, 400 / Math.max(sw, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    box.x * image.naturalWidth,
    box.y * image.naturalHeight,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas.toDataURL("image/png");
}
