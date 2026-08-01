import type { MetadataRoute } from "next";

/**
 * Paths here are not rewritten by `basePath` — the manifest is generated data,
 * not JSX — so the prefix has to be applied by hand or the installed PWA will
 * launch into a 404 and show no icon.
 */
// Metadata routes are treated as route handlers, which `output: export` refuses
// to build unless they are explicitly static. The base path is inlined at build
// time, so there is nothing dynamic here.
export const dynamic = "force-static";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cue",
    short_name: "Cue",
    description: "Personal flashcard study app",
    start_url: `${basePath}/dashboard/`,
    scope: `${basePath}/`,
    display: "standalone",
    background_color: "#130823",
    theme_color: "#130823",
    icons: [
      {
        src: `${basePath}/icon-192x192.png`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: `${basePath}/icon-512x512.png`,
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
