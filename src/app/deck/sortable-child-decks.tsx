"use client";

import { useEffect, useId, useState, useTransition } from "react";
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
import { ChildDeckCard } from "./child-deck-card";
import { reorderDecksAction } from "@/app/dashboard/actions";

interface ChildDeck {
  id: number;
  title: string;
  description: string | null;
  updatedAtFormatted: string;
  totalCards: number;
  dueCount: number;
  studiedToday: boolean;
}

function SortableItem({
  children,
  id,
}: {
  children: React.ReactNode;
  id: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

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

export function SortableChildDecks({
  decks,
  parentId,
}: {
  decks: ChildDeck[];
  parentId: number;
}) {
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
      await reorderDecksAction({
        orderedIds: newOrder.map((d) => d.id),
        parentId,
      });
    });
  }

  return (
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
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {orderedDecks.map((deck) => (
            <SortableItem key={deck.id} id={deck.id}>
              <ChildDeckCard deck={deck} />
            </SortableItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
