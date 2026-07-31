"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateDeckDialog } from "@/components/create-deck-dialog";

export function CreateDeckButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        New Deck
      </Button>
      <CreateDeckDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
