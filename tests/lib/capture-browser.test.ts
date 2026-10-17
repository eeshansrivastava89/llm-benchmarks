import { describe, expect, it } from "vitest";
import {
  isMissingPlaywrightBrowserError,
  launchWithBrowserInstall
} from "../../src/lib/capture-validation";

const logger = {
  log() {},
  warn() {}
};

function missingBrowserError(): Error {
  return new Error(
    "browserType.launch: Executable doesn't exist at " +
      "/Users/example/Library/Caches/ms-playwright/chromium_headless_shell-1243/" +
      "chrome-headless-shell-mac-arm64/chrome-headless-shell\n" +
      "Looks like Playwright was just installed or updated."
  );
}

describe("Playwright browser recovery", () => {
  it("recognizes a missing browser executable", () => {
    expect(isMissingPlaywrightBrowserError(missingBrowserError())).toBe(true);
    expect(isMissingPlaywrightBrowserError("Executable doesn't exist")).toBe(true);
    expect(
      isMissingPlaywrightBrowserError(new Error("net::ERR_CONNECTION_REFUSED"))
    ).toBe(false);
  });

  it("installs once and retries after a missing-browser launch error", async () => {
    let launches = 0;
    let installs = 0;

    const browser = await launchWithBrowserInstall(
      async () => {
        launches += 1;
        if (launches === 1) throw missingBrowserError();
        return { launched: true };
      },
      async () => {
        installs += 1;
      },
      logger
    );

    expect(browser).toEqual({ launched: true });
    expect(launches).toBe(2);
    expect(installs).toBe(1);
  });

  it("does not install for unrelated launch errors", async () => {
    let installs = 0;

    await expect(
      launchWithBrowserInstall(
        async () => {
          throw new Error("browserType.launch: Target page, context or browser has been closed");
        },
        async () => {
          installs += 1;
        },
        logger
      )
    ).rejects.toThrow("Target page");

    expect(installs).toBe(0);
  });

  it("surfaces the retry failure after installing", async () => {
    let launches = 0;
    let installs = 0;

    await expect(
      launchWithBrowserInstall(
        async () => {
          launches += 1;
          throw launches === 1 ? missingBrowserError() : new Error("launch failed after install");
        },
        async () => {
          installs += 1;
        },
        logger
      )
    ).rejects.toThrow("launch failed after install");

    expect(launches).toBe(2);
    expect(installs).toBe(1);
  });
});
