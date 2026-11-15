import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["icons/*.png"],
      manifest: {
        name: "Farkle",
        short_name: "Farkle",
        description: "Roll, risk it, bank it. Pass-and-play Farkle for the whole table.",
        display: "standalone",
        orientation: "portrait",
        background_color: "#FAF5F0",
        theme_color: "#FAF5F0",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/\/classic\//, /\/v2\/assets\//],
        cleanupOutdatedCaches: true,
        // A waiting worker used to sit behind the update banner until someone
        // tapped Refresh, which left clients on an old build indefinitely.
        // Take control at once and let the app decide when to reload.
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
