import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertWriteConfinementAvailable,
  createSeatbeltProfile,
  createWriteConfinementLaunch,
  writeConfinementEnvironment,
  writeConfinementMetadata,
} from "../src/write-confinement.mjs";

async function temporaryRuntimeRoot(t) {
  const parent = join(process.cwd(), ".bench-runtime");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "write-confinement-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ code, signal, output }));
  });
}

test("Seatbelt policy denies global writes and re-allows only the run slot and scratch paths", () => {
  const profile = createSeatbeltProfile('/Users/test/run "slot"');
  assert.match(profile, /\(allow default\)/u);
  assert.match(profile, /\(deny file-write\*\)/u);
  assert.match(profile, /Users\/test\/run \\"slot\\"/u);
  assert.match(profile, /private\/tmp/u);
  assert.match(profile, /\/dev/u);
});

test("Linux launch keeps the host readable, overlays writable temp storage, and bind-mounts one run slot", async () => {
  const launch = await createWriteConfinementLaunch("pi", ["--model", "test"], {
    platform: "linux",
    runtime: "bubblewrap",
    executable: "/usr/bin/bwrap",
    runDirectory: "/project/runs/task/model/run-1",
    env: { PATH: "/host/bin", HOME: "/home/test", TOKEN: "preserved" },
    realpathImpl: async (path) => path,
  });

  assert.equal(launch.command, "/usr/bin/bwrap");
  assert.deepEqual(launch.args.slice(0, 19), [
    "--die-with-parent",
    "--ro-bind", "/", "/",
    "--dev-bind", "/dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    "--dir", "/tmp/bench-interactive",
    "--bind", "/project/runs/task/model/run-1", "/project/runs/task/model/run-1",
    "--chdir", "/project/runs/task/model/run-1",
    "--",
  ]);
  assert.deepEqual(launch.args.slice(19, 21), ["/bin/sh", "-c"]);
  assert.match(launch.args[21], /auth\.json models\.json models-store\.json/u);
  assert.doesNotMatch(launch.args[21], /settings\.json/u);
  assert.deepEqual(launch.args.slice(22), [
    "bench-pi-bootstrap",
    "/home/test/.pi/agent",
    "/tmp/bench-interactive/pi-agent",
    "pi", "--model", "test",
  ]);
  assert.equal(launch.env.PATH, "/host/bin");
  assert.equal(launch.env.HOME, "/home/test");
  assert.equal(launch.env.TOKEN, "preserved");
  assert.equal(launch.env.TMPDIR, "/tmp/bench-interactive");
});

test("write-confinement environment preserves host discovery and redirects mutable caches", () => {
  const environment = writeConfinementEnvironment({
    PATH: "/host/bin",
    HOME: "/home/test",
    OPENAI_API_KEY: "provider-secret",
    PLAYWRIGHT_BROWSERS_PATH: "/home/test/browser-cache",
  }, "/tmp/scratch");

  assert.equal(environment.PATH, "/host/bin");
  assert.equal(environment.HOME, "/home/test");
  assert.equal(environment.OPENAI_API_KEY, "provider-secret");
  assert.equal(environment.PLAYWRIGHT_BROWSERS_PATH, "/home/test/browser-cache");
  assert.equal(environment.PI_CODING_AGENT_DIR, "/tmp/scratch/pi-agent");
  assert.equal(environment.TMPDIR, "/tmp/scratch");
  assert.equal(environment.UV_CACHE_DIR, "/tmp/scratch/uv-cache");
  assert.equal(environment.npm_config_cache, "/tmp/scratch/npm-cache");
});

test("private metadata states the soft boundary without paths or credentials", () => {
  const metadata = writeConfinementMetadata({
    platform: "linux",
    runtime: "bubblewrap",
  }, "discarded-after-run");
  assert.deepEqual(metadata, {
    mode: "os-write-confinement",
    runtime: "bubblewrap",
    platform: "linux",
    filesystem: "run-slot-and-temporary-write",
    reads: "host-readable",
    network: "host-access",
    diagnostics: "discarded-after-run",
  });
});

test("missing or unusable platform confinement fails closed", async () => {
  await assert.rejects(
    assertWriteConfinementAvailable({
      platform: "linux",
      env: { PATH: "/missing" },
      accessImpl: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
    }),
    /Install Bubblewrap/u,
  );
  await assert.rejects(
    assertWriteConfinementAvailable({ platform: "win32" }),
    /not supported on win32/u,
  );
  await assert.rejects(
    assertWriteConfinementAvailable({
      platform: "darwin",
      accessImpl: async () => {},
      probeImpl: async () => ({ status: 1 }),
    }),
    /could not establish/u,
  );
});

test("OS confinement preserves normal tools and Playwright while denying persistent writes", async (t) => {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    t.skip(`unsupported platform: ${process.platform}`);
    return;
  }

  let runtime;
  try {
    runtime = await assertWriteConfinementAvailable();
  } catch (error) {
    t.skip(error instanceof Error ? error.message : String(error));
    return;
  }

  const root = await temporaryRuntimeRoot(t);
  const workspace = join(root, "slot");
  const sibling = join(root, "sibling");
  const repositoryProbe = join(process.cwd(), `.write-confinement-probe-${process.pid}`);
  const siblingProbe = join(sibling, "blocked.txt");
  const homeProbe = join(homedir(), `.write-confinement-probe-${process.pid}`);
  const symlinkTarget = join(sibling, "symlink-target.txt");
  await mkdir(workspace);
  await mkdir(sibling);
  await writeFile(symlinkTarget, "unchanged");
  await symlink(symlinkTarget, join(workspace, "outside-link"));
  t.after(() => Promise.all([
    rm(repositoryProbe, { force: true }),
    rm(homeProbe, { force: true }),
  ]));

  const script = [
    "set -eu",
    'printf allowed > "$1/allowed.txt"',
    'printf temporary > "$TMPDIR/temporary.txt"',
    'if printf blocked > "$2" 2>/dev/null; then exit 41; fi',
    'if printf blocked > "$3" 2>/dev/null; then exit 42; fi',
    'if printf blocked > "$4" 2>/dev/null; then exit 43; fi',
    'if printf blocked > "$1/outside-link" 2>/dev/null; then exit 44; fi',
    "node --version",
    "npm --version",
    "npx --version",
    "python3 --version",
    "uv --version",
    "rg --version",
    "pi --version",
    "pi --no-extensions --no-skills --no-prompt-templates --no-context-files --no-approve --list-models >/dev/null",
    "node --input-type=module -e 'import { chromium } from \"@playwright/test\"; const browser = await chromium.launch({ headless: true }); const page = await browser.newPage(); await page.setContent(\"<h1>confined</h1>\"); await page.screenshot({ path: process.argv[1] }); await browser.close();' \"$1/playwright.png\"",
  ].join("\n");
  const launch = await createWriteConfinementLaunch("/bin/sh", [
    "-c", script, "sh", workspace, repositoryProbe, siblingProbe, homeProbe,
  ], {
    ...runtime,
    runDirectory: workspace,
    env: process.env,
  });

  try {
    const result = await run(launch.command, launch.args, {
      cwd: launch.runDirectory,
      env: launch.env,
    });
    assert.equal(result.signal, null);
    assert.equal(result.code, 0, result.output);
  } finally {
    await launch.cleanup();
  }

  assert.equal(await readFile(join(workspace, "allowed.txt"), "utf8"), "allowed");
  await stat(join(workspace, "playwright.png"));
  assert.equal(await readFile(symlinkTarget, "utf8"), "unchanged");
  await assert.rejects(stat(repositoryProbe), { code: "ENOENT" });
  await assert.rejects(stat(siblingProbe), { code: "ENOENT" });
  await assert.rejects(stat(homeProbe), { code: "ENOENT" });
});
