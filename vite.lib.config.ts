import { defineConfig } from "vite"

/**
 * Plain-JS bundle for embedding (webOS and other non-React pages).
 *
 *   dist/ai-orb.js   classic script, exposes a global `AIOrb`
 *   dist/ai-orb.mjs  ES module
 *
 * No React: the entry is src/vanilla.ts. Targets ES2015 so older TV Chromium
 * builds (no ES modules, no optional chaining or object spread) can run the
 * classic script.
 */
export default defineConfig({
  root: ".",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2015",
    sourcemap: true,
    lib: {
      entry: "src/vanilla.ts",
      name: "AIOrb",
      formats: ["iife", "es"],
      fileName: (format) => (format === "es" ? "ai-orb.mjs" : "ai-orb.js"),
    },
  },
})
