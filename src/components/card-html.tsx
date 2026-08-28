"use client";

import { useEffect, useMemo, useState } from "react";
import { withLazyImages } from "@/lib/card-html";
import { imageRefs } from "@/lib/card-images";
import { cachedUrl, resolveImage } from "@/lib/image-urls";
import { IMAGE_PREFIX } from "@/lib/images";

/**
 * A card's HTML, with its pictures resolved.
 *
 * The HTML names pictures rather than carrying them, so something has to look
 * them up before the browser is asked to draw them. That is a read from
 * IndexedDB and cannot happen during render, so the card appears immediately
 * with its words and the pictures arrive a moment later — which is the right
 * order anyway: the question is what you are reading first.
 *
 * A picture this device does not have leaves its reference in place, and the
 * `onError` fallback below turns it into a note rather than a broken icon. That
 * happens legitimately: cards sync in one document and pictures arrive as
 * separate files, so a card can be here before its scan is.
 */
export function CardHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  /**
   * Bumped when pictures finish loading, which is the only reason to re-render.
   *
   * A counter rather than the resolved HTML in state: the HTML is derived from
   * the props and the cache, so keeping a copy of it would be a second source
   * of truth that has to be kept in step with both.
   */
  const [loaded, setLoaded] = useState(0);

  /** Pictures the lookup has come back empty for — not merely pending. */
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const refs = imageRefs(html);
    if (refs.length === 0) return;
    if (refs.every((hash) => cachedUrl(hash))) return;

    let live = true;
    void Promise.all(
      refs.map(async (hash) => [hash, await resolveImage(hash)] as const),
    ).then((results) => {
      if (!live) return;
      const missing = results.filter(([, url]) => !url).map(([hash]) => hash);
      // One update once they are all in, rather than a re-render per picture.
      setLoaded((n) => n + 1);
      if (missing.length > 0)
        setFailed((prev) => new Set([...prev, ...missing]));
    });

    return () => {
      live = false;
    };
  }, [html]);

  const resolved = useMemo(
    () => substitute(html, failed),
    // `loaded` is the signal that the cache has more in it than it did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [html, loaded, failed],
  );

  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: resolved }} />
  );
}

/**
 * Swap every reference for its picture, or for a stand-in.
 *
 * Three states, and they must not be confused. Resolved: the object URL. Still
 * looking: an empty box that takes up no argument — the lookup is a read from
 * IndexedDB and usually finishes in a moment. Looked and not found: a caption.
 *
 * The first version left the `cue:` reference in the tag while the lookup ran
 * and let the browser's `onerror` write the caption. But the browser fails on
 * an unknown scheme instantly, so every picture was declared missing before it
 * had been looked for — and the caption replaced the element, so the picture
 * that arrived a moment later had nowhere to go. A whole deck of scans read
 * "Picture not on this device yet" while every one of them sat in the store.
 */
function substitute(html: string, failed: Set<string>): string {
  const withUrls = html.replace(
    new RegExp(`<img[^>]*src="${IMAGE_PREFIX}([0-9a-f]{64})"[^>]*>`, "g"),
    (tag, hash: string) => {
      const url = cachedUrl(hash);
      if (url) return tag.replace(`${IMAGE_PREFIX}${hash}`, url);
      if (failed.has(hash)) {
        return `<span class="text-xs text-muted-foreground">Picture not on this device yet</span>`;
      }
      // Still being looked up: nothing is claimed either way.
      return `<span data-pending-image="${hash}"></span>`;
    },
  );
  return withLazyImages(withUrls);
}
