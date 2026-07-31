"use client";

import { useCallback, useState } from "react";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlashCard } from "./flash-card";

interface CardGridProps {
  cards: { id: number; front: string; back: string }[];
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

  if (cards !== prevCards) {
    setPrevCards(cards);
    setDisplayCards(cards);
  }

  const handleShuffle = useCallback(() => {
    setDisplayCards(shuffleArray(displayCards));
  }, [displayCards]);

  if (displayCards.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="mb-4 flex justify-end">
        <Button variant="outline" size="sm" onClick={handleShuffle}>
          <Shuffle className="size-3.5" />
          Shuffle
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {displayCards.map((card) => (
          <FlashCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}
