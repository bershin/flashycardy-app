"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useTransition,
} from "react";
import { FolderInput, ListTodo, NotebookPen } from "lucide-react";
import {
  DndContext,
  closestCenter,
  pointerWithin,
  useDroppable,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectDeckMoveOptions } from "@/lib/store/selectors";
import { selectMemosMatching } from "@/db/queries/memos";
import { selectTodosMatching } from "@/db/queries/todos";
import type { DbDoc } from "@/lib/store/types";
import { DeckCard } from "./deck-card";
import { moveDeckAction, reorderDecksAction } from "./actions";

/** Droppable id prefix for the "nest inside this deck" zones. */
const NEST_PREFIX = "nest-";

/**
 * The drop target that nests one deck inside another.
 *
 * Only rendered mid-drag, and only over decks that can actually accept the deck
 * being dragged. It deliberately covers just the middle of the card and says
 * what it does: nesting is a rare, disorienting action next to reordering, so it
 * should never be something you trigger without meaning to. Dragging past the
 * edges still reorders exactly as before.
 */
function NestZone({ deckId }: { deckId: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${NEST_PREFIX}${deckId}` });

  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-x-6 inset-y-4 z-20 flex items-center justify-center gap-1.5 rounded-lg border-2 border-dashed text-xs font-medium transition-colors ${
        isOver
          ? "border-violet-400 bg-violet-500/25 text-violet-100"
          : "border-violet-400/40 bg-violet-500/10 text-violet-300/80"
      }`}
    >
      <FolderInput className="size-3.5" />
      Nest inside
    </div>
  );
}

interface CardData {
  id: number;
  front: string;
  back: string;
}

interface DeckWithCards {
  id: number;
  title: string;
  description: string | null;
  cards: CardData[];
  totalCards: number;
  dueCount: number;
  tomorrowCount: number;
  studiedToday: boolean;
  childCount: number;
  isArchive: boolean;
}

interface DashboardSearchProps {
  decks: DeckWithCards[];
  /** Owned by the page, so the input can live up in the header row. */
  query: string;
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
    <div
      ref={setNodeRef}
      style={style}
      className="relative h-full"
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export function DashboardSearch({ decks, query }: DashboardSearchProps) {
  const dndId = useId();
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

  /**
   * The same words, against everything else the app holds.
   *
   * Searched from here rather than each surface having its own box: a thing you
   * half remember is a thing you do not remember *where* you put — whether it
   * was a card, a note, or something you wrote down to do. Empty while the box
   * is empty, so an idle dashboard does nothing extra.
   */
  const matchingNotes = useStore(
    useCallback(
      (db: DbDoc) =>
        isSearching ? selectMemosMatching(db, LOCAL_USER_ID, query) : [],
      [query, isSearching],
    ),
  );
  const matchingTodos = useStore(
    useCallback(
      (db: DbDoc) =>
        isSearching ? selectTodosMatching(db, LOCAL_USER_ID, query) : [],
      [query, isSearching],
    ),
  );

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

  const [draggingId, setDraggingId] = useState<number | null>(null);

  /**
   * Which decks the deck currently being dragged is allowed to nest into.
   * Empty until a drag starts, so no zones render at rest.
   */
  const nestableIds = useStore(
    useCallback(
      (db: DbDoc) => {
        if (draggingId === null) return new Set<number>();
        const options = selectDeckMoveOptions(db, LOCAL_USER_ID, draggingId);
        return new Set(options.targets.map((t) => t.id));
      },
      [draggingId],
    ),
  );

  /**
   * Prefer a nest zone, but only when the pointer is genuinely inside one.
   * Everything else falls through to the sortable behaviour unchanged.
   */
  const collisionDetection: CollisionDetection = useCallback((args) => {
    const nest = pointerWithin(args).find((c) =>
      String(c.id).startsWith(NEST_PREFIX),
    );
    return nest ? [nest] : closestCenter(args);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    setDraggingId(Number(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDraggingId(null);
    if (!over || active.id === over.id) return;

    const overId = String(over.id);
    if (overId.startsWith(NEST_PREFIX)) {
      const targetParentId = Number(overId.slice(NEST_PREFIX.length));
      const deckId = Number(active.id);
      // Drop it from the list straight away; the store will confirm.
      setOrderedDecks((prev) => prev.filter((d) => d.id !== deckId));
      startTransition(async () => {
        try {
          await moveDeckAction({ deckId, targetParentId });
        } catch {
          // The move was rejected — the store is unchanged, so re-render from it.
          setOrderedDecks(decks);
        }
      });
      return;
    }

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
      {isSearching && (
        <p className="text-muted-foreground mt-3 text-sm">
          {filtered.length + matchingNotes.length + matchingTodos.length === 0
            ? "No results found."
            : [
                filtered.length > 0 &&
                  `${filtered.length} deck${filtered.length === 1 ? "" : "s"}`,
                matchingNotes.length > 0 &&
                  `${matchingNotes.length} note${matchingNotes.length === 1 ? "" : "s"}`,
                matchingTodos.length > 0 &&
                  `${matchingTodos.length} todo${matchingTodos.length === 1 ? "" : "s"}`,
              ]
                .filter(Boolean)
                .join(" · ") + " matched"}
        </p>
      )}

      {/* Below the decks, which are what the dashboard is for; these are what
          you came looking for when the decks were not it. */}
      {isSearching && matchingNotes.length > 0 && (
        <section className="mt-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <NotebookPen className="size-4" />
            Notes
          </h2>
          <ul className="mt-2 grid gap-1">
            {matchingNotes.map((memo) => (
              <li key={memo.id}>
                <Link
                  href={`/notes/?note=${memo.id}`}
                  className="block rounded-lg border border-border/60 px-3 py-2 hover:bg-muted"
                >
                  <span className="block truncate text-sm font-medium">
                    {memo.title.trim() || "Untitled"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {memo.body.split("\n").find((l) => l.trim()) ?? "Empty"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isSearching && matchingTodos.length > 0 && (
        <section className="mt-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <ListTodo className="size-4" />
            {/* Not "To do": the strip above the results already carries that
                heading for today's list, and two of them on one screen reads
                as one section having been repeated. */}
            Things to do
          </h2>
          <ul className="mt-2 grid gap-1">
            {matchingTodos.map((todo) => (
              <li key={todo.id}>
                {/* The day it belongs to, because that is where it can be
                    ticked off, moved or rewritten. */}
                <Link
                  href={`/calendar/?day=${todo.date}`}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2 hover:bg-muted"
                >
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${todo.done ? "text-muted-foreground line-through" : ""}`}
                  >
                    {todo.text}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {todo.date}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isSearching ? (
        <div className="mt-4 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ deck, matchingCards }) => (
            <div key={deck.id} className="flex flex-col gap-2">
              <DeckCard
                deck={{
                  id: deck.id,
                  title: deck.title,
                  description: deck.description,
                  totalCards: deck.totalCards,
                  dueCount: deck.dueCount,
                  tomorrowCount: deck.tomorrowCount,
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
          collisionDetection={collisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <SortableContext
            items={orderedDecks.map((d) => d.id)}
            strategy={rectSortingStrategy}
          >
            {/* auto-rows-fr keeps every row the same height, so a deck with a
                long description doesn't make its neighbours look stunted. */}
            <div className="mt-4 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {orderedDecks.map((deck) => (
                <SortableDeckItem key={deck.id} deck={deck}>
                  {nestableIds.has(deck.id) && <NestZone deckId={deck.id} />}
                  <DeckCard
                    deck={{
                      id: deck.id,
                      title: deck.title,
                      description: deck.description,
                          totalCards: deck.totalCards,
                      dueCount: deck.dueCount,
                      tomorrowCount: deck.tomorrowCount,
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
