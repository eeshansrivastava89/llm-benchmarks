import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateStaticExport } from "../src/lib/export.ts";

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

await run("npm", ["run", "check"]);
await run("npm", ["test"]);
await run("npm", ["run", "build:static"], {
  STATIC_USE_EXISTING_EXPORT: "true",
  ASTRO_BASE: "/"
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

async function run(command, args, env = {}) {
  process.stdout.write(`\n$ ${[command, ...args].join(" ")}\n`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, ...env }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}
