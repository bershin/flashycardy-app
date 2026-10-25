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
import { labelStatus } from "@/components/occlusion-picture";
import { setStudyPicks } from "@/lib/study-picks";
import type { CardRow } from "@/lib/store/types";
import { deleteCardsAction } from "./actions";

/**
 * The frame shared by every tile that stands for several cards — a picture's
 * labels, a question's parts: the heading and its tally, a menu that acts on
 * the whole set, and picking the set as one when cards are being selected.
 * What goes inside is the set's own business.
 */
export function CardSetTile({
  cards,
  heading,
  noun,
  selecting = false,
  selected = false,
  onToggleSelected,
  children,
}: {
  cards: CardRow[];
  /** Instructions or a question shown above the tally, if any. */
  heading?: string;
  /** What one card of the set is called: "label", "part". */
  noun: string;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelected?: (ids: number[]) => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const first = cards[0];
  const ids = cards.map((c) => c.id);
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const missed = cards.filter((c) => labelStatus(c) === "missed").length;
  const known = cards.filter((c) => labelStatus(c) === "known").length;
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;

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

  const title = (
    <div className="grid gap-1">
      {heading && (
        <CardHtml className="rich-content text-base font-semibold" html={heading} />
      )}
      <p className="text-xs text-muted-foreground">
        {plural(cards.length)}
        {known > 0 && <> · {known} going well</>}
        {missed > 0 && <> · {missed} missed</>}
      </p>
    </div>
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
            {title}
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
          <CardContent>{children}</CardContent>
        </Card>
      </button>
    );
  }

  return (
    <>
      {/* Two columns wide: a set squeezed into half a row is too small to
          tell one numbered box, or one part, from the next. */}
      <Card className="sm:col-span-2">
        <CardHeader>
          {title}
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
              >
                <Ellipsis className="size-3.5" />
                <span className="sr-only">Actions for all {plural(cards.length)}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onClick={study}>
                  <BookOpen />
                  Study all {plural(cards.length)}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditOpen(true)}>
                  <Pencil />
                  Edit
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
        <CardContent>{children}</CardContent>
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
            <DialogTitle>Delete all {plural(cards.length)}?</DialogTitle>
            <DialogDescription>
              This deletes every {noun} here, with its progress. This action
              cannot be undone.
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
