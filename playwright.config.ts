import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000/api/benchmarks",
    reuseExistingServer: !process.env.CI,
    env: {
      BENCH_INSPECT_VIEWER_PORT: "7575",
      BENCH_VISUAL_VIEWER_PORT: "4321",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
});
