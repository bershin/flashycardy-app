import type { MetadataRoute } from "next";

/**
 * Paths here are not rewritten by `basePath` — the manifest is generated data,
 * not JSX — so the prefix has to be applied by hand or the installed PWA will
 * launch into a 404 and show no icon.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FlashyCardy",
    short_name: "FlashyCardy",
    description: "Personal flashcard study app",
    start_url: `${basePath}/dashboard/`,
    scope: `${basePath}/`,
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
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
