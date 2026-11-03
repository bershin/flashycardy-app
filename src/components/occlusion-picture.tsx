"use client";

import { useEffect, useRef, useState } from "react";
import { CardHtml } from "@/components/card-html";
import type { CardRow } from "@/lib/store/types";
import { cachedUrl, resolveImage } from "@/lib/image-urls";
import { IMAGE_PREFIX } from "@/lib/images";
import {
  boxHint,
  firstImageSrc,
  targetBox,
  withoutFirstImage,
  wordHint,
  type OcclusionBox,
  type OcclusionPayload,
} from "@/lib/occlusion";

/**
 * Something an `<img>` can show for a card's picture.
 *
 * In the editor a freshly pasted picture is still a `data:` URL; once saved it
 * is a `cue:` reference that has to be looked up. Null while looking, and for
 * a picture this device does not have yet.
 */
export function usePictureUrl(src: string | null): string | null {
  const hash = src?.startsWith(IMAGE_PREFIX)
    ? src.slice(IMAGE_PREFIX.length)
    : null;
  const [resolved, setResolved] = useState<{ hash: string; url: string } | null>(
    null,
  );

  useEffect(() => {
    if (!hash || cachedUrl(hash)) return;
    let live = true;
    void resolveImage(hash).then((url) => {
      if (live && url) setResolved({ hash, url });
    });
    return () => {
      live = false;
    };
  }, [hash]);

  if (!src) return null;
  if (!hash) return src;
  return cachedUrl(hash) ?? (resolved?.hash === hash ? resolved.url : null);
}

/** Where a box sits, as CSS on a box laid over the picture. */
export function boxStyle(box: OcclusionBox): React.CSSProperties {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  };
}

export type WordTile = {
  id: string;
  text: string;
  tone: "hidden" | "found" | "missed" | "shown" | "new" | "known";
  title?: string;
  onClick?: () => void;
};

const TILE_TONE: Record<WordTile["tone"], string> = {
  hidden: "bg-amber-300/80 text-amber-950 dark:bg-amber-400/80",
  new: "bg-amber-300/80 text-amber-950 dark:bg-amber-400/80",
  found:
    "bg-emerald-500/10 font-semibold text-emerald-700 ring-2 ring-emerald-500 dark:text-emerald-400",
  known: "bg-emerald-300 text-emerald-950 dark:bg-emerald-400",
  missed:
    "bg-red-500/10 font-semibold text-red-700 ring-2 ring-red-500 dark:text-red-400",
  shown: "bg-muted text-muted-foreground",
};

/**
 * A typed set's words with no picture behind them: a tile per word, showing
 * its clue (or a blank per letter) while hidden and the word once it is out.
 * The tiles stand where the picture would, so the round reads the same way.
 */
export function WordTiles({ tiles }: { tiles: WordTile[] }) {
  return (
    // Not a <ul>: the study card's rich-text styles would put bullets on it.
    <div role="list" className="flex flex-wrap justify-center gap-2">
      {tiles.map((tile) => {
        const className = `min-w-24 rounded-lg px-3 py-2 text-center text-base leading-snug ${TILE_TONE[tile.tone]}`;
        return (
          <div key={tile.id} role="listitem">
            {tile.onClick ? (
              <button
                type="button"
                title={tile.title}
                onClick={tile.onClick}
                className={`${className} cursor-pointer hover:ring-2 hover:ring-violet-300`}
              >
                {tile.text}
              </button>
            ) : (
              <span title={tile.title} className={`block ${className}`}>
                {tile.text}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A picture card's question: its words, then the picture with the labels
 * covered and this card's box picked out.
 *
 *  - `question` — every label covered, this card's marked "?".
 *  - `answer`   — this card's box opened and outlined, the others still covered:
 *                 the next card from the picture should not be given away.
 *
 * A typed picture passes `typed` instead, and `state` is ignored: every word
 * being asked is covered until it is found, words not being asked (their cards
 * are not due) are left showing, and once the round is over the ones not found
 * open outlined in red.
 *
 * The picture ignores the pointer. The study screen opens any picture that is
 * clicked at full size, and full size has no boxes on it — clicking a covered
 * label would show every answer on the picture.
 *
 * With `hints`, the box being asked about — or, in a typed round, any word
 * still hidden — gives a hint when pointed at: on hover with a mouse, on a tap
 * with a finger. The tap is kept from the card behind, which would otherwise
 * take it as turning the card over.
 */
export function OcclusionPicture({
  html,
  occlusion,
  state,
  typed,
  hints = false,
  className,
}: {
  html: string;
  occlusion: OcclusionPayload;
  state: "question" | "answer";
  hints?: boolean;
  typed?: {
    asked: ReadonlySet<string>;
    found: ReadonlySet<string>;
    done: boolean;
  };
  className?: string;
}) {
  const src = firstImageSrc(html);
  const url = usePictureUrl(src);
  const words = withoutFirstImage(html);
  const target = targetBox(occlusion);

  /** The box whose hint is showing, if any. */
  const [hinted, setHinted] = useState<string | null>(null);
  /** How the last press came, so a tap can toggle where a hover cannot. */
  const lastPointer = useRef<string>("mouse");

  /** Whether a box offers a hint right now: covered, and being asked. */
  function hintable(box: OcclusionBox): boolean {
    if (!hints) return false;
    if (typed) {
      return (
        typed.asked.has(box.id) && !typed.found.has(box.id) && !typed.done
      );
    }
    return box.id === target?.id && state === "question";
  }

  // Checked against the box as it is now, so a hint left open does not carry
  // on to the next card, or stay up once its box is answered.
  const hintBox = occlusion.boxes.find((b) => b.id === hinted && hintable(b));

  function hintHandlers(box: OcclusionBox) {
    if (!hintable(box)) return {};
    return {
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse") setHinted(box.id);
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse") {
          setHinted((h) => (h === box.id ? null : h));
        }
      },
      onPointerDown: (e: React.PointerEvent) => {
        lastPointer.current = e.pointerType;
        // Keeps the typing box focused in a typed round.
        e.preventDefault();
      },
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        setHinted((h) =>
          h === box.id && lastPointer.current !== "mouse" ? null : box.id,
        );
      },
    };
  }

  // A typed set of words with no picture: the tiles stand in for it.
  if (!src) {
    const tiles: WordTile[] = occlusion.boxes.map((box) => {
      if (typed) {
        if (!typed.asked.has(box.id)) {
          return { id: box.id, text: box.label, tone: "shown" };
        }
        if (typed.found.has(box.id)) {
          return { id: box.id, text: box.label, tone: "found" };
        }
        if (typed.done) return { id: box.id, text: box.label, tone: "missed" };
        return { id: box.id, text: wordHint(box), tone: "hidden" };
      }
      const open = box.id === target?.id && state === "answer";
      return {
        id: box.id,
        text: open ? box.label : wordHint(box),
        tone: open ? "found" : "hidden",
      };
    });
    return (
      <div className={className}>
        {words && <CardHtml className="rich-content mb-3" html={words} />}
        <WordTiles tiles={tiles} />
      </div>
    );
  }

  return (
    <div className={className}>
      {words && <CardHtml className="rich-content mb-2" html={words} />}
      <div className="relative mx-auto w-fit max-w-full select-none">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- an object URL, which next/image cannot optimise
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none block h-auto max-h-[60vh] max-w-full rounded-md"
          />
        ) : (
          <div className="flex h-40 w-64 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            Loading picture…
          </div>
        )}
        {url &&
          occlusion.boxes.map((box, index) => {
            if (typed) {
              if (!typed.asked.has(box.id)) return null;
              const found = typed.found.has(box.id);
              if (found || typed.done) {
                return (
                  <span
                    key={box.id}
                    style={boxStyle(box)}
                    className={`absolute rounded-sm ring-3 ${
                      found ? "ring-emerald-500" : "ring-red-500"
                    }`}
                  />
                );
              }
              return (
                <span
                  key={box.id}
                  style={boxStyle(box)}
                  {...hintHandlers(box)}
                  className={`absolute rounded-sm bg-amber-300 dark:bg-amber-400 ${
                    hintable(box) ? "cursor-help" : ""
                  }`}
                />
              );
            }
            const mine = box.id === target?.id;
            if (mine && state === "answer") {
              return (
                <span
                  key={box.id}
                  style={boxStyle(box)}
                  className="absolute rounded-sm ring-3 ring-emerald-500"
                />
              );
            }
            return (
              <span
                key={box.id}
                style={boxStyle(box)}
                {...hintHandlers(box)}
                className={`absolute flex items-center justify-center rounded-sm text-xs font-bold ${
                  mine
                    ? "bg-violet-600 text-white shadow-[0_0_0_3px_rgb(124_58_237/0.35)]"
                    : "bg-amber-300 text-amber-950 dark:bg-amber-400"
                } ${hintable(box) ? "cursor-help" : ""}`}
              >
                {/* Numbered as on the editor and the deck's tile, so "box 7"
                    means the same box wherever it is mentioned. */}
                {mine ? "?" : index + 1}
              </span>
            );
          })}
        {url && hintBox && <HintBubble box={hintBox} />}
      </div>
    </div>
  );
}

/**
 * A covered box's hint, floated over the picture by the box: above it, or
 * below for a box near the top where above would be cut off. Kept in from the
 * sides for the same reason.
 */
function HintBubble({ box }: { box: OcclusionBox }) {
  const below = box.y < 0.15;
  const centre = Math.min(Math.max(box.x + box.w / 2, 0.15), 0.85);
  return (
    <span
      role="tooltip"
      style={{
        left: `${centre * 100}%`,
        top: `${(below ? box.y + box.h : box.y) * 100}%`,
      }}
      className={`pointer-events-none absolute z-20 w-max max-w-64 -translate-x-1/2 animate-in fade-in rounded-md bg-foreground px-2.5 py-1 text-center text-sm font-medium text-background shadow-lg duration-150 ${
        below ? "mt-2" : "-mt-2 -translate-y-full"
      }`}
    >
      <span className="opacity-70">Hint: </span>
      {boxHint(box)}
    </span>
  );
}

/** How a label is going, from its card's record. */
export function labelStatus(card: CardRow | undefined): "new" | "missed" | "known" {
  if (!card) return "new";
  if (card.timesMissed > 0) return "missed";
  if (card.consecutiveCorrect > 0) return "known";
  return "new";
}

const PIP_TONE = {
  new: "bg-muted text-muted-foreground",
  missed: "bg-red-500/15 text-red-600 dark:text-red-400",
  known: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

/**
 * One chip per card of a set — a picture's labels, a question's parts — in
 * order, coloured by how each is going: the whole set's progress at a glance,
 * where separate cards would each say only their own share of it.
 */
export function SetPips({
  slots,
  cards,
  current,
  onPick,
}: {
  /** The boxes or parts, in order, with what each chip should say. */
  slots: Array<{ id: string; label: string }>;
  /** The set's cards; a slot with no card here reads as new. */
  cards: readonly CardRow[];
  /** The slot to ring, if any. */
  current?: string;
  onPick?: (id: string) => void;
}) {
  const bySlot = new Map(
    cards.map((c) => [c.occlusion?.boxId ?? c.parts?.partId, c]),
  );
  return (
    <div className="flex flex-wrap gap-1">
      {slots.map((slot) => {
        const tone = PIP_TONE[labelStatus(bySlot.get(slot.id))];
        const ring = slot.id === current ? "ring-2 ring-violet-500" : "";
        const className = `inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 font-mono text-[0.7rem] font-semibold tabular-nums ${tone} ${ring}`;
        return onPick ? (
          <button
            key={slot.id}
            type="button"
            title={slot.label}
            onClick={(e) => {
              e.stopPropagation();
              onPick(slot.id);
            }}
            className={`${className} cursor-pointer hover:ring-2 hover:ring-violet-300`}
          >
            {slot.label}
          </button>
        ) : (
          <span key={slot.id} className={className}>
            {slot.label}
          </span>
        );
      })}
    </div>
  );
}

/** A picture's boxes as chip slots, numbered as they are drawn. */
export function boxSlots(boxes: OcclusionBox[]) {
  return boxes.map((b, i) => ({ id: b.id, label: String(i + 1) }));
}
