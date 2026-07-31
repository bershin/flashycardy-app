import type { NextConfig } from "next";

/**
 * GitHub Pages serves this repo at `https://<user>.github.io/flashycardy-app/`,
 * so every asset and route needs that prefix. Set `NEXT_PUBLIC_BASE_PATH=""`
 * when building for a custom domain or a `<user>.github.io` repo, where the site
 * lives at the domain root.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/flashycardy-app";

const nextConfig: NextConfig = {
  // No server: `next build` emits a plain `out/` directory of static files.
  output: "export",
  basePath,
  assetPrefix: basePath,
  // Pages resolves `/deck/` to `/deck/index.html`; without this, routes 404.
  trailingSlash: true,
  // The image optimizer needs a server, and `next/image` isn't used anyway.
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },

  // The security headers that used to live here were dropped: a static export
  // emits no server, so Next cannot set response headers. GitHub Pages sends
  // its own `X-Content-Type-Options: nosniff` and always serves over HTTPS.
};

export default nextConfig;
