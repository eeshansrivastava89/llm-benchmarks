#!/usr/bin/env node
/**
 * Migrate run metadata to use normalized modelSource values.
 *
 * Old values → New values:
 *   (none) + backendLabel "llama.cpp"  → modelSource: "llama-cpp", backendLabel: "llama.cpp"
 *   (none) + no backendLabel            → modelSource: "llama-cpp", backendLabel: "llama.cpp"
 *   "custom" + backendLabel "cloud"     → modelSource: "cloud",     backendLabel: "Cloud"
 *   "custom" + backendLabel "Custom"    → modelSource: "cloud",     backendLabel: "Custom"
 *   "custom" + any other backendLabel   → modelSource: "cloud",    backendLabel: (preserved)
 *   "lmstudio"                          → modelSource: "llama-cpp", backendLabel: "LM Studio"
 *   "omlx"                              → (no change)
 *   "ollama"                            → (no change)
 *
 * Also normalizes the ollama baseUrl to include /v1 suffix if missing.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RUNS_DIR = process.argv[2] || "runs";

async function findMetadataFiles(dir) {
  const result = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...await findMetadataFiles(path));
      } else if (entry.name === "metadata.json") {
        result.push(path);
      }
    }
  } catch { /* skip unreadable dirs */ }
  return result;
}

function migrateMetadata(meta) {
  if (!meta.runner) return { meta, changed: false };

  let changed = false;
  const source = meta.runner.modelSource;
  const label = meta.runner.backendLabel;

  // No modelSource at all — infer from backendLabel
  if (!source) {
    const backend = (label ?? "").toLowerCase();
    if (backend === "cloud") {
      meta.runner.modelSource = "cloud";
      if (label === "cloud") meta.runner.backendLabel = "Cloud";
    } else if (/lm\s*studio/u.test(backend)) {
      meta.runner.modelSource = "llama-cpp";
      meta.runner.backendLabel = "LM Studio";
    } else if (/omlx/u.test(backend)) {
      meta.runner.modelSource = "omlx";
    } else if (/ollama/u.test(backend)) {
      meta.runner.modelSource = "ollama";
    } else {
      // Default: llama.cpp
      meta.runner.modelSource = "llama-cpp";
      meta.runner.backendLabel = meta.runner.backendLabel || "llama.cpp";
    }
    changed = true;
  }

  // "custom" → "cloud"
  if (meta.runner.modelSource === "custom") {
    meta.runner.modelSource = "cloud";
    if (meta.runner.backendLabel === "cloud") {
      meta.runner.backendLabel = "Cloud";
    }
    changed = true;
  }

  // "lmstudio" → "llama-cpp"
  if (meta.runner.modelSource === "lmstudio") {
    meta.runner.modelSource = "llama-cpp";
    if (!meta.runner.backendLabel || meta.runner.backendLabel === "lmstudio") {
      meta.runner.backendLabel = "LM Studio";
    }
    changed = true;
  }

  // Normalize Ollama baseUrl to include /v1
  if (meta.runner.modelSource === "ollama" && meta.runner.baseUrl) {
    const url = meta.runner.baseUrl;
    if (url.includes("11434") && !url.endsWith("/v1")) {
      meta.runner.baseUrl = url.replace(/\/+$/, "") + "/v1";
      changed = true;
    }
  }

  return { meta, changed };
}

async function main() {
  const files = await findMetadataFiles(RUNS_DIR);
  console.log(`Found ${files.length} metadata files in ${RUNS_DIR}`);

  let migrated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const file of files) {
    try {
      const raw = await readFile(file, "utf8");
      const meta = JSON.parse(raw);
      const { meta: updated, changed } = migrateMetadata(meta);
      if (changed) {
        await writeFile(file, JSON.stringify(updated, null, 2) + "\n", "utf8");
        console.log(`  ✓ ${file.replace(RUNS_DIR + "/", "")} → modelSource: ${updated.runner?.modelSource}, backendLabel: ${updated.runner?.backendLabel}`);
        migrated++;
      } else {
        unchanged++;
      }
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\nMigrated: ${migrated}, Unchanged: ${unchanged}, Errors: ${errors}`);
}

main().catch(console.error);