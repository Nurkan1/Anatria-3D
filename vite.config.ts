import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed port and fails if it is not available.
const DEV_PORT = 1420;

export default defineConfig({
  plugins: [react(), tailwindcss()],

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
