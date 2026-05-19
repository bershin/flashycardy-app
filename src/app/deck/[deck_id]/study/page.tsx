import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
import { getDeckByIdForUser } from "@/db/queries/decks";
import {
  getCardsByDeckForUser,
  getDueCardsByDeckForUser,
} from "@/db/queries/cards";
import { StudySession } from "./study-session";

export default async function StudyPage({
  params,
}: {
  params: Promise<{ deck_id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const { deck_id } = await params;
  const deckId = Number(deck_id);
  if (Number.isNaN(deckId)) notFound();

  const deck = await getDeckByIdForUser(deckId, userId);
  if (!deck) notFound();

  const allCards = await getCardsByDeckForUser(deckId, userId);

  if (allCards.length === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <Link
          href={`/deck/${deck_id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to deck
        </Link>
        <div className="mt-16 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{deck.title}</h1>
          <p className="mt-2 text-muted-foreground">
            This deck has no cards yet. Add some cards before studying.
          </p>
          <Link
            href={`/deck/${deck_id}`}
            className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Go back and add cards
          </Link>
        </div>
      </div>
    );
  }

  const dueCards = await getDueCardsByDeckForUser(deckId, userId);

  if (dueCards.length === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <Link
          href={`/deck/${deck_id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to deck
        </Link>
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10">
            <CheckCircle className="size-8 text-emerald-500" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">
            {deck.title}
          </h1>
          <p className="mt-2 text-muted-foreground">
            No cards are due for review right now. Check back later!
          </p>
          <Link
            href={`/deck/${deck_id}`}
            className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline"
          >
            Back to deck
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-hidden px-4 py-4">
      <div className="flex items-center justify-between">
        <Link
          href={`/deck/${deck_id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to deck
        </Link>
        <p className="text-sm text-muted-foreground">
          {dueCards.length} card{dueCards.length === 1 ? "" : "s"} due
        </p>
      </div>
      <h1 className="mt-2 text-xl font-bold tracking-tight">{deck.title}</h1>
      <StudySession cards={dueCards} deckId={deckId} />
    </div>
  );
}
