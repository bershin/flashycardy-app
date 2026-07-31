"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Input } from "@/components/ui/input";
import { DeckCard } from "./deck-card";
import { reorderDecksAction } from "./actions";

interface CardData {
  id: number;
  front: string;
  back: string;
}

interface DeckWithCards {
  id: number;
  title: string;
  description: string | null;
  updatedAtFormatted: string;
  cards: CardData[];
  totalCards: number;
  dueCount: number;
  studiedToday: boolean;
  childCount: number;
  isArchive: boolean;
}

interface DashboardSearchProps {
  decks: DeckWithCards[];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function SortableDeckItem({
  deck,
  children,
}: {
  deck: DeckWithCards;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: deck.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export function DashboardSearch({ decks }: DashboardSearchProps) {
  const dndId = useId();
  const [query, setQuery] = useState("");
  const [orderedDecks, setOrderedDecks] = useState(decks);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setOrderedDecks(decks);
  }, [decks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const isSearching = query.trim().length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q)
      return orderedDecks.map((deck) => ({
        deck,
        matchingCards: [] as CardData[],
      }));

    return orderedDecks
      .map((deck) => {
        const titleMatch =
          deck.title.toLowerCase().includes(q) ||
          deck.description?.toLowerCase().includes(q);

        const matchingCards = deck.cards.filter(
          (card) =>
            stripHtml(card.front).toLowerCase().includes(q) ||
            stripHtml(card.back).toLowerCase().includes(q),
        );

        return { deck, matchingCards, titleMatch };
      })
      .filter(
        ({ titleMatch, matchingCards }) =>
          titleMatch || matchingCards.length > 0,
      );
  }, [query, orderedDecks]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedDecks.findIndex((d) => d.id === active.id);
    const newIndex = orderedDecks.findIndex((d) => d.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...orderedDecks];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    setOrderedDecks(newOrder);

    startTransition(async () => {
      await reorderDecksAction({ orderedIds: newOrder.map((d) => d.id) });
    });
  }

  return (
    <>
      <div className="relative mt-6">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          placeholder="Search decks and cards..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 pl-9 pr-9"
        />
        {isSearching && (
          <button
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
          >
            <X className="size-4" />
            <span className="sr-only">Clear search</span>
          </button>
        )}
      </div>

      {isSearching && (
        <p className="text-muted-foreground mt-3 text-sm">
          {filtered.length === 0
            ? "No results found."
            : `${filtered.length} deck${filtered.length === 1 ? "" : "s"} matched`}
        </p>
      )}

      {isSearching ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ deck, matchingCards }) => (
            <div key={deck.id} className="flex flex-col gap-2">
              <DeckCard
                deck={{
                  id: deck.id,
                  title: deck.title,
                  description: deck.description,
                  updatedAtFormatted: deck.updatedAtFormatted,
                  totalCards: deck.totalCards,
                  dueCount: deck.dueCount,
                  studiedToday: deck.studiedToday,
                  childCount: deck.childCount,
                  isArchive: deck.isArchive,
                }}
              />
              {matchingCards.length > 0 && (
                <div className="ml-3 space-y-1.5 border-l-2 border-violet-300 pl-3 dark:border-violet-700">
                  {matchingCards.map((card) => (
                    <MatchingCard key={card.id} card={card} query={query} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedDecks.map((d) => d.id)}
            strategy={rectSortingStrategy}
          >
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {orderedDecks.map((deck) => (
                <SortableDeckItem key={deck.id} deck={deck}>
                  <DeckCard
                    deck={{
                      id: deck.id,
                      title: deck.title,
                      description: deck.description,
                      updatedAtFormatted: deck.updatedAtFormatted,
                      totalCards: deck.totalCards,
                      dueCount: deck.dueCount,
                      studiedToday: deck.studiedToday,
                      childCount: deck.childCount,
                      isArchive: deck.isArchive,
                    }}
                  />
                </SortableDeckItem>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </>
  );
}

function MatchingCard({ card, query }: { card: CardData; query: string }) {
  return (
    <div className="bg-muted/50 rounded-md px-3 py-2 text-sm">
      <div>
        <span className="text-muted-foreground mr-1.5 text-xs font-medium uppercase">
          Front
        </span>
        <Highlighted text={stripHtml(card.front)} query={query} />
      </div>
      <div className="mt-1">
        <span className="text-muted-foreground mr-1.5 text-xs font-medium uppercase">
          Back
        </span>
        <Highlighted text={stripHtml(card.back)} query={query} />
      </div>
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <span>{text}</span>;

  const parts: { text: string; highlight: boolean }[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const idx = remaining.toLowerCase().indexOf(q);
    if (idx === -1) {
      parts.push({ text: remaining, highlight: false });
      break;
    }
    if (idx > 0) {
      parts.push({ text: remaining.slice(0, idx), highlight: false });
    }
    parts.push({
      text: remaining.slice(idx, idx + q.length),
      highlight: true,
    });
    remaining = remaining.slice(idx + q.length);
  }

  return (
    <span>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark
            key={i}
            className="rounded-sm bg-yellow-200 px-0.5 dark:bg-yellow-800 dark:text-yellow-100"
          >
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
