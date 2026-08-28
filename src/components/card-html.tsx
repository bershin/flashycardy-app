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

  useEffect(() => {
    const refs = imageRefs(html);
    if (refs.length === 0) return;
    if (refs.every((hash) => cachedUrl(hash))) return;

    let live = true;
    void Promise.all(refs.map(resolveImage)).then(() => {
      // One update once they are all in, rather than a re-render per picture.
      if (live) setLoaded((n) => n + 1);
    });

    return () => {
      live = false;
    };
  }, [html]);

  const resolved = useMemo(
    () => substitute(html),
    // `loaded` is the signal that the cache has more in it than it did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [html, loaded],
  );

  return (
    <div className={className} dangerouslySetInnerHTML={{ __html: resolved }} />
  );
}

/** Swap every reference this device can already answer for its object URL. */
function substitute(html: string): string {
  const withUrls = html.replace(
    new RegExp(`src="${IMAGE_PREFIX}([0-9a-f]{64})"`, "g"),
    (whole, hash: string) => {
      const url = cachedUrl(hash);
      // Left as it is when missing: `onerror` on the tag turns an unresolvable
      // picture into a caption instead of a broken image icon.
      return url ? `src="${url}"` : whole;
    },
  );
  return withLazyImages(withUrls).replace(
    /<img(?![^>]*\bonerror=)/gi,
    `<img onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'text-xs text-muted-foreground',textContent:'Picture not on this device yet'}))"`,
  );
}
