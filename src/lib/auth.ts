/**
 * Stand-in for Clerk.
 *
 * The app is single-user and its data never leaves the device except to the
 * user's own private GitHub repo, so there is nothing to authenticate against.
 * Rather than tear `userId` out of the data layer, it collapses to one constant:
 * every ownership filter in `src/db/queries/*` keeps working, the shape of the
 * data is unchanged, and re-introducing real accounts later means changing this
 * file rather than every query.
 *
 * Mirrors the shape of Clerk's `auth()` — including `has()`, which now always
 * grants, since the free/Pro split existed only to gate the paid tier.
 */

export const LOCAL_USER_ID = "local-user";

export type AuthResult = {
  userId: string;
  has: (query?: { plan?: string; feature?: string }) => boolean;
};

export function auth(): AuthResult {
  return {
    userId: LOCAL_USER_ID,
    has: () => true,
  };
}
