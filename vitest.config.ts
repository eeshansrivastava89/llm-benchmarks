import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/lib/**/*.test.ts", "tests/server/**/*.test.ts", "tests/scripts/**/*.test.ts"]
  }
});
