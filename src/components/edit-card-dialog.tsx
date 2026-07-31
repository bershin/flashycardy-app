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
  CardFields,
  draftFromCard,
  draftToInput,
  validateDraft,
  type CardDraft,
} from "@/components/card-fields";
import type { CardRow } from "@/lib/store/types";
import { updateCardAction } from "@/app/deck/actions";

interface EditCardDialogProps {
  card: CardRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditCardDialog({
  card,
  open,
  onOpenChange,
}: EditCardDialogProps) {
  const [draft, setDraft] = useState<CardDraft>(() => draftFromCard(card));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [prevCardId, setPrevCardId] = useState(card.id);
  const [prevOpen, setPrevOpen] = useState(open);

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
        await updateCardAction({ cardId: card.id, ...draftToInput(draft) });
        onOpenChange(false);
      } catch {
        setError("Failed to update card. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit card</DialogTitle>
            <DialogDescription>
              Update this card, or change what kind of card it is.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4">
            <CardFields draft={draft} onChange={setDraft} disabled={isPending} />
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
