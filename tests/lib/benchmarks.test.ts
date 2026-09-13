import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadBenchmarks } from "../../src/lib/benchmarks";

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
title: Broken Benchmark
---

Missing a description.
`
    });

    await expect(loadBenchmarks(benchmarkDir)).rejects.toThrow(
      /broken\.md.*description/
    );
  });

  it("rejects duplicate benchmark IDs with a clear error", async () => {
    const benchmarkDir = await createBenchmarkDir({
      "first.md": `---
id: duplicate
title: First
description: First benchmark.
---

First prompt.
`,
      "second.md": `---
id: duplicate
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
