/**
 * Card HTML on its way to the screen.
 *
 * A card's images are inline base64, and the browser decodes each one to raw
 * pixels the moment it is attached to the document — a 1400×1000 scan costs
 * about 5 MB decoded whatever the file size was. A deck page holding a couple
 * of hundred of those asks the renderer for hundreds of megabytes of bitmap
 * before a single one has been scrolled to, which is felt as lag long before it
 * is seen as memory.
 *
 * Marking them lazy hands that decision back to the browser: only what is near
 * the viewport is fetched and decoded, and the rest costs nothing until it is
 * scrolled towards.
 */
export function withLazyImages(html: string): string {
  // Untouched if it already says so, so a card edited by hand keeps its own
  // attributes rather than collecting duplicates.
  return html.replace(/<img(?![^>]*\bloading=)/gi, '<img loading="lazy" decoding="async"');
}
