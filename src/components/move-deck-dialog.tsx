"use client";

import { useCallback, useState, useTransition } from "react";
import { Archive, FolderInput, Layers, Home } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LOCAL_USER_ID } from "@/lib/auth";
import { useStore } from "@/lib/store/use-store";
import { selectDeckMoveOptions } from "@/lib/store/selectors";
import type { DbDoc } from "@/lib/store/types";
import { moveDeckAction } from "@/app/dashboard/actions";

interface MoveDeckDialogProps {
  deckId: number;
  deckTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoveDeckDialog({
  deckId,
  deckTitle,
  open,
  onOpenChange,
}: MoveDeckDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const options = useStore(
    useCallback(
      (db: DbDoc) => selectDeckMoveOptions(db, LOCAL_USER_ID, deckId),
      [deckId],
    ),
  );

  function handleOpenChange(next: boolean) {
    if (!next) setError(null);
    onOpenChange(next);
  }

  function move(targetParentId: number | null) {
    setError(null);
    startTransition(async () => {
      try {
        await moveDeckAction({ deckId, targetParentId });
        handleOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not move the deck.");
      }
    });
  }

  const hasSomewhereToGo =
    options.canMoveToTopLevel || options.targets.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move &ldquo;{deckTitle}&rdquo;</DialogTitle>
          <DialogDescription>
            Decks can be one level deep. Only top-level decks with no cards of
            their own can take a sub-deck.
          </DialogDescription>
        </DialogHeader>

        {options.blocked ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {options.blocked}
          </p>
        ) : !hasSomewhereToGo ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            There is nowhere to move this deck. A destination has to be a
            top-level deck that holds no cards of its own.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <ul className="flex flex-col gap-1">
              {options.canMoveToTopLevel && (
                <li>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => move(null)}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Home className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 font-medium">Top level</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      no longer a sub-deck
                    </span>
                  </button>
                </li>
              )}

              {options.targets.map((target) => (
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
                    <span className="flex-1 font-medium">{target.title}</span>
                    {target.childCount > 0 && (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Layers className="size-3" />
                        {target.childCount}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
