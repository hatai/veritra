import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

// TanStack Start + Nitro (Cloudflare Workers module preset).
// This config is built by plain `vite build` (NOT vite-plus). The root
// vite.config.ts remains the vite-plus (`vp`) test/lint config.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    nitro({ preset: "cloudflare_module" }),
    tanstackStart(),
    viteReact(),
  ],
});
