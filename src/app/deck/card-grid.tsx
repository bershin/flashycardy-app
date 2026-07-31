"use client";

import { useCallback, useState } from "react";
import { CheckSquare, FolderInput, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoveCardDialog } from "@/components/move-card-dialog";
import { FlashCard } from "./flash-card";

interface CardGridProps {
  cards: { id: number; front: string; back: string; deckId: number }[];
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function CardGrid({ cards }: CardGridProps) {
  const [displayCards, setDisplayCards] = useState(cards);
  const [prevCards, setPrevCards] = useState(cards);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);

  if (cards !== prevCards) {
    setPrevCards(cards);
    setDisplayCards(cards);
    // Cards may have been moved away or deleted underneath the selection.
    setSelected((prev) => {
      const ids = new Set(cards.map((c) => c.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }

  const handleShuffle = useCallback(() => {
    setDisplayCards((current) => shuffleArray(current));
  }, []);

  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function exitSelection() {
    setSelecting(false);
    setSelected(new Set());
  }

  if (displayCards.length === 0) return null;

  const allSelected = selected.size === displayCards.length;

  return (
    <div className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        {selecting ? (
          <>
            <span className="mr-auto text-sm text-muted-foreground">
              {selected.size} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setSelected(
                  allSelected
                    ? new Set()
                    : new Set(displayCards.map((c) => c.id)),
                )
              }
            >
              {allSelected ? "Clear all" : "Select all"}
            </Button>
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={() => setMoveOpen(true)}
            >
              <FolderInput className="size-3.5" />
              Move
              {selected.size > 0 ? ` ${selected.size}` : ""}
            </Button>
            <Button variant="outline" size="sm" onClick={exitSelection}>
              <X className="size-3.5" />
              Done
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelecting(true)}
            >
              <CheckSquare className="size-3.5" />
              Select
            </Button>
            <Button variant="outline" size="sm" onClick={handleShuffle}>
              <Shuffle className="size-3.5" />
              Shuffle
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {displayCards.map((card) => (
          <FlashCard
            key={card.id}
            card={card}
            selecting={selecting}
            selected={selected.has(card.id)}
            onToggleSelected={toggle}
          />
        ))}
      </div>

      <MoveCardDialog
        cardIds={[...selected]}
        currentDeckId={displayCards[0].deckId}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        onMoved={exitSelection}
      />
    </div>
  );
}
