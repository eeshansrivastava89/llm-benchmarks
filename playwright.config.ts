import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  webServer: false,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
});
