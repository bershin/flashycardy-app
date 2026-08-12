"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  FolderInput,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { hasOpenAIKey } from "@/lib/settings";
import { accentStyle } from "@/lib/deck-accent";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EditDeckDialog } from "@/components/edit-deck-dialog";
import { AddCardDialog } from "@/components/add-card-dialog";
import { CreateDeckDialog } from "@/components/create-deck-dialog";
import { MoveDeckDialog } from "@/components/move-deck-dialog";
import { deleteDeckAction } from "@/app/dashboard/actions";
import { generateCardsWithAIAction } from "./actions";

interface DeckHeaderProps {
  deck: {
    id: number;
    title: string;
    description: string | null;
  };
  cardCount: number;
  hasChildren?: boolean;
  canAddSubDeck?: boolean;
}

export function DeckHeader({
  deck,
  cardCount,
  hasChildren = false,
  canAddSubDeck = false,
}: DeckHeaderProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [createSubDeckOpen, setCreateSubDeckOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isGenerating, startGenerating] = useTransition();
  const [generateError, setGenerateError] = useState<string | null>(null);

  // localStorage isn't available during prerender, so the server snapshot is
  // `false` and the real value arrives on hydration. Nothing changes the key
  // mid-page, hence the no-op subscribe.
  const canGenerate = useSyncExternalStore(
    () => () => {},
    () => hasOpenAIKey(),
    () => false,
  );

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteDeckAction({ deckId: deck.id });
        router.push("/dashboard");
      } catch {
        // TODO: surface error via toast
      }
    });
  }

  function handleGenerateAI() {
    setGenerateError(null);
    startGenerating(async () => {
      try {
        await generateCardsWithAIAction(deck.id);
      } catch (error) {
        setGenerateError(
          error instanceof Error ? error.message : "Generation failed.",
        );
      }
    });
  }

  return (
    <div className="mt-4" style={accentStyle(deck.id)}>
      {/* Ties the page to the deck's colour on the dashboard. */}
      <span
        aria-hidden
        className="mb-4 block h-1 w-16 rounded-full bg-[var(--deck-accent)]"
      />
      <div className="flex items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {deck.title}
        </h1>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setEditOpen(true)}
        >
          <Pencil className="size-4" />
          <span className="sr-only">Edit deck</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setMoveOpen(true)}
        >
          <FolderInput className="size-4" />
          <span className="sr-only">Move deck</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Delete deck</span>
        </Button>
      </div>
      {deck.description && (
        <p className="mt-1 text-muted-foreground">{deck.description}</p>
      )}

      <div className="mt-3 flex items-center gap-3">
        {!hasChildren && (
          <>
            <p className="text-sm text-muted-foreground">
              {cardCount === 0
                ? "No cards yet. Add some to get started!"
                : `${cardCount} card${cardCount === 1 ? "" : "s"}`}
            </p>
            <Button size="sm" onClick={() => setAddCardOpen(true)}>
              <Plus className="size-4" />
              Add Card
            </Button>
            {/* Hidden entirely without a key — there is no plan to upsell now,
                so an always-visible button would just be a dead end. */}
            {canGenerate && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleGenerateAI}
                disabled={isGenerating}
              >
                <Sparkles className="size-4" />
                {isGenerating ? "Generating…" : "Generate with AI"}
              </Button>
            )}
            {cardCount > 0 && (
              <Link
                href={`/deck/study/?id=${deck.id}`}
                className={buttonVariants({ size: "sm", variant: "secondary" })}
              >
                <BookOpen className="size-3.5" />
                Study
              </Link>
            )}
          </>
        )}
        {(hasChildren || canAddSubDeck) && (
          <Button size="sm" variant={hasChildren ? "default" : "outline"} onClick={() => setCreateSubDeckOpen(true)}>
            <Plus className="size-4" />
            New Sub-Deck
          </Button>
        )}
      </div>

      {generateError && (
        <p className="mt-2 text-sm text-destructive">{generateError}</p>
      )}

      <EditDeckDialog
        deckId={deck.id}
        title={deck.title}
        description={deck.description}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <AddCardDialog
        deckId={deck.id}
        open={addCardOpen}
        onOpenChange={setAddCardOpen}
      />
      <CreateDeckDialog
        open={createSubDeckOpen}
        onOpenChange={setCreateSubDeckOpen}
        parentId={deck.id}
      />
      <MoveDeckDialog
        deckId={deck.id}
        deckTitle={deck.title}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deck.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              {hasChildren
                ? "This will permanently delete this deck, all of its sub-decks, and their cards. This action cannot be undone."
                : "This will permanently delete this deck and all of its cards. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? "Deleting\u2026" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
