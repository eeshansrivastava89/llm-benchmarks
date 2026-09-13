import { describe, expect, it } from "vitest";

import { benchmarkMatchesKind } from "../../public/js/runs.js";

describe("benchmark kind filtering", () => {
  it("uses benchmark frontmatter metadata rather than benchmark IDs", () => {
    expect(
      benchmarkMatchesKind({ id: "custom-visual", kind: "visual" }, "visual")
    ).toBe(true);
    expect(
      benchmarkMatchesKind(
        { id: "custom-analysis", kind: "data-science" },
        "data-science"
      )
    ).toBe(true);
    expect(
      benchmarkMatchesKind(
        { id: "ab-test-analysis", kind: "visual" },
        "data-science"
      )
    ).toBe(false);
  });

  it("treats legacy benchmark records without kind as visual", () => {
    expect(benchmarkMatchesKind({ id: "legacy" }, "visual")).toBe(true);
    expect(benchmarkMatchesKind({ id: "legacy" }, "data-science")).toBe(false);
  });
});
