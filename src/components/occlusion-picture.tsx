"use client";

import { useEffect, useState } from "react";
import { CardHtml } from "@/components/card-html";
import { cachedUrl, resolveImage } from "@/lib/image-urls";
import { IMAGE_PREFIX } from "@/lib/images";
import {
  firstImageSrc,
  targetBox,
  withoutFirstImage,
  type OcclusionBox,
  type OcclusionPayload,
} from "@/lib/occlusion";

/**
 * Something an `<img>` can show for a card's picture.
 *
 * In the editor a freshly pasted picture is still a `data:` URL; once saved it
 * is a `cue:` reference that has to be looked up. Null while looking, and for
 * a picture this device does not have yet.
 */
export function usePictureUrl(src: string | null): string | null {
  const hash = src?.startsWith(IMAGE_PREFIX)
    ? src.slice(IMAGE_PREFIX.length)
    : null;
  const [resolved, setResolved] = useState<{ hash: string; url: string } | null>(
    null,
  );

  useEffect(() => {
    if (!hash || cachedUrl(hash)) return;
    let live = true;
    void resolveImage(hash).then((url) => {
      if (live && url) setResolved({ hash, url });
    });
    return () => {
      live = false;
    };
  }, [hash]);

  if (!src) return null;
  if (!hash) return src;
  return cachedUrl(hash) ?? (resolved?.hash === hash ? resolved.url : null);
}

/** Where a box sits, as CSS on a box laid over the picture. */
export function boxStyle(box: OcclusionBox): React.CSSProperties {
  return {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
  };
}

/**
 * A picture card's question: its words, then the picture with the labels
 * covered and this card's box picked out.
 *
 *  - `question` — every label covered, this card's marked "?".
 *  - `answer`   — this card's box opened and outlined, the others still covered:
 *                 the next card from the picture should not be given away.
 *
 * The picture ignores the pointer. The study screen opens any picture that is
 * clicked at full size, and full size has no boxes on it — clicking a covered
 * label would show every answer on the picture.
 */
export function OcclusionPicture({
  html,
  occlusion,
  state,
  className,
}: {
  html: string;
  occlusion: OcclusionPayload;
  state: "question" | "answer";
  className?: string;
}) {
  const url = usePictureUrl(firstImageSrc(html));
  const words = withoutFirstImage(html);
  const target = targetBox(occlusion);

  return (
    <div className={className}>
      {words && <CardHtml className="rich-content mb-2" html={words} />}
      <div className="relative mx-auto w-fit max-w-full select-none">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- an object URL, which next/image cannot optimise
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none block h-auto max-h-[60vh] max-w-full rounded-md"
          />
        ) : (
          <div className="flex h-40 w-64 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            Loading picture…
          </div>
        )}
        {url &&
          occlusion.boxes.map((box) => {
            const mine = box.id === target?.id;
            if (mine && state === "answer") {
              return (
                <span
                  key={box.id}
                  style={boxStyle(box)}
                  className="absolute rounded-sm ring-3 ring-emerald-500"
                />
              );
            }
            return (
              <span
                key={box.id}
                style={boxStyle(box)}
                className={`absolute flex items-center justify-center rounded-sm text-xs font-bold ${
                  mine
                    ? "bg-violet-600 text-white shadow-[0_0_0_3px_rgb(124_58_237/0.35)]"
                    : "bg-amber-300 dark:bg-amber-400"
                }`}
              >
                {mine ? "?" : ""}
              </span>
            );
          })}
      </div>
    </div>
  );
}
