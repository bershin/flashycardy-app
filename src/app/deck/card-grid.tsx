"use client";

import { useCallback, useState } from "react";
import { CheckSquare, Dices, FolderInput, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoveCardDialog } from "@/components/move-card-dialog";
import type { CardRow } from "@/lib/store/types";
import { FlashCard } from "./flash-card";

interface CardGridProps {
  cards: CardRow[];
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
  /**
   * Which cards to show: all of them, or only the ones still fixed.
   *
   * Converting a deck is a long job done a card at a time, and the hard part is
   * remembering where you were. Filtering to the fixed ones turns that into a
   * list that visibly shortens.
   */
  const [onlyFixed, setOnlyFixed] = useState(false);

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

  const varying = cards.filter((c) => c.type === "generated").length;
  const visibleCards = onlyFixed
    ? displayCards.filter((c) => c.type !== "generated")
    : displayCards;
  const allSelected = selected.size === visibleCards.length;

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
                    : new Set(visibleCards.map((c) => c.id)),
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
            {varying > 0 && (
              <span className="mr-auto text-sm text-muted-foreground">
                {varying} of {cards.length} vary
              </span>
            )}
            {varying > 0 && varying < cards.length && (
              <Button
                variant={onlyFixed ? "default" : "outline"}
                size="sm"
                onClick={() => setOnlyFixed((only) => !only)}
              >
                <Dices className="size-3.5" />
                {onlyFixed ? "Showing fixed only" : "Hide the varying ones"}
              </Button>
            )}
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

      {/* `card-list` lets the browser skip the work for cards that are nowhere
          near the viewport — see the rule in globals.css. A deck of a few
          hundred image cards is otherwise laid out and painted in full before
          the first one can be looked at. */}
      <div className="card-list grid gap-4 sm:grid-cols-2">
        {visibleCards.map((card) => (
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
