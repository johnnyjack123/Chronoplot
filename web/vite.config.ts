import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The shared timeline model is consumed as TypeScript source; Vite
      // compiles it with the rest of the app, so there is no build step to
      // sequence and no stale dist to get out of date.
      "@shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin in development, which is what lets the session cookie work
      // exactly as it will in production.
      "/api": { target: "http://localhost:5174", changeOrigin: false },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
