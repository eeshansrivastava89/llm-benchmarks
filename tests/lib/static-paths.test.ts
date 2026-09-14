import { describe, expect, it } from "vitest";
import { staticExportUrl } from "../../public/js/api.js";

describe("static export URL helpers", () => {
  it("resolves manifest and asset URLs under the Astro base path", () => {
    expect(staticExportUrl("export/manifest.json", "/llm-benchmarks/"))
      .toBe("/llm-benchmarks/export/manifest.json");
    expect(staticExportUrl("export/runs/sakura/model/preview.png", "/llm-benchmarks/"))
      .toBe("/llm-benchmarks/export/runs/sakura/model/preview.png");
  });

  it("normalizes missing slashes without falling back to the domain root", () => {
    expect(staticExportUrl("/export/manifest.json", "llm-benchmarks"))
      .toBe("/llm-benchmarks/export/manifest.json");
    expect(staticExportUrl("export/manifest.json", "/"))
      .toBe("/export/manifest.json");
  });
});
