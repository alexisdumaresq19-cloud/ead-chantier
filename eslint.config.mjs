import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Images come from storage (plan tiles, photos) and must also load from
    // the offline cache, so they are plain <img>, not next/image.
    // The app is a single-page app drawn by src/client: a full page load is
    // how it restarts on purpose (signing in or out).
    rules: {
      "@next/next/no-img-element": "off",
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local data and scratch scripts, never committed.
    ".data/**",
  ]),
]);

export default eslintConfig;
