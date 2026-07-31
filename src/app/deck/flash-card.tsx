"use client";

import { useState, useTransition } from "react";
import { Copy, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditCardDialog } from "@/components/edit-card-dialog";
import { cloneCardAction, deleteCardAction } from "./actions";

interface FlashCardProps {
  card: {
    id: number;
    front: string;
    back: string;
  };
}

export function FlashCard({ card }: FlashCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editCardId, setEditCardId] = useState(card.id);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClone() {
    startTransition(async () => {
      try {
        const cloned = await cloneCardAction({ cardId: card.id });
        if (cloned) {
          setEditCardId(cloned.id);
          setEditOpen(true);
        }
      } catch {
        // clone failed silently
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteCardAction({ cardId: card.id });
        setDeleteOpen(false);
      } catch {
        // keep dialog open so the user can retry
      }
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div
            className="rich-content min-w-0 overflow-hidden text-base font-semibold"
            dangerouslySetInnerHTML={{ __html: card.front }}
          />
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={buttonVariants({ variant: "ghost", size: "icon-xs" })}
              >
                <Ellipsis className="size-3.5" />
                <span className="sr-only">Card actions</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setEditCardId(card.id);
                    setEditOpen(true);
                  }}
                >
                  <Pencil />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={handleClone}
                  disabled={isPending}
                >
                  <Copy />
                  Clone
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div
            className="rich-content text-muted-foreground"
            dangerouslySetInnerHTML={{ __html: card.back }}
          />
        </CardContent>
      </Card>

      <EditCardDialog
        cardId={editCardId}
        front={card.front}
        back={card.back}
        open={editOpen}
        onOpenChange={(nextOpen) => {
          setEditOpen(nextOpen);
          if (!nextOpen) setEditCardId(card.id);
        }}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Card</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this card? This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
