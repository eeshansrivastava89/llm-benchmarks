import { expect, test, type Page } from "@playwright/test";

const benchmarks = [
  {
    id: "sakura",
    title: "Sakura Particle Field",
    description: "Animated sakura scene",
    prompt: "Create a sakura animation with layered petals."
  },
  {
    id: "solar-system",
    title: "Solar System Orrery",
    description: "Interactive orbital scene",
    prompt: "Create a solar system visualization."
  }
];

const models = [
  {
    id: "google/gemma-4-e4b",
    localPath: "/Users/test/.lmstudio/models/lmstudio-community/gemma-4-E4B-it-GGUF/gemma-4-E4B-it-Q8_0.gguf"
  },
  {
    id: "local/qwen2.5-vl",
    localPath: "/Users/test/.lmstudio/models/local/qwen2.5-vl/model.gguf"
  }
];

const sampleMachineProfile = {
  collectedAt: "2026-05-06T19:12:00.000Z",
  platform: {
    node: "v26.0.0",
    platform: "darwin",
    arch: "arm64"
  },
  os: {
    type: "Darwin",
    release: "25.0.0",
    hostname: "sidequest-mac",
    uptimeSeconds: 12345
  },
  hardware: {
    machineName: "MacBook Pro",
    machineModel: "Mac16,7",
    chipType: "Apple M4 Pro",
    physicalMemory: "48 GB"
  },
  cpu: {
    model: "Apple M4 Pro",
    cores: 14,
    usagePercent: null
  },
  memory: {
    totalBytes: 51539607552,
    availableBytes: 25769803776,
    freeBytes: 8589934592,
    usedBytes: 25769803776,
    pressurePercent: 50,
    pressureLabel: "low",
    source: "macOS VM stats"
  },
  gpu: {
    available: true,
    telemetryAvailable: false,
    devices: [{
      name: "Apple M4 Pro",
      cores: "20",
      vram: undefined,
      metalSupport: "Metal 4",
      displays: ["Color LCD · 1728 x 1080 @ 120.00Hz"]
    }],
    reason: "GPU hardware detected."
  }
};

const sampleRun = {
  runId: "2026-05-06T19-12-00-000Z",
  benchmark: benchmarks[0],
  model: {
    id: models[1].id,
    slug: "local-qwen2-5-vl"
  },
  status: "completed",
  createdAt: "2026-05-06T19:12:00.000Z",
  updatedAt: "2026-05-06T19:13:00.000Z",
  runDirectory: "/tmp/runs/sakura/local-qwen2-5-vl/2026-05-06T19-12-00-000Z",
  assets: {
    metadata: "metadata.json",
    prompt: "prompt.md",
    html: "index.html",
    preview: "preview.png"
  }
};

const sampleRunWithVideo = {
  ...sampleRun,
  assets: {
    ...sampleRun.assets,
    video: "preview.webm"
  },
  capture: {
    preview: {
      status: "ready",
      path: "preview.png",
      capturedAt: "2026-05-06T19:13:00.000Z"
    },
    video: {
      status: "ready",
      path: "preview.webm",
      capturedAt: "2026-05-06T19:13:00.000Z"
    }
  }
};

const sampleUnsupportedRun = {
  runId: "2026-05-10T03-11-10-113Z",
  benchmark: {
    id: "boolq-0",
    title: "Deprecated quantitative task",
    description: "Unsupported quantitative task metadata.",
    prompt: "boolq|0"
  },
  model: {
    id: "google/gemma-4-e4b",
    slug: "google-gemma-4-e4b-bae096a7fc"
  },
  kind: "lighteval",
  runner: {
    mode: "lighteval",
    intendedRunner: "Deprecated quantitative runner",
    backendLabel: "Deprecated quantitative runner",
    baseUrl: "http://localhost:1234/v1",
    model: "google/gemma-4-e4b",
    launchCommand: "quantitative-runner boolq|0",
    commandAsset: "command.txt",
    metricSource: "Deprecated quantitative result",
    retries: 0,
    tokenMetrics: {
      reported: false
    }
  },
  status: "prepared",
  createdAt: "2026-05-10T03:11:10.113Z",
  updatedAt: "2026-05-10T03:11:10.113Z",
  runDirectory:
    "/tmp/runs/boolq-0/google-gemma-4-e4b-bae096a7fc/2026-05-10T03-11-10-113Z",
  assets: {
    metadata: "metadata.json",
    command: "command.txt"
  }
};

test("renders the visual workbench with prompt/model/table modes", async ({ page }) => {
  await mockApi(page, {});

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });

  await expect(
    page.getByRole("heading", { name: "Local LLM Visual Benchmark" })
  ).toBeVisible();
  await expect(page.getByText("Browse visual benchmark outputs by prompt, model, or table.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture media" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Setup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use dark theme" })).toBeVisible();
  await expect(page.getByRole("button", { name: "LM Studio" })).toHaveCount(0);
  await expect(page.locator(".app-header #omlxStatusPill")).toHaveCount(0);
  await expect(page.locator(".app-header #lmStudioStatusPill")).toHaveCount(0);
  const attribution = page.getByRole("link", { name: "a side quest by eeshans.com" });
  await expect(attribution).toHaveAttribute("href", "https://eeshans.com/");
  await expect(attribution).toHaveCSS("border-radius", "999px");
  await expect(page.getByLabel("Filter by model")).toBeVisible();
  await expect(page.getByLabel("Filter by prompt")).toBeVisible();
  await expect(page.getByRole("link", { name: /Gallery Visual outputs/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Runs Metadata & files/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /LightEval/i })).toHaveCount(0);
  await expect(page.locator("[data-section]")).toHaveCount(0);
  await expect(page.locator("[data-mode]")).toHaveText(["By prompt", "By model", "Table"]);
  await expect(page.getByRole("button", { name: "By prompt" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "By model" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("heading", { name: "Prompt comparison" })).toBeVisible();
  await expect(page.getByText("0 with video, 1 need capture, 0 prepared, 0 failed")).toBeVisible();
  await expect(page.locator(".run-grid")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sakura Particle Field" })).toBeVisible();
  await expect(page.locator("[data-run-id]").first()).toContainText("local/qwen2.5-vl");
  await expect(page.getByLabel("Search runs")).toBeVisible();
  await expect(page.locator("#runsFilterPanel")).toHaveCount(0);
  await page.getByLabel("Search runs").fill("no matching run");
  await expect(page.locator("[data-run-id]")).toHaveCount(0);
  await page.getByLabel("Search runs").fill("");
  await page.locator("[data-run-id]").first().click();
  await expect(page.getByRole("dialog", { name: "Run detail" })).toBeVisible();
  await expect(page.locator("#detailMeta")).toContainText("State");
  await expect(page.locator("#detailMeta")).toContainText("capture");
  await expect(page.locator("#detailArtifacts")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Capture preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open in Finder" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "By model" }).click();
  await expect(page.locator("#runsFilterPanel")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Model attempts" })).toBeVisible();
  await expect(page.getByText("0 with video, 1 need capture, 0 prepared, 0 failed")).toBeVisible();
  await expect(page.locator("[data-run-id]").first()).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("© 2025–2026 Eeshan Srivastava");
  await expect(page.getByRole("contentinfo")).toContainText("Personal project · MIT License · Non-commercial");
  await expect(page.getByRole("link", { name: "Source" })).toHaveAttribute(
    "href",
    "https://github.com/eeshansrivastava89/local-llm-visual-benchmark"
  );
  await expect(page.getByRole("link", { name: "LinkedIn" })).toHaveAttribute(
    "href",
    "https://www.linkedin.com/in/eeshans/"
  );

  await page.getByRole("button", { name: "Setup" }).click();
  const setupDialog = page.getByRole("dialog", { name: "Setup" });
  await expect(setupDialog).toBeVisible();
  await expect(setupDialog.getByRole("heading", { name: "Prepare slot" })).toHaveCount(0);
  await expect(setupDialog.getByRole("heading", { name: "Run externally" })).toHaveCount(0);
  await expect(setupDialog.getByRole("heading", { name: "Capture media" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Model sources" })).toBeVisible();
  await expect(page.getByLabel("oMLX base URL")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Model inventory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync Pi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync OpenCode" })).toBeVisible();
  await expect(page.locator("#lmConfigPi .sync-target-logo")).toBeVisible();
  await expect(page.locator("#lmConfigOpenCode .sync-target-logo")).toBeVisible();
  await expect(page.getByText("OpenCode Setup")).toHaveCount(0);
  await expect(page.getByText("Pi Setup")).toHaveCount(0);
  // Phase 2: onboarding uses data-onboarding-step, not data-step
  await expect(page.locator("[data-step]")).toHaveCount(0);
  await expect(page.getByText("Pi synced").first()).toBeVisible();
  await expect(page.getByText("OpenCode synced").first()).toBeVisible();
  await expect(page.getByText("/home/.pi/agent/models.json")).toBeVisible();
  await expect(page.locator("#availableModelChoices").getByText("oMLX").first()).toBeVisible();
  await expect(page.locator("#availableModelChoices").getByText("LM Studio").first()).toBeVisible();
  const setupColumns = await page.locator(".setup-console-layout").evaluate((el) =>
    getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  expect(setupColumns).toBe(1);
  const operationColumns = await page.locator(".lm-operations-grid").evaluate((el) =>
    getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  expect(operationColumns).toBe(4);
  const modelRowColumns = await page.locator(".lm-model-row").first().evaluate((el) =>
    getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  expect(modelRowColumns).toBe(3);

  const baseUrlBox = await page.locator("#baseUrl").boundingBox();
  const testButtonBox = await page.locator("#refreshConnection").boundingBox();
  expect(Math.abs((baseUrlBox?.height ?? 0) - (testButtonBox?.height ?? 0))).toBeLessThan(1);

  await page.locator("#refreshConnection").click();
  await expect(page.locator("#connectionMessage")).toContainText("2 models discovered");
});

test("compares selected visual runs side by side", async ({ page }) => {
  const compareRuns = [
    {
      ...sampleRunWithVideo,
      runner: {
        mode: "external",
        modelSource: "omlx",
        intendedRunner: "opencode",
        backendLabel: "oMLX"
      }
    },
    {
      ...sampleRunWithVideo,
      runId: "2026-05-06T20-12-00-000Z",
      updatedAt: "2026-05-06T20:13:00.000Z",
      runDirectory: "/tmp/runs/sakura/local-qwen2-5-vl/2026-05-06T20-12-00-000Z",
      model: {
        id: "local/qwen2.5-vl",
        slug: "local-qwen2-5-vl"
      },
      runner: {
        mode: "manual",
        modelSource: "lmstudio",
        intendedRunner: "manual",
        backendLabel: "LM Studio"
      }
    }
  ];
  const exportPayloads: unknown[] = [];
  await mockApi(page, {  runs: compareRuns, onExportComparison: (payload) => { exportPayloads.push(payload); } });

  await page.goto("/");
  await page.getByRole("button", { name: "Table" }).click();

  await expect(page.getByRole("heading", { name: "Table" })).toBeVisible();
  await expect(page.locator("#viewSubtitle")).toHaveText("Select table rows to compare visual outputs.");
  await expect(page.getByLabel("Filter by harness")).toBeVisible();
  await page.getByRole("checkbox", { name: /Compare Sakura Particle Field.*opencode/ }).check();
  await page.getByRole("checkbox", { name: /Compare Sakura Particle Field.*manual/ }).check();
  await expect(page.locator("[data-compare-run]")).toHaveCount(2);
  const selectedCompareRunsRegion = page.getByLabel("Selected compare runs");
  await expect(selectedCompareRunsRegion.getByText("local/qwen2.5-vl").first()).toBeVisible();
  await expect(selectedCompareRunsRegion.getByText("oMLX")).toBeVisible();
  await expect(selectedCompareRunsRegion.getByText("opencode")).toBeVisible();
  await expect(selectedCompareRunsRegion.getByText("LM Studio")).toBeVisible();
  await expect(selectedCompareRunsRegion.getByText("manual")).toBeVisible();
  await expect(page.locator("[data-compare-run] video")).toHaveCount(2);
  await expect(page.locator("[data-compare-run] video").first()).toHaveJSProperty("controls", false);
  await expect(page.locator("[data-compare-run] video").first()).toHaveJSProperty("loop", false);
  await expect(page.locator("[data-compare-run] video").first()).toHaveAttribute("poster", /preview\.png/);
  await expect(page.locator("[data-compare-run] video").first()).toHaveAttribute("data-loop-managed", "true");
  await expect(page.locator("[data-compare-run] video").first()).toHaveJSProperty("muted", true);
  await expect(page.getByText("2/6 selected")).toBeVisible();
  await page.getByRole("button", { name: "Export video" }).click();
  await expect(page.locator("#runSummary")).toContainText("Comparison video exported: /tmp/comparison-exports/comparison.mp4");
  expect(exportPayloads).toEqual([
    {
      runDirectories: compareRuns.map((run) => run.runDirectory)
    }
  ]);
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByText("0/6 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear selection" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Filtered prompt stack coverage" })).toHaveCount(0);
});

test("paginates the table mode at 10 records", async ({ page }) => {
  const manyRuns = Array.from({ length: 30 }, (_, index) => ({
    ...sampleRun,
    runId: `2026-05-06T20-${String(index).padStart(2, "0")}-00-000Z`,
    benchmark: index % 2 === 0 ? benchmarks[0] : benchmarks[1],
    model: index % 3 === 0
      ? { id: models[0].id, slug: "google-gemma-4-e4b" }
      : { id: models[1].id, slug: "local-qwen2-5-vl" },
    runDirectory: `/tmp/runs/page/${index}`
  }));
  await mockApi(page, {  runs: manyRuns });

  await page.goto("/");
  await page.getByRole("button", { name: "Table" }).click();
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });

  await expect(page.locator(".runs-table [data-run-id]")).toHaveCount(10);
  await expect(page.locator(".runs-pagination")).toContainText("Showing 1-10 of 30");
  await expect(page.locator(".runs-pagination")).toContainText("Page 1 of 3");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".runs-table [data-run-id]")).toHaveCount(10);
  await expect(page.locator(".runs-pagination")).toContainText("Showing 11-20 of 30");
  await expect(page.locator(".runs-pagination")).toContainText("Page 2 of 3");
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(page.locator(".runs-table [data-run-id]")).toHaveCount(10);
});

test("toggles and persists the dark theme", async ({ page }) => {
  await mockApi(page, {});

  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Use light theme" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Use light theme" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
});

test("supports prompt comparison and video-only run details", async ({ page }) => {
  let openHtmlPayload: unknown;
  let copiedText = "";
  await page.exposeFunction("recordClipboardWrite", (value: string) => {
    copiedText = String(value);
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (value: string) =>
          (window as unknown as { recordClipboardWrite: (text: string) => Promise<void> }).recordClipboardWrite(
            value
          )
      },
      configurable: true
    });
  });
  await mockApi(page, {
    
    onOpenHtml: (payload) => {
      openHtmlPayload = payload;
    },
    runs: [
      sampleRunWithVideo,
      {
        ...sampleRun,
        runId: "2026-05-06T20-12-00-000Z",
        model: {
          id: models[0].id,
          slug: "google-gemma-4-e4b"
        },
        runDirectory: "/tmp/runs/sakura/google-gemma-4-e4b/2026-05-06T20-12-00-000Z"
      }
    ]
  });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await page.getByRole("button", { name: "By prompt" }).click();

  await expect(page.locator("[data-run-id]")).toHaveCount(2);

  await page.locator("[data-run-id]").first().click();
  await expect(page.locator("#detailBackdrop[open]")).toBeVisible();
  await expect(page.locator("#detailPreview iframe")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load live preview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open HTML" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open in Finder" })).toBeVisible();
  await page.getByRole("button", { name: "Open HTML" }).click();
  await expect.poll(() => openHtmlPayload).toMatchObject({
    runDirectory: sampleRunWithVideo.runDirectory,
    asset: "index.html"
  });
  await expect(page.locator("#detailPreview video")).toHaveAttribute("src", /preview\.webm.*v=2026-05-06T19%3A13%3A00\.000Z/);
  await expect(page.getByText("Create a sakura animation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy prompt" })).toBeVisible();
  await page.getByRole("button", { name: "Copy prompt" }).click();
  await expect.poll(() => copiedText).toBe(benchmarks[0].prompt);
  await expect(page.getByRole("heading", { name: "Run folder" })).toHaveCount(0);
  await expect(page.locator("#detailBackdrop")).not.toContainText("HTML source:");
  await expect(page.locator("#detailBackdrop")).not.toContainText("Preview:");
  await expect(page.locator("#detailBackdrop")).not.toContainText("Video:");
  await expect(page.getByRole("link", { name: "Prompt file" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Raw response" })).toHaveCount(0);
  await expect(page.locator("#detailMeta")).not.toContainText("Tool");
  await expect(page.locator("#detailMeta")).not.toContainText("Error");
  await page.locator("#closeDetail").click();

  await page.locator("[data-run-id]").nth(1).click();
  await expect(page.locator("#detailPreview video")).toHaveCount(0);
  await expect(page.locator("#detailPreview img")).toHaveAttribute("src", /preview\.png.*v=2026-05-06T19%3A13%3A00\.000Z/);
  await expect(page.locator("#detailPreview")).not.toContainText("Video not captured yet");
});

test("hides unsupported non-visual runs from visual workspaces", async ({ page }) => {
  await mockApi(page, {
    
    runs: [sampleRun, sampleUnsupportedRun]
  });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await expect(page.locator("[data-run-id]")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("Deprecated quantitative task");
  await expect(page.getByRole("link", { name: /LightEval/i })).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Table" }).click();
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await expect(page.locator("[data-run-id]")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("Deprecated quantitative task");
});

test("recaptures media for the open run detail", async ({ page }) => {
  let capturePayload: unknown;
  let runsResponse: unknown[] = [sampleRunWithVideo];
  await mockApi(page, {
    
    runs: () => runsResponse,
    onCapture: (payload) => {
      capturePayload = payload;
      runsResponse = [
        {
          ...sampleRunWithVideo,
          updatedAt: "2026-05-06T20:00:00.000Z",
          capture: {
            preview: {
              status: "ready",
              path: "preview.png",
              capturedAt: "2026-05-06T20:00:00.000Z"
            },
            video: {
              status: "ready",
              path: "preview.webm",
              capturedAt: "2026-05-06T20:00:00.000Z"
            }
          }
        }
      ];
    }
  });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await page.locator("[data-run-id]").first().click();
  await expect(page.getByRole("button", { name: "Recapture media" })).toBeVisible();

  await page.getByRole("button", { name: "Recapture media" }).click();

  await expect.poll(() => capturePayload).toMatchObject({
    runDirectory: sampleRunWithVideo.runDirectory,
    force: true
  });
  await expect(page.locator("#detailPreview video")).toHaveAttribute("src", /preview\.webm.*v=2026-05-06T20%3A00%3A00\.000Z/);
  await expect(page.locator("#detailPreview video")).toHaveAttribute("poster", /preview\.png.*v=2026-05-06T20%3A00%3A00\.000Z/);
  await expect(page.getByRole("button", { name: "Recapture media" })).toBeEnabled();

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator("[data-run-id]").first()).not.toContainText("Capturing");
  await expect(page.locator("[data-run-id]").first()).toContainText("Video ready");
});

test("grouped views scroll as one surface and avoid duplicate card labels", async ({ page }) => {
  const manyRuns = Array.from({ length: 18 }, (_, index) => ({
    ...sampleRun,
    runId: `2026-05-06T20-${String(index).padStart(2, "0")}-00-000Z`,
    benchmark: index % 2 === 0 ? benchmarks[0] : benchmarks[1],
    model: index % 3 === 0
      ? { id: models[0].id, slug: "google-gemma-4-e4b" }
      : { id: models[1].id, slug: "local-qwen2-5-vl" },
    runDirectory: `/tmp/runs/${index}`
  }));
  await mockApi(page, {  runs: manyRuns });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });

  await page.getByRole("button", { name: "By prompt" }).click();
  await expect(page.locator("#runsSurface")).toHaveCSS("overflow-y", "visible");
  await expect(page.locator("#runsSurface")).toHaveCSS("scrollbar-width", "none");
  await expect(page.locator(".grouped-runs")).toBeVisible();
  const promptGroup = page.locator(".group").filter({ hasText: benchmarks[0].title }).first();
  const promptCard = promptGroup.locator("[data-run-id]").first();
  await expect(promptCard).not.toContainText(benchmarks[0].title);
  await expect(promptCard).toContainText(/google\/gemma-4-e4b|local\/qwen2\.5-vl/);

  await page.getByRole("button", { name: "By model" }).click();
  const modelGroup = page.locator(".group").filter({ hasText: models[0].id }).first();
  const modelCard = modelGroup.locator("[data-run-id]").first();
  await expect(modelCard).not.toContainText(models[0].id);
  await expect(modelCard).toContainText(/Sakura Particle Field|Solar System Orrery/);
});

test("uses dense Sidequests-style gallery geometry on desktop", async ({ page }) => {
  const manyRuns = Array.from({ length: 9 }, (_, index) => ({
    ...sampleRunWithVideo,
    runId: `2026-05-06T21-${String(index).padStart(2, "0")}-00-000Z`,
    benchmark: index % 2 === 0 ? benchmarks[0] : benchmarks[1],
    model: index % 3 === 0
      ? { id: models[0].id, slug: "google-gemma-4-e4b" }
      : { id: models[1].id, slug: "local-qwen2-5-vl" },
    runDirectory: `/tmp/runs/dense/${index}`
  }));
  await mockApi(page, {  runs: manyRuns });
  await page.setViewportSize({ width: 1600, height: 900 });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await page.getByRole("button", { name: "By prompt" }).click();

  const galleryColumns = await page.locator(".run-grid").first().evaluate((el) =>
    getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  expect(galleryColumns).toBe(4);

  const summaryBox = await page.locator(".gallery-summary").boundingBox();
  expect(summaryBox?.height ?? Infinity).toBeLessThanOrEqual(52);

  const firstCardBox = await page.locator("[data-run-id]").first().boundingBox();
  expect(firstCardBox?.height ?? Infinity).toBeLessThanOrEqual(292);

  await page.getByRole("button", { name: "By model" }).click();

  const groupHeadBox = await page.locator(".group-head").first().boundingBox();
  expect(groupHeadBox?.height ?? Infinity).toBeLessThanOrEqual(48);

  const groupedColumns = await page.locator(".group .run-grid").first().evaluate((el) =>
    getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length
  );
  expect(groupedColumns).toBe(4);
});

test("scrolls grouped views from the page margins instead of trapping the grid", async ({ page }) => {
  const manyRuns = Array.from({ length: 30 }, (_, index) => ({
    ...sampleRunWithVideo,
    runId: `2026-05-06T22-${String(index).padStart(2, "0")}-00-000Z`,
    benchmark: index % 2 === 0 ? benchmarks[0] : benchmarks[1],
    model: index % 3 === 0
      ? { id: models[0].id, slug: "google-gemma-4-e4b" }
      : { id: models[1].id, slug: "local-qwen2-5-vl" },
    runDirectory: `/tmp/runs/group-scroll/${index}`
  }));
  await mockApi(page, {  runs: manyRuns });
  await page.setViewportSize({ width: 1600, height: 900 });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await page.getByRole("button", { name: "By model" }).click();

  await expect(page.locator("#runsSurface")).toHaveCSS("overflow-y", "visible");

  const beforePageScroll = await page.evaluate(() => window.scrollY);
  await page.mouse.move(1260, 420);
  await page.mouse.wheel(0, 650);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforePageScroll);
});

test("captures missing run media with per-card progress", async ({ page }) => {
  let captureCalled = false;
  let releaseCapture: () => void = () => {};
  const captureMayFinish = new Promise<void>((resolve) => {
    releaseCapture = resolve;
  });
  let runsResponse: unknown[] = [sampleRun];
  await mockApi(page, {
    
    runs: () => runsResponse,
    onCapture: async (payload) => {
      expect(payload).toMatchObject({ runDirectory: sampleRun.runDirectory });
      captureCalled = true;
      await captureMayFinish;
      runsResponse = [sampleRunWithVideo];
    }
  });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await expect(page.locator("[data-run-id]").first()).toContainText("Needs media capture");

  await page.getByRole("button", { name: /Capture preview for Sakura Particle Field/ }).click();

  await expect.poll(() => captureCalled).toBe(true);
  await expect(page.locator("[data-run-id]").first()).toContainText("Capturing");

  releaseCapture();
  await expect(page.locator("[data-run-id]").first()).toContainText("Video ready");
});

test("auto-detects newly saved HTML and starts capture from the toast", async ({ page }) => {
  let capturePayload: unknown;
  let runsResponse: unknown[] = [
    {
      ...sampleRun,
      status: "prepared",
      assets: {
        metadata: "metadata.json",
        prompt: "prompt.md"
      }
    }
  ];

  await page.addInitScript(() => {
    const realSetInterval = window.setInterval;
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      realSetInterval(handler, timeout === 8000 ? 50 : timeout, ...args)) as typeof window.setInterval;
  });

  await mockApi(page, {
    
    runs: () => runsResponse,
    onCapture: (payload) => {
      capturePayload = payload;
      runsResponse = [sampleRunWithVideo];
    }
  });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await expect(page.locator("[data-run-id]").first()).toContainText("Waiting for index.html source");

  runsResponse = [
    {
      ...sampleRun,
      status: "prepared",
      assets: {
        metadata: "metadata.json",
        prompt: "prompt.md",
        html: "index.html"
      }
    }
  ];

  await expect(page.locator(".html-detect-toast")).toContainText("1 run has index.html ready.");
  await page.getByRole("button", { name: "Capture now" }).click();

  await expect.poll(() => capturePayload).toMatchObject({
    runDirectory: sampleRun.runDirectory
  });
});

test("shows capture quality failures instead of hiding them behind capture prompts", async ({ page }) => {
  await mockApi(page, {
    
    runs: [
      {
        ...sampleRun,
        status: "failed",
        error: {
          message: "Captured animation rendered too slowly: 3.0 FPS at 1280x720."
        },
        capture: {
          preview: {
            status: "ready",
            path: "preview.png",
            capturedAt: "2026-05-06T20:00:00.000Z"
          },
          video: {
            status: "failed",
            path: "preview.webm",
            capturedAt: "2026-05-06T20:00:00.000Z",
            error: {
              message: "Captured animation rendered too slowly: 3.0 FPS at 1280x720."
            }
          }
        }
      }
    ]
  });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });

  await expect(page.locator("[data-run-id]").first()).toContainText("failed");
  await expect(page.locator("[data-run-id]").first()).toContainText("Captured animation rendered too slowly");
  await expect(page.locator("[data-run-id]").first()).not.toContainText("Needs media capture");
});

test("refresh reloads prompt files and saved runs", async ({ page }) => {
  let benchmarkResponse = benchmarks;
  let runsResponse: unknown[] = [sampleRun];
  await mockApi(page, {
    
    benchmarks: () => benchmarkResponse,
    runs: () => runsResponse
  });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await expect(page.getByLabel("Filter by prompt")).not.toContainText("New Prompt");

  benchmarkResponse = [
    ...benchmarks,
    {
      id: "new-prompt",
      title: "New Prompt",
      description: "Added while app is open",
      prompt: "Draw a new scene."
    }
  ];
  runsResponse = [];

  await page.getByRole("button", { name: "Refresh" }).click();

  await expect(page.getByLabel("Filter by prompt")).toContainText("New Prompt");
  await expect(page.locator("[data-run-id]")).toHaveCount(0);
});

test("deletes a run folder from the visual detail after confirmation", async ({ page }) => {
  let deletePayload: unknown;
  await mockApi(page, {
    
    onDelete: (payload) => {
      deletePayload = payload;
    }
  });

  let nativeDialogOpened = false;
  page.on("dialog", async (dialog) => {
    nativeDialogOpened = true;
    await dialog.dismiss();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Table" }).click();
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await page.locator("[data-run-id]").first().click();
  await expect(page.getByRole("dialog", { name: "Run detail" })).toBeVisible();
  await page.getByRole("button", { name: "Delete run" }).click();

  await expect(page.getByRole("dialog", { name: "Delete run" })).toBeVisible();
  await expect(page.locator("#deleteRunPath")).toContainText(sampleRun.runDirectory);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await page.getByRole("button", { name: "Delete folder" }).click();

  await expect.poll(() => deletePayload).toMatchObject({
    runDirectory: sampleRun.runDirectory
  });
  expect(nativeDialogOpened).toBe(false);
});

test("keeps the viewer usable on mobile widths", async ({ page }) => {
  await mockApi(page, { runs: [] });
  await page.setViewportSize({ width: 390, height: 900 });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000, state: "detached" });

  await expect(page.getByRole("button", { name: "Prepare run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Setup" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
});

test("keeps visual detail prompt usable on mobile widths", async ({ page }) => {
  const longPrompt = Array.from({ length: 24 }, (_item, index) =>
    `Prompt instruction ${index + 1}: Create a sakura animation with layered petals and keep the full tree visible.`
  ).join("\n");
  const mobileRun = {
    ...sampleRunWithVideo,
    benchmark: {
      ...sampleRunWithVideo.benchmark,
      prompt: longPrompt
    }
  };
  await mockApi(page, {  runs: [mobileRun] });
  await page.setViewportSize({ width: 390, height: 900 });

  await page.goto("/");
  await page.waitForSelector("[data-run-id]", { timeout: 5000 });
  await expect(page.locator("#onboardingPanel")).toBeHidden();

  await page.locator("[data-run-id]").first().click();
  const detailDialog = page.locator("#detailBackdrop[open]");
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.getByRole("heading", { name: "Prompt", exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("heading", { name: "Run folder" })).toHaveCount(0);

  const promptScrolls = await page.locator("#detailPrompt").evaluate((element) =>
    element.scrollHeight > element.clientHeight
  );
  expect(promptScrolls).toBe(true);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(overflow).toBe(false);
});

test("hides operational chrome when writes are disabled", async ({ page }) => {
  await mockApi(page, {  writesEnabled: false });

  await page.goto("/");
  await expect(page.locator("[data-run-id]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Setup" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Capture media" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  await expect(page.locator("#statsPill")).toBeVisible();
  await expect(page.locator("#statsPill")).toContainText("M4 Pro");
  await expect(page.getByRole("button", { name: "Use dark theme" })).toBeVisible();
  await expect(page.locator("#themeLabel")).toHaveClass(/sr-only/);

  await page.locator("[data-run-id]").first().click();
  await expect(page.getByRole("button", { name: "Open HTML" })).toHaveCount(0);
});

test("falls back to exported static data without prepare controls", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "API unavailable in static publish"
        }
      })
    });
  });
  await page.route("**/export/manifest.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        generatedAt: "2026-05-06T20:00:00.000Z",
        benchmarks,
        machineProfile: sampleMachineProfile,
        runs: [
          {
            ...sampleRunWithVideo,
            runDirectory:
              "export/runs/sakura/local-qwen2-5-vl/2026-05-06T19-12-00-000Z",
            assets: {
              metadata: "metadata.json",
              preview: "preview.png",
              video: "preview.webm"
            }
          }
        ]
      })
    });
  });
  await page.route("**/export/runs/**/preview.png", async (route) => {
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axwP18AAAAASUVORK5CYII=",
        "base64"
      )
    });
  });
  await page.route("**/export/runs/**/preview.webm", async (route) => {
    await route.fulfill({
      contentType: "video/webm",
      body: Buffer.from([])
    });
  });

  await page.goto("/");
  await expect(page.locator("body.public-page")).toHaveCount(0);
  await expect(page.locator(".public-header")).toHaveCount(0);
  await expect(page.locator("[data-mode]")).toHaveText(["By prompt", "By model", "Table"]);
  await expect(page.getByRole("heading", { name: "Prompt comparison" })).toBeVisible();
  await expect(page.locator("#onboardingPanel")).toBeHidden();
  await expect(page.getByRole("button", { name: "Prepare run" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Setup" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Capture media" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  await expect(page.locator("#statsPill")).toBeVisible();
  await expect(page.locator("#statsPill")).toContainText("M4 Pro");
  await expect(page.getByRole("button", { name: "Use dark theme" })).toBeVisible();
  await expect(page.locator("#themeLabel")).toHaveClass(/sr-only/);
  await expect(page.locator("[data-run-id]").first()).toBeVisible();

  await page.locator("[data-run-id]").first().click();
  await expect(page.getByRole("dialog", { name: "Run detail" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recapture media" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Capture media" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load live preview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open HTML" })).toHaveCount(0);
  await expect(page.locator("#detailPreview video")).toHaveAttribute("src", /preview\.webm.*v=2026-05-06T19%3A13%3A00\.000Z/);
});

async function mockApi(
  page: Page,
  options: {
    benchmarks?: () => typeof benchmarks;
    runs?: unknown[] | (() => unknown[]);
    onDelete?: (payload: unknown) => void;
    onCapture?: (payload: unknown) => void | Promise<void>;
    onOpenHtml?: (payload: unknown) => void | Promise<void>;
    onExportComparison?: (payload: unknown) => void | Promise<void>;
    writesEnabled?: boolean;
  }
): Promise<void> {
  await page.route("**/api/benchmarks", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ benchmarks: options.benchmarks?.() ?? benchmarks })
    });
  });

  await page.route("**/api/system-stats", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ stats: sampleMachineProfile })
    });
  });

  await page.route("**/api/runs", async (route) => {
    if (route.request().method() === "DELETE") {
      const payload = route.request().postDataJSON();
      options.onDelete?.(payload);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ deleted: true, runDirectory: payload.runDirectory })
      });
      return;
    }

    const runs = typeof options.runs === "function" ? options.runs() : options.runs;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ runs: runs ?? [sampleRun] })
    });
  });



  await page.route("**/api/capture-media", async (route) => {
    const payload = route.request().postDataJSON();
    await options.onCapture?.(payload);
    const runs = typeof options.runs === "function" ? options.runs() : options.runs;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ captured: 1, skipped: 0, failed: 0, runs: runs ?? [sampleRunWithVideo] })
    });
  });

  await page.route("**/api/open-html", async (route) => {
    const payload = route.request().postDataJSON();
    await options.onOpenHtml?.(payload);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        opened: true,
        path: payload.runDirectory + "/" + payload.asset
      })
    });
  });

  await page.route("**/api/open-run-folder", async (route) => {
    const payload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        opened: true,
        path: payload.runDirectory
      })
    });
  });

  await page.route("**/api/export-comparison-video", async (route) => {
    const payload = route.request().postDataJSON();
    await options.onExportComparison?.(payload);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "/tmp/comparison-exports/comparison.mp4",
        runCount: payload.runDirectories?.length ?? 0,
        layout: "2x2"
      })
    });
  });

}

// --- Data-science run E2E tests ---

const dsBenchmark = {
  id: "ab-test-analysis",
  title: "A/B Test Production Analysis",
  description: "Run a production A/B test analysis.",
  prompt: "Analyze the A/B test data from Supabase."
};

const dsRun = {
  kind: "data-science",
  runId: "2026-05-26T01-02-03-004Z",
  benchmark: dsBenchmark,
  model: { id: "qwen3-30b-a3b", slug: "qwen3-30b-a3b" },
  status: "completed",
  createdAt: "2026-05-26T01:02:03.004Z",
  updatedAt: "2026-05-26T01:02:03.004Z",
  runDirectory: "/runs/ab-test-analysis/qwen3-30b-a3b/2026-05-26T01-02-03-004Z",
  assets: {
    metadata: "metadata.json",
    prompt: "prompt.md",
    ds: {
      summary: "summary.json",
      chartTreatmentEffect: "chart-treatment-effect.png",
      chartDistribution: "chart-distribution.png",
      chartCompletionRates: "chart-completion-rates.png"
    }
  },
  dsSummary: {
    status: "significant",
    recommended_variant: "A",
    decision: "Variant B has significant guardrail drops; ship A.",
    metrics: [
      { label: "Completion Time", value: "+3.2s", delta: "+55.5%", delta_direction: "up", context: "p=0.001" },
      { label: "Effect Size", value: "d=0.40", context: "small" }
    ]
  }
};

test.describe("data-science runs", () => {
  test("data-science run shows chart triptych and verdict pill in detail", async ({ page }) => {
    await page.route("**/api/runs", (route) =>
      route.fulfill({ json: { runs: [dsRun] } })
    );
    await page.route("**/api/benchmarks", (route) =>
      route.fulfill({ json: { benchmarks: [dsBenchmark] } })
    );
    await page.goto("/");

    // Switch to Data Science tab so the DS run is visible
    await page.getByRole("button", { name: "Data Science" }).click();

    // Click the run card to open detail
    const card = page.locator("[data-open-run]").first();
    await card.click();

    // Chart triptych containers should exist
    await expect(page.locator(".ds-triptych")).toBeVisible();
    await expect(page.locator(".ds-chart-full")).toBeVisible();
    await expect(page.locator(".ds-chart-pair")).toBeVisible();

    // Metrics ribbon with verdict pill should render
    await expect(page.locator(".ds-ribbon")).toBeVisible();
    await expect(page.locator(".verdict-pill[data-verdict='danger']")).toContainText("Ship A");

    // Metric chips should show
    await expect(page.locator(".ds-chip").first()).toContainText("Completion Time");
  });

  test("data-science card shows analysis status in workbench", async ({ page }) => {
    await page.route("**/api/runs", (route) =>
      route.fulfill({ json: { runs: [dsRun] } })
    );
    await page.route("**/api/benchmarks", (route) =>
      route.fulfill({ json: { benchmarks: [dsBenchmark] } })
    );
    await page.goto("/");

    // Switch to Data Science tab so the DS run is visible
    await page.getByRole("button", { name: "Data Science" }).click();

    // Card should show data-science messaging
    await expect(page.locator(".run-card").first()).toBeVisible();
    await expect(page.locator("text=3 charts · summary ready")).toBeVisible();
  });
});
