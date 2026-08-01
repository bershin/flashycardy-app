# Cue

A personal flashcard app with sub-decks, rich-text cards, and spaced repetition.

It runs entirely in your browser as a static site on GitHub Pages — no server, no
database, no subscriptions. Your decks live in IndexedDB and sync to a private
GitHub repository, whose commit history doubles as versioned backup.

## How the data works

| Where | What |
| --- | --- |
| IndexedDB (this browser) | The working copy. Everything reads and writes here first, so the app is instant and works offline. |
| `data.json` in a private repo | The source of truth. Written via the GitHub API a few seconds after each change. |
| Downloaded backup | A copy you hold yourself, from Settings. |

Because the app is static, opening the site on a new device shows an empty
database until you enter your sync settings. Nothing is stored on any server.

## Setup

1. **Create a private repo** for your data, e.g. `cue-data`. It can be
   empty. It must be a *separate* repo — GitHub Pages only publishes from public
   repos on a free account, and you do not want your cards public.
2. **Create a fine-grained access token** at
   [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens),
   scoped to only that repository, with **Contents: read and write**.
3. Open the app → **Settings**, fill in the owner, repo and token, and hit
   **Save & test connection**.
4. Repeat step 3 on each device you want to sync.

### Optional: AI card generation

Add an OpenAI API key in Settings and decks gain a "Generate with AI" button.
Requests go straight from your browser to OpenAI and are billed to your own
account. Without a key the button is hidden and nothing costs anything.

## Development

```bash
npm install
npm run dev
```

Build the static site the same way CI does:

```bash
npm run build      # emits ./out
npm run serve      # serve it locally
```

For a local build, set `NEXT_PUBLIC_BASE_PATH=""` — otherwise everything is
prefixed with `/flashycardy-app` for GitHub Pages.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes `out/` to GitHub Pages. Enable it once under
**Settings → Pages → Source → GitHub Actions**.

If you rename the repo or move to a custom domain, update
`NEXT_PUBLIC_BASE_PATH` in that workflow.

## Moving decks

A deck's header has a **move** button next to edit and delete. It can be filed
under another deck, or sent back out to the top level.

Because decks are only ever one level deep, three rules apply, and the picker
only offers destinations that satisfy them:

- a deck that **has sub-decks** can't be moved under anything — its children
  would end up two levels down, so move them out first;
- the destination must be **top-level**, for the same reason;
- the destination must hold **no cards of its own**, since a parent deck's card
  list is the union of its children's.

Moving the `Archive` deck's contents around is allowed too — it is an ordinary
deck, and appears last in the list.

## Moving cards

A card's `⋯` menu has **Move to deck…**, which lists every deck that can accept
it. Sub-decks are shown with their parent (`Spanish › Past Tense`) so
same-named decks stay distinguishable, and the archive is listed last.

Decks that contain sub-decks are not offered: a parent deck's card list is the
union of its children's, so it has nowhere of its own to put a card. Moving a
card keeps its streak and next review date — it is the same card, just filed
somewhere else. Pulling one back out of the archive therefore puts it straight
back into rotation.

## Card types

**Basic** — a question and an answer. Flip it, then rate yourself.

**Quiz** — a question with 2–6 options, one of which you marked correct. Options
are shuffled on every review so you learn the answer rather than its position.
Answering right moves straight on; answering wrong shows which one was right,
along with the optional explanation, and waits for you. No AI and no network
involved: you wrote the answer, so grading is a comparison.

## How reviews are scheduled

Each card tracks one number: how many times in a row you've answered it
correctly.

| Correct in a row | Next review |
| --- | --- |
| 1 | tomorrow |
| 2 | in 1 week |
| 3 | in 2 weeks |
| 4 | in 3 weeks |
| 5 | archived |

Cleanly learned, a card is therefore seen on days 0, 1, 8, 22 and 43 before
being archived. The intervals live in `REVIEW_INTERVAL_DAYS` in
`src/db/queries/cards.ts`; adding another entry extends the ladder and pushes
archiving back automatically.

Answering **Missed** resets the streak to zero and brings the card back about
ten minutes later, so something you just got wrong reappears in the same sitting
rather than waiting until tomorrow. Intervals are measured from today rather
than from the date a card was due, so a long gap between sessions never builds
up a compounding backlog.

### If you close the app mid-session

Every rating is written to the database the moment you press it, so nothing you
have already answered is ever lost. The session position — where you were, the
running tally, which round you are on — is saved separately, and reopening the
deck offers to pick up where you left off:

> You left a session unfinished — card 60 of 100.
> **Resume** · **Start fresh**

Unfinished sessions are kept per deck and expire at the end of the day, since by
the next morning the schedule has moved on. They live only on the device that
made them and are never synced.

Cards answered correctly five times running are **archived, not deleted**. An
`Archive` deck is created automatically, with one sub-deck per source deck, so
you can always find what you learned and where it came from. Archived cards
never appear as due and won't nag from the dashboard — open the Archive and hit
Study if you want to run through them. They also survive deleting the deck they
came from.

## Architecture notes

- `src/lib/store/` — the document, IndexedDB persistence, selectors, GitHub sync.
- `src/db/queries/` — the data-access API everything else calls.
- `src/app/**/actions.ts` — mutations. Formerly Server Actions, now plain client
  functions, since a static export has no server.

Deck ids only exist in your browser, so pages use query parameters
(`/deck?id=123`) rather than dynamic route segments, which a static export cannot
enumerate at build time.

Card images are stored inline as base64 in the card HTML, and so travel inside
`data.json`. They are downscaled to 1600px on insert to keep the file well under
GitHub's 100 MB limit; Settings shows the current size.
