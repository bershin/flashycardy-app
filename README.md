# FlashyCardy

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

1. **Create a private repo** for your data, e.g. `flashycardy-data`. It can be
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
