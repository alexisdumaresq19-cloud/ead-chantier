import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Native and WebAssembly packages are loaded from node_modules at run time.
  // fontkit is pdfkit's own engine, asked directly which characters a typeface has.
  serverExternalPackages: ["@hyzyla/pdfium", "sharp", "postgres", "pdfkit", "fontkit"],
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/@hyzyla/pdfium/dist/**",
      "./node_modules/@hyzyla/pdfium/package.json",
      // The worker that draws plan pages is started from its own file
      // (src/server/plans/render.ts): the bundler does not see it.
      "./src/server/plans/page-drawing.mjs",
    ],
    // What a report's PDF is drawn with, read from disk at run time
    // (src/server/reports/pdf/assets.ts). The route is /api/reports/[id]/pdf:
    // written with brackets, the key would be read as a pattern and match nothing.
    "/api/reports/*/pdf": [
      "./src/server/reports/pdf/fonts/*.ttf",
      "./public/brand/ead-logo.png",
      "./public/brand/ead-mark.png",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The app is a single-page app: its one page (the shell at "/") is served
  // for every address that is not an API route or a file, and the client
  // router (src/client/routes.tsx) takes it from there. That is what lets
  // the service worker open any screen without a network.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [{ source: "/:path*", destination: "/" }],
    };
  },
  async headers() {
    return [
      {
        // Every answer: the app shell at any address, the API, the files.
        source: "/:path*",
        headers: [
          // Only the app's own pages may show the app in a frame. A session
          // cookie is SameSite=Lax, which keeps it out of frames on other
          // sites but not out of a frame on a sister address of the same
          // domain. (Two headers: old browsers only know the second.)
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Invitation links carry their secret in the address: it is never
          // sent to another site. ("same-origin" rather than "no-referrer",
          // which would make a plain form post arrive with "Origin: null".)
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        // API answers are personal and /api/me re-sends the session cookie:
        // nothing between the server and the device may keep a copy. Set
        // here, it wins over a Cache-Control set by a route handler.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
