"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Check,
  Ellipsis,
  FolderInput,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CardHtml } from "@/components/card-html";
import { CardHistory } from "@/components/card-history";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditCardDialog } from "@/components/edit-card-dialog";
import { MoveCardDialog } from "@/components/move-card-dialog";
import {
  PicturePips,
  boxStyle,
  labelStatus,
  usePictureUrl,
} from "@/components/occlusion-picture";
import { firstImageSrc, withoutFirstImage } from "@/lib/occlusion";
import { setStudyPicks } from "@/lib/study-picks";
import type { CardRow } from "@/lib/store/types";
import { deleteCardsAction } from "./actions";

const BOX_TONE = {
  new: "bg-amber-300 text-amber-950 dark:bg-amber-400",
  missed: "bg-red-300 text-red-950 dark:bg-red-400",
  known: "bg-emerald-300 text-emerald-950 dark:bg-emerald-400",
};

/**
 * A picture's labels as one tile in the deck.
 *
 * Underneath it is one card per label, each scheduled on its own — but twenty
 * tiles of the same skeleton is a picture repeated, not a deck you can read.
 * Here the picture appears once, its boxes numbered and coloured by how each
 * label is going. Click a box or its number to see what is under it and that
 * label's record; everything in the menu acts on the whole picture.
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
  const router = useRouter();
  const first = cards[0];
  const boxes = first.occlusion!.boxes;
  const ids = cards.map((c) => c.id);
  const url = usePictureUrl(firstImageSrc(first.front));
  const words = withoutFirstImage(first.front);
  const byBox = new Map(cards.map((c) => [c.occlusion!.boxId, c]));

  const [peek, setPeek] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const peeked = peek ? byBox.get(peek) : undefined;
  const peekedIndex = boxes.findIndex((b) => b.id === peek);
  const missed = cards.filter((c) => labelStatus(c) === "missed").length;
  const known = cards.filter((c) => labelStatus(c) === "known").length;

  function study() {
    setStudyPicks(first.deckId, ids);
    router.push(`/deck/study/?id=${first.deckId}`);
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteCardsAction({ cardIds: ids });
      setDeleteOpen(false);
    });
  }

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

  const summary = (
    <p className="text-xs text-muted-foreground">
      {cards.length} label{cards.length === 1 ? "" : "s"}
      {known > 0 && <> · {known} going well</>}
      {missed > 0 && <> · {missed} missed</>}
    </p>
  );

  if (selecting) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onToggleSelected?.(ids)}
        className={`rounded-xl text-left transition-colors sm:col-span-2 ${
          selected ? "ring-2 ring-primary" : "ring-1 ring-transparent"
        }`}
      >
        <Card className={selected ? "bg-primary/5" : undefined}>
          <CardHeader>
            {summary}
            <CardAction>
              <span
                className={`flex size-5 items-center justify-center rounded border ${
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input"
                }`}
              >
                {selected && <Check className="size-3.5" />}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>{picture}</CardContent>
        </Card>
      </button>
    );
  }

  return (
    <>
      {/* Two columns wide: a diagram squeezed into half a row is too small to
          tell one numbered box from the next. */}
      <Card className="sm:col-span-2">
        <CardHeader>
          <div className="grid gap-1">
            {words && (
              <CardHtml
                className="rich-content text-base font-semibold"
                html={words}
              />
            )}
            {summary}
          </div>
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
              >
                <Ellipsis className="size-3.5" />
                <span className="sr-only">Picture actions</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onClick={study}>
                  <BookOpen />
                  Study this picture
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil />
                  Edit picture and labels
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMoveOpen(true)}>
                  <FolderInput />
                  Move to deck…
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
          {picture}
          <div className="grid content-start gap-3">
            {peeked ? (
              <div className="grid gap-1.5 rounded-lg bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">
                  Box {peekedIndex + 1}
                </p>
                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                  {boxes[peekedIndex]?.label}
                </p>
                <CardHistory
                  compact
                  timesMissed={peeked.timesMissed}
                  streak={peeked.consecutiveCorrect}
                />
                <button
                  type="button"
                  onClick={() => setPeek(null)}
                  className="justify-self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Cover it again
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Click a box or its number to see what&apos;s under it.
              </p>
            )}
            <PicturePips
              boxes={boxes}
              cards={cards}
              current={peek ?? undefined}
              onPick={setPeek}
            />
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-amber-300" /> new
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-emerald-300" /> going
                well
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-sm bg-red-300" /> missed
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      <EditCardDialog card={first} open={editOpen} onOpenChange={setEditOpen} />

      <MoveCardDialog
        cardIds={ids}
        currentDeckId={first.deckId}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this picture?</DialogTitle>
            <DialogDescription>
              This deletes the picture and all {cards.length} of its labels,
              with their progress. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
