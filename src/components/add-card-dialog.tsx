"use client";

import { useState, useTransition } from "react";
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
  boxesToSave,
  CardFields,
  draftToInput,
  emptyDraft,
  filledParts,
  validateDraft,
  type CardDraft,
} from "@/components/card-fields";
import {
  addCardAction,
  saveOcclusionCardsAction,
  saveQuestionPartsAction,
} from "@/app/deck/actions";

interface AddCardDialogProps {
  deckId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddCardDialog({
  deckId,
  open,
  onOpenChange,
}: AddCardDialogProps) {
  const [draft, setDraft] = useState<CardDraft>(emptyDraft);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (nextOpen) {
      setDraft(emptyDraft());
      setError(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const problem = validateDraft(draft);
    setError(problem);
    if (problem) return;

    startTransition(async () => {
      try {
        if (draft.type === "occlusion") {
          await saveOcclusionCardsAction({
            deckId,
            front: draft.front,
            back: draft.back,
            boxes: boxesToSave(draft),
            typed: draft.typed,
          });
        } else if (draft.type === "parts") {
          await saveQuestionPartsAction({
            deckId,
            front: draft.front,
            back: draft.back,
            items: filledParts(draft),
          });
        } else {
          await addCardAction({ deckId, ...draftToInput(draft) });
        }
        setDraft(emptyDraft());
        onOpenChange(false);
      } catch (error) {
        // Show what actually failed. The usual cause is the size limit, and
        // "try again" is useless advice for a card that can only fail the
        // same way every time.
        setError(
          error instanceof Error
            ? error.message
            : "Failed to add card. Please try again.",
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add card</DialogTitle>
            <DialogDescription>
              Pick a card type, then fill in what it needs.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <CardFields draft={draft} onChange={setDraft} disabled={isPending} />
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Adding…"
                : draft.type === "occlusion" && draft.boxes.length > 1
                  ? `Add ${draft.boxes.length} cards`
                  : draft.type === "parts" && filledParts(draft).length > 1
                    ? `Add ${filledParts(draft).length} cards`
                    : "Add card"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
