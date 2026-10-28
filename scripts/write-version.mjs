/**
 * Stamp the build with its version, so an open copy of the app can tell when
 * a newer one has been released.
 *
 * Written after `next build`, into the exported site, as `version.json`. The
 * same value is compiled into the app as NEXT_PUBLIC_BUILD_ID (see
 * next.config.ts); `src/lib/app-version.ts` compares the two.
 */
import { writeFileSync } from "node:fs";

const build = process.env.GITHUB_SHA ?? "dev";
writeFileSync("out/version.json", JSON.stringify({ build }) + "\n");
console.log(`version.json: ${build}`);
