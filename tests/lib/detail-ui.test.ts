import { describe, expect, it } from "vitest";
import { detailViewModel, renderCaptureProgress } from "../../public/js/detail-ui.js";

describe("capture progress detail UI", () => {
  it("renders the duration supplied by the capture API", () => {
    const html = renderCaptureProgress(7_000);

    expect(html).toContain("/ 7s");
    expect(html).not.toContain("20s");
  });

  it("replaces the run artifact while that run is being captured", () => {
    const detail = detailViewModel({
      runId: "run-1",
      runDirectory: "/runs/run-1",
      benchmark: { title: "Motion study" },
      model: { id: "test/model" },
      assets: { html: "index.html", preview: "preview.png" }
    }, {
      capturing: true,
      captureVideoDurationMs: 3_000
    });

    expect(detail.previewHtml).toContain("data-capture-progress");
    expect(detail.previewHtml).toContain("/ 3s");
    expect(detail.previewHtml).not.toContain("preview.png");
  });
});
