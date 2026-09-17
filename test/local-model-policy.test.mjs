import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import localModels, { serverManagedPayload } from "../src/pi-extensions/local-models.mjs";

const exec = promisify(execFile);
const serverPolicy = { output: "server", thinking: "server" };

test("server policy drops only implicit output/thinking controls and preserves explicit sampling", () => {
  const payload = {
    model: "local", messages: [{ role: "user", content: "hello" }], tools: [{ type: "function" }],
    stream: true, max_tokens: 4096, max_completion_tokens: 4096, reasoning_effort: "medium",
    chat_template_kwargs: { enable_thinking: false, custom: "keep" }, temperature: 0.7,
  };
  const result = serverManagedPayload(payload, { samplingParams: { temperature: 0.7 } }, serverPolicy);
  assert.equal(result.max_tokens, undefined);
  assert.equal(result.max_completion_tokens, undefined);
  assert.equal(result.reasoning_effort, undefined);
  assert.deepEqual(result.chat_template_kwargs, { custom: "keep" });
  assert.equal(result.temperature, 0.7);
  assert.equal(result.messages, payload.messages);
  assert.equal(result.tools, payload.tools);
  assert.equal(payload.max_tokens, 4096);
});

test("explicit Pi output settings and user-selected thinking remain in control", () => {
  const payload = { max_tokens: 9000, reasoning_effort: "high" };
  assert.deepEqual(serverManagedPayload(payload, {}, { output: "pi", thinking: "pi" }), payload);
  assert.deepEqual(serverManagedPayload(payload, { samplingParams: payload }, serverPolicy), payload);
  assert.equal(serverManagedPayload(payload, {}, serverPolicy, true).reasoning_effort, "high");
  assert.deepEqual(serverManagedPayload({ max_tokens: 12000, max_completion_tokens: 32768 },
    { samplingParams: { max_tokens: 12000 } }, { output: "pi", thinking: "server" }), { max_tokens: 12000 });
});

test("the explicit adapter is scoped to the selected model and respects a later Pi thinking selection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bench-local-extension-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const model = { id: "selected", baseUrl: "http://127.0.0.1:8000/v1" };
  await writeFile(join(root, "bench-local-model.json"), JSON.stringify({ provider: "omlx", model, policy: serverPolicy }));
  const handlers = new Map();
  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    await localModels({ on: (name, fn) => handlers.set(name, fn), registerProvider: (provider, config) => {
      assert.equal(provider, "omlx");
      assert.equal(config.models[0].maxTokens, undefined);
    } });
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
  }
  const context = { model: { ...model, provider: "omlx" }, ui: { setStatus() {} } };
  const event = { payload: { model: model.id, max_tokens: 4096, reasoning_effort: "high" } };
  const request = handlers.get("before_provider_request");
  assert.equal(request(event, { ...context, model: { ...context.model, provider: "cloud" } }), undefined);
  handlers.get("thinking_level_select")({}, context); // Initial model setup isn't a user choice.
  assert.equal(request(event, context).reasoning_effort, undefined);
  handlers.get("session_start")({}, context);
  handlers.get("thinking_level_select")({}, context);
  assert.equal(request(event, context).reasoning_effort, "high");
  assert.equal(request(event, context).max_tokens, undefined);
});

for (const provider of ["omlx", "ollama"]) {
  test(`${provider}: real Pi sends server-managed requests and completes a large tool write`, { timeout: 30_000 }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "bench-local-wire-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const requests = [];
    const content = "a line of generated code\n".repeat(2500);
    const server = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(payload);
      const delta = requests.length === 1 ? {
        role: "assistant", tool_calls: [{ index: 0, id: "write-1", type: "function", function: {
          name: "write", arguments: JSON.stringify({ path: "generated.txt", content }),
        } }],
      } : { role: "assistant", content: "File written." };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ id: "reply", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    t.after(() => new Promise((done) => server.close(done)));
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const model = {
      provider, id: "downloaded", name: "Downloaded model", api: "openai-completions", baseUrl,
      input: ["text", "image"], reasoning: true, contextWindow: 131072,
      ...(provider === "omlx" ? { maxTokens: 32768 } : {}),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsDeveloperRole: false }, localModelPolicy: serverPolicy,
    };
    const env = { ...process.env, PI_CODING_AGENT_DIR: root };
    await exec(process.execPath, [resolve("src/pi-run-config.mjs")], {
      env: { ...env, BENCH_PI_LOCAL_MODEL: JSON.stringify({ model, auth: { apiKey: "local-test" } }) },
    });
    const pending = exec(process.execPath, [
      resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
      "--print", "--mode", "json", "--no-extensions", "--extension", resolve("src/pi-extensions/local-models.mjs"),
      "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve", "--no-session",
      "--tools", "write", "--provider", provider, "--model", model.id, "Write generated.txt.",
    ], { cwd: root, env, timeout: 20_000, maxBuffer: 2_000_000 });
    pending.child.stdin.end();
    const { stdout } = await pending;
    assert.equal(await readFile(join(root, "generated.txt"), "utf8"), content);
    assert.equal(requests.length, 2, stdout.slice(-2000));
    for (const request of requests) {
      for (const key of ["max_tokens", "max_completion_tokens", "temperature", "top_p", "top_k", "reasoning_effort", "enable_thinking", "thinking", "chat_template_kwargs"]) {
        assert.equal(request[key], undefined, `${provider} injected ${key}`);
      }
      assert.ok(request.tools.some((tool) => tool.function.name === "write"));
    }
  });
}
