import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateStaticExport } from "../src/lib/export.ts";
import { auditStaticBuild } from "./audit-static-build.mjs";
import { run } from "./run.mjs";

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
const astroBase = process.env.ASTRO_BASE ?? "/";
const useExistingExport = process.env.STATIC_USE_EXISTING_EXPORT !== "false";

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

await run("npm", ["run", "build"], {
  cwd: repoRoot,
  env: {
    ASTRO_BASE: astroBase,
    ASTRO_OUTPUT: "static"
  }
});
await rm(staticOutputDirectory, { recursive: true, force: true });
await cp(clientBuildDirectory, staticOutputDirectory, { recursive: true });
await rm(join(staticOutputDirectory, "export"), { recursive: true, force: true });
await cp(publicExportDirectory, join(staticOutputDirectory, "export"), {
  recursive: true
});
await writeFile(join(staticOutputDirectory, ".nojekyll"), "", "utf8");
const audit = await auditStaticBuild(staticOutputDirectory);

process.stdout.write(`Wrote static publish build to ${staticOutputDirectory}.\n`);
process.stdout.write(`Static build privacy audit passed for ${audit.filesChecked} files.\n`);

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
