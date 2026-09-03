"use client";

import { profileAccent, type Profile } from "@/lib/store/profiles";

/**
 * A profile's face: the emoji it was given, or the first letter of its name.
 *
 * Always something rather than sometimes nothing — a profile with no emoji
 * still needs to be distinguishable in the header, and an empty circle would
 * be worse than a letter. The colour comes from the id, so it survives a
 * rename; the letter does not, which is why the colour carries the recognition
 * and the letter only confirms it.
 */
export function ProfileAvatar({
  profile,
  size = "sm",
}: {
  profile: Profile;
  /** `sm` for menus and rows, `md` for the header trigger. */
  size?: "sm" | "md";
}) {
  const accent = profileAccent(profile.id);
  const initial = profile.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${
        size === "md" ? "size-6 text-[0.8rem]" : "size-5 text-[0.7rem]"
      }`}
      style={{
        // Tinted rather than solid so the emoji and the letter both stay
        // readable in either theme, where a solid accent would swamp one of
        // them. `color-mix` matches how deck surfaces are tinted.
        background: `color-mix(in oklab, ${accent} 22%, transparent)`,
        color: accent,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 45%, transparent)`,
      }}
    >
      {profile.emoji ?? initial}
    </span>
  );
}
