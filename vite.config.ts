import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Booth Mode is offline-existential: a fair has no signal (plan.md §4). The
// service worker precaches the whole build so a reload mid-fair loads from
// cache instead of a white screen — the plan's #1 risk (§12, "device dies
// mid-fair"). autoUpdate swaps in a new build silently on the next visit.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "index.html",
        // Nothing here reaches the network at runtime; don't cache-bust on it.
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: "Booth Mode",
        short_name: "Booth Mode",
        description: "App de feria: inventario, venta rápida y corte de caja, sin conexión.",
        lang: "es",
        dir: "ltr",
        start_url: "/",
        id: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0e0f13",
        theme_color: "#d9a441",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
  // `vite preview` serves the built dist — the only mode where the service
  // worker is active (PWA is disabled in dev). Honour PORT so it can be placed.
  preview: {
    port: Number(process.env.PORT) || 4173,
    strictPort: false,
  },
  // Unit tests only. The Playwright e2e specs live in ./e2e and are run by
  // `npm run e2e`, not vitest.
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
