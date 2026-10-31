"use client";

import { useCallback, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CardFields,
  draftFromCard,
  draftToInput,
  filledParts,
  validateDraft,
  type CardDraft,
} from "@/components/card-fields";
import type { CardRow, DbDoc } from "@/lib/store/types";
import {
  saveOcclusionCardsAction,
  saveQuestionPartsAction,
  updateCardAction,
} from "@/app/deck/actions";
import { setGroup } from "@/lib/occlusion";
import { useStore } from "@/lib/store/use-store";

interface EditCardDialogProps {
  card: CardRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Cloning makes the copy first and then opens this dialog on it, so the
   * heading needs to say which of the two just happened — "Edit card" over a
   * card you asked to clone reads like the clone didn't work.
   */
  mode?: "edit" | "clone";
  /**
   * The saved card, for callers holding their own copy of it. The study session
   * keeps its own working list, so without this a correction made mid-session
   * wouldn't show up on the card in front of you.
   */
  onSaved?: (card: CardRow) => void;
}

export function EditCardDialog({
  card,
  open,
  onOpenChange,
  mode = "edit",
  onSaved,
}: EditCardDialogProps) {
  const [draft, setDraft] = useState<CardDraft>(() => draftFromCard(card));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [prevCardId, setPrevCardId] = useState(card.id);
  const [prevOpen, setPrevOpen] = useState(open);
  /** How many cards share this one's picture or question, if it has one. */
  const group = setGroup(card);
  const setSize = useStore(
    useCallback(
      (db: DbDoc) =>
        group === undefined
          ? undefined
          : db.cards.filter((c) => setGroup(c) === group).length,
      [group],
    ),
  );
  const cardSet =
    setSize === undefined
      ? undefined
      : { kind: card.parts ? ("parts" as const) : ("occlusion" as const), size: setSize };

  // Reload the draft when a different card is opened, or the same one reopened
  // — otherwise edits abandoned last time would still be sitting in the form.
  if (card.id !== prevCardId || (open && !prevOpen)) {
    setPrevCardId(card.id);
    setDraft(draftFromCard(card));
    setError(null);
  }
  if (open !== prevOpen) {
    setPrevOpen(open);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const problem = validateDraft(draft);
    setError(problem);
    if (problem) return;

    startTransition(async () => {
      try {
        if (draft.type === "occlusion") {
          const saved = await saveOcclusionCardsAction({
            deckId: card.deckId,
            fromCardId: card.id,
            front: draft.front,
            back: draft.back,
            boxes: draft.boxes,
            typed: draft.typed,
          });
          // This card's own box may have been the one removed.
          const mine = saved.find((c) => c.id === card.id);
          if (mine) onSaved?.(mine);
        } else if (draft.type === "parts") {
          const saved = await saveQuestionPartsAction({
            deckId: card.deckId,
            fromCardId: card.id,
            front: draft.front,
            back: draft.back,
            items: filledParts(draft),
          });
          const mine = saved.find((c) => c.id === card.id);
          if (mine) onSaved?.(mine);
        } else {
          const updated = await updateCardAction({
            cardId: card.id,
            ...draftToInput(draft),
          });
          if (updated) onSaved?.(updated);
        }
        onOpenChange(false);
      } catch (error) {
        // See `add-card-dialog.tsx`: the real message matters, because the
        // common failure is a size limit that no amount of retrying clears.
        setError(
          error instanceof Error
            ? error.message
            : "Failed to update card. Please try again.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {mode === "clone" ? "Clone card" : "Edit card"}
            </DialogTitle>
            <DialogDescription>
              {mode === "clone"
                ? "This copy has been created. Adjust it, or close to keep it as-is."
                : "Update this card, or change what kind of card it is."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <CardFields
              draft={draft}
              onChange={setDraft}
              disabled={isPending}
              cardSet={cardSet}
            />
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
