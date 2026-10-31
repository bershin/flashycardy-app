"use client";

import { useState } from "react";
import { CardHistory } from "@/components/card-history";
import {
  SetPips,
  boxSlots,
  boxStyle,
  labelStatus,
  usePictureUrl,
} from "@/components/occlusion-picture";
import { firstImageSrc, withoutFirstImage } from "@/lib/occlusion";
import type { CardRow } from "@/lib/store/types";
import { CardSetTile } from "./card-set-tile";

const BOX_TONE = {
  new: "bg-amber-300 text-amber-950 dark:bg-amber-400",
  missed: "bg-red-300 text-red-950 dark:bg-red-400",
  known: "bg-emerald-300 text-emerald-950 dark:bg-emerald-400",
};

/** What the chip and box colours mean, said once under them. */
export function StatusKey() {
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <span className="size-2.5 rounded-sm bg-amber-300" /> new
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2.5 rounded-sm bg-emerald-300" /> going well
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2.5 rounded-sm bg-red-300" /> missed
      </span>
    </p>
  );
}

/** One card's record, shown when it is peeked at on a tile. */
export function Peek({
  title,
  answer,
  note,
  card,
  onClose,
}: {
  title: string;
  answer: string;
  /** The label's explanation, if it has one. */
  note?: string;
  card: CardRow | undefined;
  onClose: () => void;
}) {
  return (
    <div className="grid gap-1.5 rounded-lg bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
        {answer}
      </p>
      {note?.trim() && (
        <p className="whitespace-pre-line text-sm text-muted-foreground">
          {note.trim()}
        </p>
      )}
      {card && (
        <CardHistory
          compact
          timesMissed={card.timesMissed}
          streak={card.consecutiveCorrect}
        />
      )}
      <button
        type="button"
        onClick={onClose}
        className="justify-self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Hide it again
      </button>
    </div>
  );
}

/**
 * A picture's labels as one tile in the deck.
 *
 * Underneath it is one card per label, each scheduled on its own — but twenty
 * tiles of the same skeleton is a picture repeated, not a deck you can read.
 * Here the picture appears once, its boxes numbered and coloured by how each
 * label is going. Click a box or its number to see what is under it and that
 * label's record.
 */
export function PictureCard({
  cards,
  selecting = false,
  selected = false,
  onToggleSelected,
}: {
  /** The picture's cards, all sharing one `occlusion.group`. */
  cards: CardRow[];
  selecting?: boolean;
  selected?: boolean;
  onToggleSelected?: (ids: number[]) => void;
}) {
  const first = cards[0];
  const boxes = first.occlusion!.boxes;
  const url = usePictureUrl(firstImageSrc(first.front));
  const words = withoutFirstImage(first.front);
  const byBox = new Map(cards.map((c) => [c.occlusion!.boxId, c]));
  const [peek, setPeek] = useState<string | null>(null);
  const peekedIndex = boxes.findIndex((b) => b.id === peek);

  const picture = (
    <div className="relative mx-auto w-fit max-w-full select-none">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- an object URL, which next/image cannot optimise
        <img
          src={url}
          alt=""
          draggable={false}
          className="pointer-events-none block h-auto max-h-[32rem] max-w-full rounded-md"
        />
      ) : (
        <div className="flex h-40 w-64 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
          Loading picture…
        </div>
      )}
      {url &&
        boxes.map((box, index) =>
          box.id === peek ? (
            <span
              key={box.id}
              style={boxStyle(box)}
              className="absolute rounded-sm ring-3 ring-violet-500"
            />
          ) : (
            <button
              key={box.id}
              type="button"
              disabled={selecting}
              title={`Box ${index + 1}`}
              onClick={() => setPeek(box.id)}
              style={boxStyle(box)}
              className={`absolute flex items-center justify-center rounded-sm text-[0.65rem] font-bold disabled:cursor-default ${
                BOX_TONE[labelStatus(byBox.get(box.id))]
              }`}
            >
              {index + 1}
            </button>
          ),
        )}
    </div>
  );

  return (
    <CardSetTile
      cards={cards}
      heading={words || undefined}
      noun="label"
      selecting={selecting}
      selected={selected}
      onToggleSelected={onToggleSelected}
    >
      {selecting ? (
        picture
      ) : (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
          {picture}
          <div className="grid content-start gap-3">
            {peek && peekedIndex !== -1 ? (
              <Peek
                title={`Box ${peekedIndex + 1}`}
                answer={boxes[peekedIndex].label}
                note={boxes[peekedIndex].note}
                card={byBox.get(peek)}
                onClose={() => setPeek(null)}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Click a box or its number to see what&apos;s under it.
              </p>
            )}
            <SetPips
              slots={boxSlots(boxes)}
              cards={cards}
              current={peek ?? undefined}
              onPick={setPeek}
            />
            <StatusKey />
          </div>
        </div>
      )}
    </CardSetTile>
  );
}
