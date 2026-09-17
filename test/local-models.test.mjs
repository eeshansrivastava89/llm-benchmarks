import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { discoverLocalProviders } from "../src/local-models.mjs";

async function fixture(t, providers) {
  const directory = await mkdtemp(join(tmpdir(), "bench-local-models-"));
  const modelsPath = join(directory, "models.json");
  const original = JSON.stringify({ providers });
  await writeFile(modelsPath, original);
  const runtime = await ModelRuntime.create({ modelsPath, authPath: join(directory, "auth.json"), modelsStorePath: join(directory, "models-store.json") });
  t.after(async () => {
    await runtime.refresh({ allowNetwork: false });
    assert.equal(await readFile(modelsPath, "utf8"), original);
    await rm(directory, { recursive: true, force: true });
  });
  return runtime;
}
const provider = { baseUrl: "http://127.0.0.1:8000/v1", api: "openai-completions", apiKey: "test-local-key", compat: { supportsDeveloperRole: false } };

for (const id of ["omlx", "ollama"]) {
  test(`${id}: authoritative inventory and metadata, explicit Pi settings, no guessed generation defaults`, async (t) => {
    const configs = { [id]: {
      ...provider, models: [{ id: "existing", maxTokens: 8192 }],
      modelOverrides: { overridden: { maxTokens: 2048 }, sampled: { samplingParams: { max_tokens: 12000, reasoning_effort: "high" } } },
    } };
    const runtime = await fixture(t, configs);
    let inventory = ["existing", "new", "overridden", "sampled", "helper"];
    const [initial] = await discoverLocalProviders(runtime, configs, {
      fetchImpl: async (url, options) => {
        assert.equal(options.headers.get("authorization"), "Bearer test-local-key");
        assert.equal(options.redirect, "error");
        if (url.pathname === "/v1/models") return Response.json({ data: inventory.map((id) => ({ id })) });
        if (url.pathname === "/v1/models/status") return Response.json({ models: inventory.map((id) => ({
          id, model_type: id === "helper" ? "markitdown" : "vlm", max_context_window: 131072, max_tokens: 32768, thinking_default: true,
        })) });
        assert.equal(url.pathname, "/api/show");
        return Response.json({
          capabilities: JSON.parse(options.body).model === "helper" ? ["embedding"] : ["completion", "vision", "thinking"],
          model_info: { "general.architecture": "test", "test.context_length": 131072 },
        });
      },
    });
    assert.equal(initial.backend.status, "online");
    assert.deepEqual(initial.models.map((m) => m.id), ["existing", "new", "overridden", "sampled"]);
    assert.deepEqual(initial.models.find((m) => m.id === "sampled").localModelPolicy, { output: "pi", thinking: "pi" });
    const fresh = initial.models.find((m) => m.id === "new");
    assert.equal(fresh.contextWindow, 131072);
    assert.deepEqual(fresh.input, ["text", "image"]);
    assert.equal(fresh.reasoning, true);
    assert.equal(fresh.maxTokens, id === "omlx" ? 32768 : undefined);
    assert.deepEqual(fresh.localModelPolicy, { output: "server", thinking: "server" });
    assert.equal(initial.models.find((m) => m.id === "existing").maxTokens, 8192);
    assert.equal(initial.models.find((m) => m.id === "existing").localModelPolicy.output, "pi");
    assert.equal(initial.models.find((m) => m.id === "overridden").maxTokens, 2048);
    assert.equal(initial.models.find((m) => m.id === "overridden").localModelPolicy.output, "pi");
    assert.equal((await runtime.getAuth(fresh)).auth.apiKey, "test-local-key");
    inventory = ["new"];
    assert.deepEqual((await initial.refreshModels()).models.map((m) => m.id), ["new"]);
    inventory = ["existing"];
    assert.equal((await initial.refreshModels()).models[0].maxTokens, 8192);
  });
}

test("missing metadata remains unknown and unavailable, not fabricated", async (t) => {
  const configs = { local: provider };
  const runtime = await fixture(t, configs);
  const [result] = await discoverLocalProviders(runtime, configs, { fetchImpl: async () => Response.json({ data: [{ id: "unknown" }] }) });
  assert.equal(result.backend.status, "online");
  assert.match(result.models[0].unavailableReason, /did not advertise/);
  for (const field of ["contextWindow", "input", "maxTokens", "reasoning"]) assert.equal(result.models[0][field], undefined);
  assert.deepEqual(runtime.getModels("local"), []);
});

test("keyless servers with advertised metadata need no static models or dummy key", async (t) => {
  const configs = { local: { baseUrl: provider.baseUrl, api: provider.api } };
  const runtime = await fixture(t, configs);
  const [result] = await discoverLocalProviders(runtime, configs, { fetchImpl: async () => Response.json({ data: [{ id: "new", contextWindow: 65536, input: ["text"] }] }) });
  assert.equal(result.models[0].unavailableReason, undefined);
  assert.equal((await runtime.getAuth(result.models[0])).auth.apiKey, "local");
});

test("transport and inventory failures are specific and safe; Pi registration errors are not disguised as offline", async (t) => {
  const configs = { local: provider };
  const runtime = await fixture(t, configs);
  for (const [response, reason] of [
    [new Response("secret", { status: 401 }), /HTTP 401/],
    [new Response("secret"), /invalid JSON/],
    [Response.json({ data: [null] }), /Invalid \/models/],
  ]) {
    const [result] = await discoverLocalProviders(runtime, configs, { fetchImpl: async () => response });
    assert.deepEqual(result.models, []);
    assert.match(result.discoveryError, reason);
    assert.doesNotMatch(result.discoveryError, /secret/);
  }
  runtime.registerProvider = () => { throw new Error("bad Pi configuration"); };
  await assert.rejects(discoverLocalProviders(runtime, configs, { fetchImpl: async () => Response.json({ data: [] }) }), /bad Pi configuration/);
});

test("cloud providers are untouched and local requests have a deadline", async (t) => {
  const configs = { local: provider, cloud: { ...provider, baseUrl: "https://example.com/v1" } };
  const runtime = await fixture(t, configs);
  const timer = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(timer));
  let calls = 0;
  const result = await discoverLocalProviders(runtime, configs, {
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  });
  assert.equal(calls, 1);
  assert.match(result[0].discoveryError, /timed out/);
});
