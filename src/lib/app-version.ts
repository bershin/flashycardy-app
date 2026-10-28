"use client";

/**
 * Keep an open copy of the app from outliving its release.
 *
 * A tab or home-screen app left open keeps running the code it started with,
 * for days if nobody closes it. That copy still syncs, so it reads cards a
 * newer release wrote — and a card type it has never heard of comes out as a
 * basic card. When picture cards arrived, a tablet left open from before
 * showed a picture card with every label visible, and answering it saved the
 * card back as basic.
 *
 * So the app asks, whenever it comes back into view and every so often while
 * it is showing, which release is deployed. If it is not this one, the page
 * reloads into the new one — unless a dialog is open, where reloading would
 * throw away a card being typed; then it waits for the next check.
 */

const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** How often to ask while the app stays in view. */
const EVERY_MS = 15 * 60_000;

async function deployedBuild(): Promise<string | null> {
  try {
    const response = await fetch(`${BASE}/version.json`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { build?: unknown };
    return typeof body.build === "string" ? body.build : null;
  } catch {
    // Offline is not out of date.
    return null;
  }
}

/** Something is being written that a reload would lose. */
function busy(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

async function check() {
  if (document.visibilityState !== "visible" || busy()) return;
  const deployed = await deployedBuild();
  if (!deployed || deployed === "dev" || deployed === BUILD || busy()) return;

  // Once per release. If the reload still came back to this build — a page
  // cached on the way — reloading again would only loop.
  const key = "flashycardy.reloadedFor";
  try {
    if (window.sessionStorage.getItem(key) === deployed) return;
    window.sessionStorage.setItem(key, deployed);
  } catch {
    // Without storage there is no loop guard, so do not risk one.
    return;
  }
  window.location.reload();
}

/** Start watching; returns the function that stops it. */
export function watchForNewRelease(): () => void {
  // A local build has nothing to compare against.
  if (BUILD === "dev") return () => {};

  const onVisible = () => void check();
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  const timer = window.setInterval(onVisible, EVERY_MS);
  void check();

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.clearInterval(timer);
  };
}
