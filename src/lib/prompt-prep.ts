import { mkdir, writeFile } from "node:fs/promises";

import { modelSourceLabel } from "./backend-labels.ts";
import { buildRunPaths, createRunId } from "./paths.ts";
import { writePromptMarkdown, writeRunMetadata } from "./runs.ts";
import type {
  BenchmarkRecord,
  ModelSourceId,
  PreparedRun,
  RunAssets,
  RunKind,
  RunMetadata,
} from "./types.ts";

export interface DataScienceAccess {
  baseUrl: string;
  anonKey: string;
}

export interface PrepareRunInput {
  benchmark: BenchmarkRecord;
  modelId: string;
  modelSource?: ModelSourceId;
  kind?: RunKind;
  baseUrl?: string;
  backendLabel?: string;
  runsRoot?: string;
  now?: Date;
  dataScienceAccess?: DataScienceAccess;
}

export async function prepareRun(input: PrepareRunInput): Promise<PreparedRun> {
  const now = input.now ?? new Date();
  const kind = resolveRunKind(input);
  const dataScienceAccess = kind === "data-science"
    ? validateDataScienceAccess(input.dataScienceAccess)
    : undefined;
  const paths = buildRunPaths({
    runsRoot: input.runsRoot,
    benchmarkId: input.benchmark.id,
    modelId: input.modelId,
    runId: createRunId(now),
  });
  const prompt = input.benchmark.prompt.trim();
  const timestamp = now.toISOString();
  const modelSource = input.modelSource;
  const backendLabel = modelSource
    ? modelSourceLabel(modelSource, input.backendLabel)
    : undefined;
  const run: RunMetadata = {
    schemaVersion: 1,
    kind,
    runId: paths.runId,
    benchmark: input.benchmark,
    model: {
      id: input.modelId,
      slug: paths.modelSlug,
    },
    status: "prepared",
    createdAt: timestamp,
    updatedAt: timestamp,
    preparedAt: timestamp,
    runDirectory: paths.runDirectory,
    assets: buildRunAssets(kind),
    // Every prepared run is a Pi run; other harness labels exist only in
    // historical metadata and stay display-only.
    runner: {
      mode: "external",
      ...(modelSource ? { modelSource } : {}),
      intendedRunner: "Pi",
      backendLabel,
      baseUrl: normalizeOptionalString(input.baseUrl),
      model: input.modelId,
      retries: 0,
      tokenMetrics: {
        reported: false,
      },
    },
    tool: "pi",
  };

  await mkdir(paths.runDirectory, { recursive: true });

  const writes: Promise<unknown>[] = [writeRunMetadata(paths, run)];
  if (dataScienceAccess) {
    writes.push(writeSupabaseConfig(paths.supabaseConfigPath, dataScienceAccess));
  }
  if (prompt) {
    writes.push(writePromptMarkdown(paths, prompt));
  }
  await Promise.all(writes);

  return {
    run,
    prompt,
    paths: {
      runDirectory: paths.runDirectory,
      promptPath: paths.promptPath,
      commandPath: paths.commandPath,
      htmlPath: paths.htmlPath,
      metadataPath: paths.metadataPath,
      previewPath: paths.previewPath,
      supabaseConfigPath: paths.supabaseConfigPath,
    },
  };
}

export function buildRunAssets(kind: RunKind): RunAssets {
  if (kind === "data-science") {
    return {
      metadata: "metadata.json",
      prompt: "prompt.md",
      rawResponse: "response.raw.txt",
      ds: {
        notebook: "analysis.ipynb",
        summary: "summary.json",
        chartDistribution: "chart-distribution.png",
        chartTreatmentEffect: "chart-treatment-effect.png",
        chartCompletionRates: "chart-completion-rates.png",
      },
    };
  }
  return {
    metadata: "metadata.json",
    prompt: "prompt.md",
    html: "index.html",
    preview: "preview.png",
    video: "preview.webm",
    rawResponse: "response.raw.txt",
  };
}

export function expectedRunOutputAssets(kind: RunKind): string[] {
  const assets = buildRunAssets(kind);
  if (kind === "data-science") {
    return Object.values(assets.ds ?? {}).filter((asset): asset is string => Boolean(asset));
  }
  return [assets.html, assets.preview, assets.video].filter(
    (asset): asset is string => Boolean(asset),
  );
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveRunKind(input: PrepareRunInput): RunKind {
  const benchmarkKind = input.benchmark.kind;
  if (input.kind && benchmarkKind && input.kind !== benchmarkKind) {
    throw new Error(
      `Run kind "${input.kind}" does not match benchmark kind "${benchmarkKind}".`
    );
  }
  return input.kind ?? benchmarkKind ?? "visual";
}

export function validateDataScienceAccess(
  access: DataScienceAccess | undefined
): DataScienceAccess {
  const baseUrl = access?.baseUrl.trim();
  const anonKey = access?.anonKey.trim();
  if (!baseUrl || !anonKey) {
    throw new Error(
      "Data Science runs require SUPABASE_URL and SUPABASE_ANON_KEY before a run can be prepared."
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("SUPABASE_URL must be a valid HTTP or HTTPS URL.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must be a valid HTTP or HTTPS URL.");
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    anonKey,
  };
}

async function writeSupabaseConfig(
  configPath: string,
  access: DataScienceAccess
): Promise<void> {
  const config = {
    url: `${access.baseUrl}/rest/v1/posthog_events?select=*&session_id=not.is.null&variant=not.is.null`,
    headers: {
      apikey: access.anonKey,
      Authorization: `Bearer ${access.anonKey}`,
    },
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
