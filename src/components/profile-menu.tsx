"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ProfileAvatar } from "@/components/profile-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getActiveProfileId,
  getProfilesServerSnapshot,
  listProfiles,
  subscribeProfiles,
  switchProfile,
} from "@/lib/store/profiles";

/**
 * Whose decks these are, and a way to change it.
 *
 * Hidden entirely while there is only one profile: the great majority of people
 * never add a second, and a control that always reads "Main" is a permanent
 * question about something they have not asked. The way to a second profile is
 * Settings, and once one exists this appears.
 *
 * Read through `useSyncExternalStore` because the list lives in localStorage,
 * which the prerender in Node cannot see. The server snapshot is the single
 * default profile, so the prerendered HTML and the browser's first paint agree
 * and the real list arrives on hydration.
 */
export function ProfileMenu() {
  const profiles = useSyncExternalStore(
    subscribeProfiles,
    listProfiles,
    getProfilesServerSnapshot,
  );

  if (profiles.length < 2) return null;

  const activeId = getActiveProfileId();
  const active = profiles.find((p) => p.id === activeId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Profile: ${active?.name ?? "Main"}`}
        title={`Profile: ${active?.name ?? "Main"}`}
        // Bigger than the icons beside it, and with the ring the avatar
        // already carries doing the work a button border would.
        className={buttonVariants({
          variant: "ghost",
          size: "icon-lg",
          className: "size-10",
        })}
      >
        {/* The avatar rather than a generic person icon: the point of the
            control is which of you is looking at it, and that is the one thing
            a shared glyph cannot say. */}
        {active ? (
          <ProfileAvatar profile={active} size="lg" />
        ) : (
          <span className="size-8" />
        )}
      </DropdownMenuTrigger>
      {/* Wide enough that the longest item fits on one line, rather than the
          item forcing itself wider than the panel it sits in. */}
      <DropdownMenuContent align="end" className="min-w-44">
        {/* The label is a *group* label in Base UI and throws outside one, so
            the profiles are a group rather than loose items. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Whose decks</DropdownMenuLabel>
          {profiles.map((profile) => (
            <DropdownMenuItem
              key={profile.id}
              // Switching reloads the page, so choosing the one already open
              // would throw away a half-finished session for nothing.
              disabled={profile.id === activeId}
              onClick={() => switchProfile(profile.id)}
            >
              <Check
                className={`size-3.5 ${profile.id === activeId ? "" : "invisible"}`}
              />
              <ProfileAvatar profile={profile} />
              {profile.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href="/settings#profiles">Manage profiles</Link>}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
