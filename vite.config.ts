import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed port and fails if it is not available.
const DEV_PORT = 1420;

/**
 * The version the interface shows, baked in at build time.
 *
 * Read from package.json rather than declared here, because a version typed in
 * a second place is a version that will disagree with the first one. Five files
 * already carry it and `tools/check-version.mjs` gates them, so this is not a
 * sixth source — it is the first of them, quoted.
 *
 * Baked rather than asked of Tauri at runtime for two reasons: the exported
 * plate draws its footer synchronously onto a canvas, and the interface runs in
 * a plain browser under test where no Tauri API exists. The build stamping the
 * installer is the same build that runs this, so the two cannot drift.
 */
const APP_VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
).version;

export default defineConfig({
  plugins: [react(), tailwindcss()],

  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    // Required under pnpm's strict node_modules layout. @react-three/fiber and
    // @react-three/drei each resolve their own React copy from their own
    // directory, and two React instances in one app means every hook throws
    // "Invalid hook call". `three` is deduped for the same reason — two copies
    // would make `instanceof THREE.Mesh` checks silently fail.
    dedupe: ["react", "react-dom", "three"],
  },

  // Tauri serves the frontend from a dev server in development and from
  // bundled assets in production. `clearScreen: false` keeps Rust compiler
  // output visible alongside Vite's.
  clearScreen: false,
  server: {
    port: DEV_PORT,
    strictPort: true,
    watch: {
      // Rust and Python sources are rebuilt by their own toolchains.
      ignored: ["**/src-tauri/**", "**/engine/**"],
    },
  },

  build: {
    // Matches the WebView2 / WKWebView baseline Tauri v2 targets.
    target: "es2022",
    sourcemap: true,
  },
});
