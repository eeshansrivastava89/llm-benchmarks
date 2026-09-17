import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateStaticExport } from "../src/lib/export.ts";
import { run } from "./run.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const publicExportDirectory = join(repoRoot, "public", "export");

const beforeCount = await readExportRunCount(publicExportDirectory);
const manifest = await generateStaticExport({ publicExportDirectory });
const afterCount = manifest.runs.length;

process.stdout.write(
  [
    "Prepared public benchmark export.",
    `Public export runs: ${beforeCount ?? "missing"} → ${afterCount}`,
    `Benchmarks: ${manifest.benchmarks.length}`,
    ""
  ].join("\n")
);

await run("npm", ["run", "check"], { cwd: repoRoot });
await run("npm", ["test"], { cwd: repoRoot });
await run("npm", ["run", "build:static"], {
  cwd: repoRoot,
  env: {
    STATIC_USE_EXISTING_EXPORT: "true",
    ASTRO_BASE: "/"
  }
});

process.stdout.write("\nPublish check complete. Commit public/export with your changes.\n");

async function readExportRunCount(directory) {
  try {
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    return Array.isArray(manifest.runs) ? manifest.runs.length : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
