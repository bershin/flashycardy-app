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
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/rich-text-editor";
import { updateCardAction } from "@/app/deck/actions";

interface EditCardDialogProps {
  cardId: number;
  front: string;
  back: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditCardDialog({
  cardId,
  front: initialFront,
  back: initialBack,
  open,
  onOpenChange,
}: EditCardDialogProps) {
  const [front, setFront] = useState(initialFront);
  const [back, setBack] = useState(initialBack);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [prevCardId, setPrevCardId] = useState(cardId);
  const [prevOpen, setPrevOpen] = useState(open);

  if (cardId !== prevCardId || (open && !prevOpen)) {
    setPrevCardId(cardId);
    setFront(initialFront);
    setBack(initialBack);
    setError(null);
  }
  if (open !== prevOpen) {
    setPrevOpen(open);
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const isEmpty = (html: string) => {
      const text = html.replace(/<[^>]*>/g, "").trim();
      return text.length === 0;
    };

    if (isEmpty(front)) {
      setError("Front side is required");
      return;
    }
    if (isEmpty(back)) {
      setError("Back side is required");
      return;
    }

    startTransition(async () => {
      try {
        await updateCardAction({
          cardId,
          front,
          back,
        });
        onOpenChange(false);
      } catch {
        setError("Failed to update card. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Card</DialogTitle>
            <DialogDescription>
              Update the front and back content for this flashcard.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <Label>Front</Label>
              <RichTextEditor
                content={front}
                onChange={setFront}
                placeholder="Question or term…"
                disabled={isPending}
              />
            </div>

            <div className="grid gap-2">
              <Label>Back</Label>
              <RichTextEditor
                content={back}
                onChange={setBack}
                placeholder="Answer or definition…"
                disabled={isPending}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="mt-4">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
