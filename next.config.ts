import type { NextConfig } from "next";

/**
 * Sub-path mount. On the VPS the site is served at
 * http://209.141.52.60/onegrainofrice behind nginx, alongside other apps that
 * already own root-level routes like /_next/. basePath namespaces every route
 * and asset under /onegrainofrice so nothing collides (next/font, next/image,
 * <Link>, and /_next chunks all get the prefix automatically).
 *
 * Set NEXT_PUBLIC_BASE_PATH="" to serve at root instead (e.g. a dedicated domain).
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/onegrainofrice";

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  // Expose the resolved basePath to components so asset() (src/lib/asset.ts)
  // can prefix image sources — next/image does NOT auto-prepend basePath to src.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: {
    // Serve images directly instead of through the optimizer. Required under a
    // basePath: the optimizer resolves local sources against the root origin
    // (/hero-grain.svg) and 404s, while direct <img> tags get the basePath
    // prefix and load fine. Placeholder memes are SVGs (the optimizer passes
    // those through unchanged anyway), so nothing of value is lost.
    unoptimized: true,
    // Kept for when real raster memes are dropped in and SVGs are served inline.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
