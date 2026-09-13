import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateStaticExport } from "../src/lib/export.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const benchmarkDirectory =
  process.env.STATIC_BENCHMARK_DIR ?? join(repoRoot, "benchmarks");
const runsRoot = process.env.STATIC_RUNS_ROOT ?? join(repoRoot, "runs");
const publicExportDirectory =
  process.env.STATIC_EXPORT_DIR ?? join(repoRoot, "public", "export");
const staticOutputDirectory =
  process.env.STATIC_OUTPUT_DIR ?? join(repoRoot, "dist-static");
const clientBuildDirectory =
  process.env.STATIC_CLIENT_BUILD_DIR ?? join(repoRoot, "dist", "client");
const astroBase = process.env.ASTRO_BASE ?? "/local-llm-visual-benchmark/";
const useExistingExport = process.env.STATIC_USE_EXISTING_EXPORT === "true";

const manifest = useExistingExport
  ? await readExistingExport(publicExportDirectory)
  : await generateStaticExport({
      benchmarkDirectory,
      runsRoot,
      publicExportDirectory
    });

process.stdout.write(
  `${useExistingExport ? "Using existing" : "Generated"} static export with ${manifest.benchmarks.length} benchmarks and ${manifest.runs.length} runs.\n`
);

await run("npm", ["run", "build"], repoRoot);
await rm(staticOutputDirectory, { recursive: true, force: true });
await cp(clientBuildDirectory, staticOutputDirectory, { recursive: true });
await rm(join(staticOutputDirectory, "export"), { recursive: true, force: true });
await cp(publicExportDirectory, join(staticOutputDirectory, "export"), {
  recursive: true
});
await writeFile(join(staticOutputDirectory, ".nojekyll"), "", "utf8");

process.stdout.write(`Wrote static publish build to ${staticOutputDirectory}.\n`);

async function readExistingExport(directory) {
  try {
    return JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `STATIC_USE_EXISTING_EXPORT=true requires ${join(directory, "manifest.json")} to exist.`
      );
    }

    throw error;
  }
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      env: {
        ...process.env,
        ASTRO_BASE: astroBase,
        ASTRO_OUTPUT: "static"
      }
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
