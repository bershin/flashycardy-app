"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shortcutAllowed } from "@/lib/shortcuts";

/** How long after "g" the second key still counts as part of the pair. */
const SEQUENCE_MS = 1500;

/** "g" then one of these goes to that page, from anywhere in the app. */
const GO_TO: Record<string, string> = {
  h: "/dashboard",
  c: "/calendar",
  n: "/notes",
  s: "/settings",
};

const SECTIONS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      [["g", "h"], "Home — all your decks"],
      [["g", "c"], "Calendar"],
      [["g", "n"], "Notes"],
      [["g", "s"], "Settings"],
      [["?"], "Show this list"],
    ],
  },
  {
    title: "Home",
    keys: [
      [["←", "→", "↑", "↓"], "Move between decks"],
      [["Enter"], "Open the selected deck"],
      [["n"], "Study its new cards"],
      [["h"], "Study its hard cards"],
      [["d"], "Study its due cards"],
      [["Esc"], "Clear the selection"],
    ],
  },
  {
    title: "Studying",
    keys: [
      [["Space", "↓"], "Turn the card over"],
      [["←", "1"], "Missed"],
      [["→", "2"], "Got it"],
    ],
  },
];

/**
 * The keys that work on every page: "g" pairs to jump between pages, and "?"
 * for the list of everything.
 *
 * Pairs rather than single letters so that nothing a page does with a lone
 * key is taken from it — "h" on the dashboard studies the hard cards, but
 * "g h" goes home. The listener runs in the capture phase so that the second
 * key of a pair is claimed here before a page's own handler sees it.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingSince = useRef<number | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!shortcutAllowed(e)) {
        pendingSince.current = null;
        return;
      }

      const key = e.key.toLowerCase();
      const pending =
        pendingSince.current !== null &&
        Date.now() - pendingSince.current < SEQUENCE_MS;
      pendingSince.current = null;

      if (pending) {
        const href = GO_TO[key];
        if (href) {
          e.preventDefault();
          e.stopImmediatePropagation();
          router.push(href);
          return;
        }
      }

      if (key === "g") {
        pendingSince.current = Date.now();
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [router]);

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            For a pair like <Kbd>g</Kbd> <Kbd>h</Kbd>, press one key and then the
            other.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {section.title}
              </h3>
              <dl className="grid gap-1.5">
                {section.keys.map(([keys, label]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-4"
                  >
                    <dt>{label}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-sans text-xs font-medium text-foreground shadow-[0_1px_0_var(--border)]">
      {children}
    </kbd>
  );
}
