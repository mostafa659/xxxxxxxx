import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "es2020",          // modern Android WebView: no legacy transforms → smaller + faster to parse
    cssTarget: "chrome90",
    cssMinify: true,
    sourcemap: false,
    modulePreload: false,
    chunkSizeWarningLimit: 900,
  },
});
