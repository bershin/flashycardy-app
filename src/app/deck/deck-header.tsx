"use client";

import {
  useCallback,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  Dices,
  Flame,
  ListChecks,
  Shuffle,
  Sprout,
  Timer,
  Wand2,
  FolderInput,
  Layers,
  Pencil,
  SpellCheck,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { hasAIKey } from "@/lib/settings";
import { accentStyle } from "@/lib/deck-accent";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  HARD_MISS_THRESHOLD,
  selectHardCards,
  selectNewCards,
} from "@/db/queries/cards";
import {
  selectCardsByDeckForUser,
  selectDueCardsByDeckForUser,
} from "@/lib/store/selectors";
import { setStudyPicks } from "@/lib/study-picks";
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
import { SpellingCardDialog } from "@/components/spelling-card-dialog";
import { CreateDeckDialog } from "@/components/create-deck-dialog";
import { MoveDeckDialog } from "@/components/move-deck-dialog";
import { deleteDeckAction } from "@/app/dashboard/actions";
import { generateCardsWithAIAction, setDeckScheduleAction } from "./actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectCardsUnderDeck } from "@/db/queries/cards";
import {
  REVIEW_SCHEDULES,
  type DbDoc,
  type ReviewSchedule,
} from "@/lib/store/types";

const SCHEDULE_LABELS: Record<ReviewSchedule, string> = {
  incremental: "Daily",
  weekly: "Widening",
};

interface DeckHeaderProps {
  deck: {
    id: number;
    title: string;
    description: string | null;
  };
  cardCount: number;
  hasChildren?: boolean;
  canAddSubDeck?: boolean;
  /**
   * The grid's own actions, reached from the Features menu here.
   *
   * The grid is a sibling on the deck page, not a child, so the page holds
   * whatever the two of us share and hands each of us our half. A signal
   * through the store, or an effect, would both be more machinery than these
   * deserve.
   */
  onSelectCards?: () => void;
  onVaryAll?: () => void;
  onShuffleCards?: () => void;
}

export function DeckHeader({
  deck,
  cardCount,
  hasChildren = false,
  canAddSubDeck = false,
  onSelectCards,
  onVaryAll,
  onShuffleCards,
}: DeckHeaderProps) {
  const router = useRouter();
  /**
   * The cards under this deck that keep being missed, worst first.
   *
   * Read here rather than on the grid below because this is where studying
   * starts. Finding them was already possible — filter to the missed ones, sort
   * by most missed, select all, study — but four steps is enough to mean nobody
   * does it, and the cards that need the extra pass are exactly the ones that
   * never get one.
   */
  const hardCards = useStore(
    useCallback(
      (db: DbDoc) => selectHardCards(db, deck.id, LOCAL_USER_ID),
      [deck.id],
    ),
  );
  /** What Study itself would open: this deck's cards that have come round. */
  const dueCards = useStore(
    useCallback(
      (db: DbDoc) => selectDueCardsByDeckForUser(db, deck.id, LOCAL_USER_ID),
      [deck.id],
    ),
  );
  /** Never answered, never missed — the ones not started yet. */
  const newCards = useStore(
    useCallback(
      (db: DbDoc) => selectNewCards(db, deck.id, LOCAL_USER_ID),
      [deck.id],
    ),
  );
  /** The whole deck, for a pass that ignores the schedule entirely. */
  const allCards = useStore(
    useCallback(
      (db: DbDoc) => selectCardsByDeckForUser(db, deck.id, LOCAL_USER_ID),
      [deck.id],
    ),
  );

  /**
   * Start a session over exactly these cards, in exactly this order.
   *
   * Everything but plain Study goes through here: the session takes a handed-
   * over list as given, which is what lets "hardest first" and "shuffled" mean
   * anything. Plain Study stays a link to the unpicked route, so the ordinary
   * case is one click and behaves as it always has.
   */
  function studyThese(cards: { id: number }[]) {
    if (cards.length === 0) return;
    setStudyPicks(
      deck.id,
      cards.map((c) => c.id),
    );
    router.push(`/deck/study/?id=${deck.id}`);
  }

  /** A copy in a random order — the store's array is never reordered. */
  function shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /**
   * Due first, then whatever else fills the ten.
   *
   * A short session should still be the work that matters, so it starts from
   * what has come round; a deck with nothing due falls back to the rest rather
   * than refusing, since "I have five minutes" is a reason to study something.
   */
  const quickTen = [
    ...dueCards,
    ...allCards.filter((c) => !dueCards.some((d) => d.id === c.id)),
  ].slice(0, 10);
  const [editOpen, setEditOpen] = useState(false);
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [createSubDeckOpen, setCreateSubDeckOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [spellingOpen, setSpellingOpen] = useState(false);
  const [scheduling, startScheduling] = useTransition();
  const [scheduleNote, setScheduleNote] = useState<string | null>(null);
  /** Counted across the deck and its sub-decks — what the menu acts on. */
  const underCount = useStore(
    useCallback(
      (db: DbDoc) => selectCardsUnderDeck(db, deck.id, LOCAL_USER_ID).length,
      [deck.id],
    ),
  );
  const [isPending, startTransition] = useTransition();
  const [isGenerating, startGenerating] = useTransition();
  const [generateError, setGenerateError] = useState<string | null>(null);

  // localStorage isn't available during prerender, so the server snapshot is
  // `false` and the real value arrives on hydration. Nothing changes the key
  // mid-page, hence the no-op subscribe.
  const canGenerate = useSyncExternalStore(
    () => () => {},
    () => hasAIKey(),
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
        {/* Reaches the cards a parent deck's page cannot show. Its page lists
            sub-decks, so there is nothing there to select, and putting a whole
            collection on one schedule otherwise meant visiting each sub-deck. */}
        {underCount > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Review schedule for every card in this deck"
              className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
            >
              <Layers className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {REVIEW_SCHEDULES.map((schedule) => (
                <DropdownMenuItem
                  key={schedule}
                  disabled={scheduling}
                  onClick={() =>
                    startScheduling(async () => {
                      const changed = await setDeckScheduleAction({
                        deckId: deck.id,
                        schedule,
                      });
                      setScheduleNote(
                        changed === 0
                          ? `Every card was already on ${SCHEDULE_LABELS[schedule]}.`
                          : `Put ${changed} card${changed === 1 ? "" : "s"} on ${SCHEDULE_LABELS[schedule]}.`,
                      );
                    })
                  }
                >
                  <Layers />
                  Put all {underCount} on {SCHEDULE_LABELS[schedule]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" />
          <span className="sr-only">Delete deck</span>
        </Button>
      </div>
      {scheduleNote && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {scheduleNote}
        </p>
      )}
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
            {/* Everything that acts on the deck as a whole, in one place.
                These were five buttons across two rows — three of them down in
                the grid's toolbar — which read as a row of equally likely
                things to do when in fact you want Add Card or Study almost
                every time. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                <Wand2 className="size-3.5" />
                {isGenerating ? "Generating…" : "Features"}
                <ChevronDown className="size-3.5 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Add cards</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSpellingOpen(true)}>
                    <SpellCheck className="size-3.5" />
                    Spelling&hellip;
                  </DropdownMenuItem>
                  {/* Hidden entirely without a key — there is no plan to upsell
                      now, so a visible-but-dead item would just be a dead end. */}
                  {canGenerate && (
                    <DropdownMenuItem
                      disabled={isGenerating}
                      onClick={handleGenerateAI}
                    >
                      <Sparkles className="size-3.5" />
                      {isGenerating ? "Generating…" : "Generate with AI"}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>This deck&rsquo;s cards</DropdownMenuLabel>
                  <DropdownMenuItem
                    disabled={!onVaryAll || cardCount === 0}
                    onClick={() => onVaryAll?.()}
                  >
                    <Dices className="size-3.5" />
                    Make all vary&hellip;
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!onSelectCards || cardCount === 0}
                    onClick={() => onSelectCards?.()}
                  >
                    <ListChecks className="size-3.5" />
                    Select cards
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!onShuffleCards || cardCount === 0}
                    onClick={() => onShuffleCards?.()}
                  >
                    <Shuffle className="size-3.5" />
                    Shuffle the grid
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* A split control: Study still opens what is due in one click,
                and the chevron holds the other ways in. Making Study itself a
                menu would have charged the common case an extra click to reach
                what it already did. */}
            {cardCount > 0 && (
              <div className="inline-flex">
                <Link
                  href={`/deck/study/?id=${deck.id}`}
                  className={buttonVariants({
                    size: "sm",
                    variant: "secondary",
                    className: "rounded-r-none",
                  })}
                >
                  <BookOpen className="size-3.5" />
                  Study
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Other ways to study this deck"
                    className={buttonVariants({
                      size: "icon-sm",
                      variant: "secondary",
                      className: "rounded-l-none border-l border-black/10 dark:border-white/10",
                    })}
                  >
                    <ChevronDown className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Study</DropdownMenuLabel>
                      <DropdownMenuItem
                        disabled={dueCards.length === 0}
                        onClick={() => studyThese(shuffle(dueCards))}
                      >
                        <Shuffle className="size-3.5" />
                        Shuffle and study
                        <span className="ml-auto pl-3 tabular-nums opacity-60">
                          {dueCards.length}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={hardCards.length === 0}
                        onClick={() => studyThese(hardCards)}
                      >
                        <Flame className="size-3.5 text-amber-500" />
                        Hardest first
                        <span className="ml-auto pl-3 tabular-nums opacity-60">
                          {hardCards.length}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={newCards.length === 0}
                        onClick={() => studyThese(newCards)}
                      >
                        <Sprout className="size-3.5 text-emerald-500" />
                        New cards first
                        <span className="ml-auto pl-3 tabular-nums opacity-60">
                          {newCards.length}
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Ignore the schedule</DropdownMenuLabel>
                      {/* Neither of these waits for a card to come round. The
                          first is the pass before an exam; the second is for
                          the five minutes you actually have. */}
                      <DropdownMenuItem
                        disabled={allCards.length === 0}
                        onClick={() => studyThese(allCards)}
                      >
                        <Layers className="size-3.5" />
                        Everything in this deck
                        <span className="ml-auto pl-3 tabular-nums opacity-60">
                          {allCards.length}
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={quickTen.length === 0}
                        onClick={() => studyThese(quickTen)}
                      >
                        <Timer className="size-3.5" />
                        Quick session
                        <span className="ml-auto pl-3 tabular-nums opacity-60">
                          {quickTen.length}
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onSelectCards}>
                      <ListChecks className="size-3.5" />
                      Pick cards to study&hellip;
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </>
        )}
        {/* Outside the childless-only block above, unlike Study. A deck with
            sub-decks is where hard cards collect — they are spread across the
            children and nothing gathers them — and `selectCardsByIdsForUser`
            resolves picks by id rather than by deck, so studying a parent's
            hard cards works even though its own card list is empty.

            Only when there are some: a button that is usually disabled teaches
            you to stop looking at it. */}
        {hasChildren && hardCards.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            title={`Study the ${hardCards.length} card${hardCards.length === 1 ? "" : "s"} you have missed ${HARD_MISS_THRESHOLD} or more times, worst first`}
            onClick={() => {
              // Handed over the same way the grid hands over a selection, so
              // the session takes this list in this order rather than
              // re-deriving what happens to be due.
              setStudyPicks(
                deck.id,
                hardCards.map((c) => c.id),
              );
              router.push(`/deck/study/?id=${deck.id}`);
            }}
          >
            <Flame className="size-3.5 text-amber-500" />
            Hard {hardCards.length}
          </Button>
        )}
        {(hasChildren || canAddSubDeck) && (
          <Button
            size="sm"
            variant={hasChildren ? "default" : "outline"}
            onClick={() => setCreateSubDeckOpen(true)}
          >
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
      <SpellingCardDialog
        deckId={deck.id}
        open={spellingOpen}
        onOpenChange={setSpellingOpen}
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
            <AlertDialogTitle>
              Delete &ldquo;{deck.title}&rdquo;?
            </AlertDialogTitle>
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
