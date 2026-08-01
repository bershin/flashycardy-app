"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";

/**
 * With no sign-in step there is nothing for a landing page to do, so the root
 * just forwards to the dashboard. Kept as a route (rather than moving the
 * dashboard here) so existing links and the PWA `start_url` keep working.
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  // Shown only for the moment before the redirect lands, so it stays a
  // wordmark rather than a landing page nobody reads.
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent-1)] to-[var(--accent-4)] shadow-lg">
          <Layers className="size-7 text-white" />
        </span>
        <h1 className="bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-5xl font-bold tracking-tight text-transparent">
          Cue
        </h1>
        <p className="text-xl text-muted-foreground">My personal flash cards</p>
      </div>
    </div>
  );
}
