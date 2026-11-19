import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Native and WebAssembly packages are loaded from node_modules at run time.
  serverExternalPackages: ["@hyzyla/pdfium", "sharp", "postgres"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@hyzyla/pdfium/dist/**"],
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
