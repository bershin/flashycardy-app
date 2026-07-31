"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-5xl font-bold tracking-tight">FlashyCardy</h1>
        <p className="text-xl text-muted-foreground">My personal flash cards</p>
      </div>
    </div>
  );
}
