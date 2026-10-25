import Image from "@tiptap/extension-image";
import { cachedUrl, resolveImage } from "@/lib/image-urls";
import { IMAGE_PREFIX } from "@/lib/images";

/**
 * The editor's picture, able to show a stored one.
 *
 * A saved card names its pictures — `cue:<hash>` — and a browser cannot draw
 * that, so opening any card with a picture for editing showed a broken image
 * where the picture should be. This draws the looked-up picture while the
 * document keeps the reference, so saving writes back exactly what was there.
 */
export const StoredImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement("img");
      let shown = "";

      const show = (src: string) => {
        if (src === shown) return;
        shown = src;
        if (!src.startsWith(IMAGE_PREFIX)) {
          img.src = src;
          return;
        }
        const hash = src.slice(IMAGE_PREFIX.length);
        const ready = cachedUrl(hash);
        if (ready) {
          img.src = ready;
          return;
        }
        img.removeAttribute("src");
        void resolveImage(hash).then((url) => {
          // Still the same picture by the time it arrives.
          if (url && shown === src) img.src = url;
        });
      };

      const apply = (attrs: Record<string, unknown>) => {
        for (const name of ["alt", "title", "width", "height"]) {
          const value = attrs[name];
          if (value == null) img.removeAttribute(name);
          else img.setAttribute(name, String(value));
        }
        show(String(attrs.src ?? ""));
      };

      apply(node.attrs);
      return {
        dom: img,
        update: (next) => {
          if (next.type !== node.type) return false;
          apply(next.attrs);
          return true;
        },
      };
    };
  },
});
