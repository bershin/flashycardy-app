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
import { addCardAction } from "@/app/deck/actions";

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
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setFront("");
    setBack("");
    setError(null);
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (nextOpen) resetForm();
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
        await addCardAction({
          deckId,
          front,
          back,
        });
        resetForm();
        onOpenChange(false);
      } catch {
        setError("Failed to add card. Please try again.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Card</DialogTitle>
            <DialogDescription>
              Enter the front and back content for your new flashcard.
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
              {isPending ? "Adding…" : "Add Card"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
