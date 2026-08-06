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
  /**
   * Cloning makes the copy first and then opens this dialog on it, so the
   * heading needs to say which of the two just happened — "Edit card" over a
   * card you asked to clone reads like the clone didn't work.
   */
  mode?: "edit" | "clone";
}

export function EditCardDialog({
  card,
  open,
  onOpenChange,
  mode = "edit",
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
