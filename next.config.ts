import type { NextConfig } from "next";

/**
 * The site is served from the root of its own domain (card.bjohn.online), so no
 * path prefix is needed. Set `NEXT_PUBLIC_BASE_PATH=/some-repo` to build for a
 * project Pages URL instead, where the site lives under a subpath and every
 * asset and route has to carry it.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

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
