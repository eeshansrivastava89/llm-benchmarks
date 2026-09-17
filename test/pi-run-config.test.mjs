import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const exec = promisify(execFile);

test("private Pi config round-trips the selected model and resolved credentials without config interpolation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bench-pi-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const model = {
    provider: "omlx", id: "new-download", name: "New model", api: "openai-completions",
    baseUrl: "http://127.0.0.1:8000/v1", input: ["text", "image"], reasoning: true,
    contextWindow: 65536, maxTokens: 4096, localDiscovery: true,
    localModelPolicy: { output: "server", thinking: "server" },
    backend: { location: "local", status: "online" },
    compat: { supportsDeveloperRole: false },
  };
  const auth = { apiKey: "!literal$key", headers: { "x-test": "!literal$VALUE" } };
  await writeFile(join(directory, "models.json"), JSON.stringify({ providers: {
    omlx: { api: model.api, baseUrl: model.baseUrl, models: [{ id: "old" }] },
  } }), { mode: 0o600 });
  await writeFile(join(directory, "auth.json"), JSON.stringify({ omlx: { type: "api_key", key: "stale" } }), { mode: 0o600 });
  const { stdout, stderr } = await exec(process.execPath, [fileURLToPath(new URL("../src/pi-run-config.mjs", import.meta.url))], {
    env: { ...process.env, PI_CODING_AGENT_DIR: directory, BENCH_PI_LOCAL_MODEL: JSON.stringify({ model, auth }) },
  });
  assert.equal(stdout + stderr, "");
  const written = await readFile(join(directory, "models.json"), "utf8");
  assert.doesNotMatch(written, /localDiscovery|backend|stale/);
  const runtime = await ModelRuntime.create({
    modelsPath: join(directory, "models.json"), authPath: join(directory, "auth.json"),
    modelsStorePath: join(directory, "models-store.json"),
  });
  assert.deepEqual(await runtime.getAvailable("omlx"), []);
  const manifest = JSON.parse(await readFile(join(directory, "bench-local-model.json"), "utf8"));
  assert.deepEqual(manifest.policy, model.localModelPolicy);
  runtime.registerProvider(manifest.provider, { models: [manifest.model] });
  const available = await runtime.getAvailable("omlx");
  assert.deepEqual(available.map((entry) => entry.id), [model.id]);
  assert.equal(available[0].contextWindow, model.contextWindow);
  assert.equal(available[0].reasoning, true);
  assert.deepEqual(available[0].input, model.input);
  const resolved = await runtime.getAuth(available[0]);
  assert.equal(resolved.auth.apiKey, auth.apiKey);
  assert.equal(resolved.auth.headers["x-test"], auth.headers["x-test"]);
  // In production the bootstrap chmods copied files before this helper runs.
  for (const file of ["models.json", "auth.json", "bench-local-model.json"]) {
    assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
  }
});

test("extension-registered providers receive the selected definition in the static config", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bench-pi-config-ext-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const model = {
    provider: "ollama-cloud", id: "glm-5.3-flash", name: "GLM 5.3 Flash", api: "openai-completions",
    baseUrl: "https://ollama.com/v1", input: ["text"], reasoning: true,
    contextWindow: 262144, maxTokens: 65536,
    backend: { location: "cloud", status: "online" },
  };
  const auth = { apiKey: "cloud-secret", headers: {} };
  await writeFile(join(directory, "models.json"), JSON.stringify({ providers: {
    "ollama-cloud": { api: model.api, baseUrl: model.baseUrl, models: [{ id: "kept-model", name: "Kept" }] },
  } }), { mode: 0o600 });
  await writeFile(join(directory, "auth.json"), JSON.stringify({}), { mode: 0o600 });
  const { stdout, stderr } = await exec(process.execPath, [fileURLToPath(new URL("../src/pi-run-config.mjs", import.meta.url))], {
    env: { ...process.env, PI_CODING_AGENT_DIR: directory, BENCH_PI_LOCAL_MODEL: JSON.stringify({ model, auth }) },
  });
  assert.equal(stdout + stderr, "");
  const runtime = await ModelRuntime.create({
    modelsPath: join(directory, "models.json"), authPath: join(directory, "auth.json"),
    modelsStorePath: join(directory, "models-store.json"),
  });
  const available = await runtime.getAvailable("ollama-cloud");
  assert.deepEqual(available.map((entry) => entry.id), ["kept-model", "glm-5.3-flash"]);
  const selected = available.at(-1);
  assert.equal(selected.baseUrl, model.baseUrl);
  assert.equal(selected.contextWindow, model.contextWindow);
  const resolved = await runtime.getAuth(selected);
  assert.equal(resolved.auth.apiKey, "cloud-secret");
  const manifest = JSON.parse(await readFile(join(directory, "bench-local-model.json"), "utf8"));
  assert.equal(manifest.provider, "ollama-cloud");
  assert.equal(manifest.policy, undefined);
});
