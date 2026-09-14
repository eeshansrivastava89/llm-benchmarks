import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".md", ".svg", ".txt"]);
const FORBIDDEN_EXPORT_FILES = new Set([
  ".env",
  "analysis.ipynb",
  "command.txt",
  "prompt.md",
  "request.json",
  "response.raw.txt",
  "response.txt",
  "stream.ndjson",
  "supabase.json",
]);
const COMMON_CONTENT_RULES = [
  ["loopback URL", /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?/iu],
  ["local file URL", /\bfile:\/\//iu],
  ["local Unix home path", /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//u],
  ["local Windows path", /\b[A-Za-z]:\\(?:Users|Documents and Settings)\\/u],
];
const EXPORT_CONTENT_RULES = [
  ["authorization header", /["']?authorization["']?\s*[:=]\s*(?:["']?Bearer\b|["'][^"']+)/iu],
  ["API key field", /["'](?:api[_-]?key|apikey|anonKey|accessToken|secret)["']\s*:/iu],
  ["JWT-like token", /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/u],
  ["provider key-like token", /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/u],
  ["private runner field", /"(?:baseUrl|launchCommand|commandAsset|requestAsset|streamAsset|responseAsset|promptText)"\s*:/u],
];

export async function auditStaticBuild(root) {
  const absoluteRoot = resolve(root);
  const files = await walkFiles(absoluteRoot);
  const violations = [];

  for (const path of files) {
    const relativePath = relative(absoluteRoot, path).split(sep).join("/");
    const inExport = relativePath === "export/manifest.json" || relativePath.startsWith("export/runs/");
    const fileName = basename(path).toLowerCase();
    if (inExport && (FORBIDDEN_EXPORT_FILES.has(fileName) || (fileName === "index.html" && relativePath.startsWith("export/runs/")))) {
      violations.push({ path: relativePath, rule: "private run artifact" });
    }

    const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
    if (!TEXT_EXTENSIONS.has(extension)) continue;
    const source = await readFile(path, "utf8");
    for (const [rule, pattern] of COMMON_CONTENT_RULES) {
      if (pattern.test(source)) violations.push({ path: relativePath, rule });
    }
    if (inExport) {
      for (const [rule, pattern] of EXPORT_CONTENT_RULES) {
        if (pattern.test(source)) violations.push({ path: relativePath, rule });
      }
    }
  }

  if (violations.length > 0) {
    const summary = violations.map(({ path, rule }) => `- ${path}: ${rule}`).join("\n");
    throw new Error(`Static build privacy audit failed:\n${summary}`);
  }

  return { filesChecked: files.length };
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === invokedPath) {
  const root = process.env.STATIC_AUDIT_DIR ?? join(process.cwd(), "dist-static");
  const result = await auditStaticBuild(root);
  process.stdout.write(`Static build privacy audit passed for ${result.filesChecked} files.\n`);
}
