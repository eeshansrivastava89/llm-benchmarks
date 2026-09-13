import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadBenchmarks } from "../../src/lib/benchmarks.ts";

async function createBenchmarkDir(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "llm-benchmarks-"));

  await Promise.all(
    Object.entries(files).map(([name, contents]) =>
      writeFile(join(dir, name), contents, "utf8")
    )
  );

  return dir;
}

describe("loadBenchmarks", () => {
  it("loads benchmark markdown records from a configurable directory", async () => {
    const benchmarkDir = await createBenchmarkDir({
      "sakura.md": `---
id: sakura
kind: visual
title: Sakura Tree
description: Dreamy cherry blossom animation.
---

Animate a cherry blossom tree.
`
    });

    const benchmarks = await loadBenchmarks(benchmarkDir);

    expect(benchmarks).toEqual([
      {
        id: "sakura",
        kind: "visual",
        title: "Sakura Tree",
        description: "Dreamy cherry blossom animation.",
        prompt: "Animate a cherry blossom tree.",
        sourcePath: join(benchmarkDir, "sakura.md")
      }
    ]);
  });

  it("rejects missing frontmatter fields with a clear error", async () => {
    const benchmarkDir = await createBenchmarkDir({
      "broken.md": `---
id: broken
kind: visual
title: Broken Benchmark
---

Missing a description.
`
    });

    await expect(loadBenchmarks(benchmarkDir)).rejects.toThrow(
      /broken\.md.*description/
    );
  });

  it("rejects missing and invalid benchmark kinds", async () => {
    const missingKindDir = await createBenchmarkDir({
      "missing-kind.md": `---
id: missing-kind
title: Missing Kind
description: Missing kind.
---

Prompt.
`
    });
    const invalidKindDir = await createBenchmarkDir({
      "invalid-kind.md": `---
id: invalid-kind
kind: image
 title: Invalid Kind
description: Invalid kind.
---

Prompt.
`
    });

    await expect(loadBenchmarks(missingKindDir)).rejects.toThrow(
      /missing-kind\.md.*kind/
    );
    await expect(loadBenchmarks(invalidKindDir)).rejects.toThrow(
      /invalid-kind\.md.*expected "visual" or "data-science"/
    );
  });

  it("rejects duplicate benchmark IDs with a clear error", async () => {
    const benchmarkDir = await createBenchmarkDir({
      "first.md": `---
id: duplicate
kind: visual
title: First
description: First benchmark.
---

First prompt.
`,
      "second.md": `---
id: duplicate
kind: visual
title: Second
description: Second benchmark.
---

Second prompt.
`
    });

    await expect(loadBenchmarks(benchmarkDir)).rejects.toThrow(
      /duplicate benchmark id "duplicate".*first\.md.*second\.md/i
    );
  });
});
