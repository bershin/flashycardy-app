"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { Archive, FolderInput, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectMoveTargets } from "@/lib/store/selectors";
import type { DbDoc } from "@/lib/store/types";
import { moveCardsAction } from "@/app/deck/actions";

interface MoveCardDialogProps {
  /** One id from a card's own menu, or many from a multi-select. */
  cardIds: number[];
  currentDeckId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved?: () => void;
}

export function MoveCardDialog({
  cardIds,
  currentDeckId,
  open,
  onOpenChange,
  onMoved,
}: MoveCardDialogProps) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const targets = useStore(
    useCallback(
      (db: DbDoc) => selectMoveTargets(db, LOCAL_USER_ID, currentDeckId),
      [currentDeckId],
    ),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) =>
      `${t.parentTitle ?? ""} ${t.title}`.toLowerCase().includes(q),
    );
  }, [targets, query]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setQuery("");
      setError(null);
    }
    onOpenChange(next);
  }

  function move(targetDeckId: number) {
    setError(null);
    startTransition(async () => {
      try {
        await moveCardsAction({ cardIds, targetDeckId });
        handleOpenChange(false);
        onMoved?.();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : `Could not move the card${cardIds.length === 1 ? "" : "s"}.`,
        );
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {cardIds.length === 1 ? "Move card" : `Move ${cardIds.length} cards`}
          </DialogTitle>
          <DialogDescription>
            {cardIds.length === 1
              ? "Pick a deck to move this card into. Its review schedule comes with it."
              : "Pick a deck to move them into. Their review schedules come with them."}
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            There is nowhere to move {cardIds.length === 1 ? "this card" : "them"}
            . Create another deck first &mdash; decks that contain sub-decks
            can&rsquo;t hold cards themselves.
          </p>
        ) : (
          <>
            {targets.length > 6 && (
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter decks…"
                  className="pl-9"
                />
              </div>
            )}

            <div className="max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No decks match &ldquo;{query}&rdquo;.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {filtered.map((target) => (
                    <li key={target.id}>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => move(target.id)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        {target.isArchive ? (
                          <Archive className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <FolderInput className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          {target.parentTitle && (
                            <span className="text-muted-foreground">
                              {target.parentTitle} &rsaquo;{" "}
                            </span>
                          )}
                          <span className="font-medium">{target.title}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {target.cardCount} card
                          {target.cardCount === 1 ? "" : "s"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
