import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: process.env.ASTRO_OUTPUT ?? "server",
  base: process.env.ASTRO_BASE ?? "/",
  devToolbar: {
    enabled: false
  },
  adapter: node({
    mode: "standalone"
  }),
  vite: {
    plugins: [tailwindcss()]
  }
});
