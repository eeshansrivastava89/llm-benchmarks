import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { checkInspectOutcome, inspectLogNames } from "../src/inspect-guard.mjs";
import { runForeground } from "../src/interactive-runner.mjs";
import { buildInspectInvocation, inspectLogDir } from "../src/run-plan.mjs";

async function fakeProvider(t, status) {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({ url: request.url, authorization: request.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      response.writeHead(status, { "content-type": "application/json" });
      response.end(status === 200
        ? JSON.stringify({ id: "chatcmpl_test", object: "chat.completion", created: 0, model: "test-model", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })
        : JSON.stringify({ error: { message: "Access expired", type: "access_terminated_error" } }));
    });
  });
  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  t.after(() => new Promise((resolvePromise) => server.close(resolvePromise)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, requests };
}

function connection(baseUrl) {
  return {
    inspectModel: "openai-api/test-provider/test-model",
    baseUrl,
    modelArgs: { responses_api: false },
    childEnv: { ...process.env, TEST_PROVIDER_API_KEY: "test-secret" },
  };
}

async function runSampleEval(t, translated) {
  const directory = await mkdtemp(join(tmpdir(), "bench-inspect-guard-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logDir = join(directory, "logs");
  const taskPath = join(directory, "quick.py");
  await writeFile(taskPath, `from inspect_ai import Task, task\nfrom inspect_ai.dataset import Sample\nfrom inspect_ai.scorer import match\nfrom inspect_ai.solver import generate\n@task\ndef quick():\n    return Task(dataset=[Sample(input="Reply OK", target="ok")], solver=[generate()], scorer=match())\n`);
  const before = await inspectLogNames(process.cwd(), logDir);
  const runId = "guard-test-run";
  const args = buildInspectInvocation(
    { file: taskPath, name: "quick" },
    { provider: "test-provider", id: "test-model", api: "openai-completions" },
    translated, { logDir }, ["--display", "none", "--max-retries", "0", "--max-tokens", "16"], runId,
  );
  assert.equal(inspectLogDir(args), logDir);
  const result = await runForeground("uv", args, { cwd: process.cwd(), env: translated.childEnv });
  assert.equal(result.status, 0, "Inspect can exit 0 even when the eval itself failed");
  return { logDir, before, runId };
}

test("Bench verifies its own native eval log, not just Inspect's exit code", async (t) => {
  const provider = await fakeProvider(t, 200);
  const translated = connection(provider.baseUrl);
  const { logDir, before, runId } = await runSampleEval(t, translated);
  await checkInspectOutcome(process.cwd(), logDir, before, runId);
  await assert.rejects(checkInspectOutcome(process.cwd(), logDir, before, "wrong-run"), /did not create a log/);
  assert.ok(provider.requests.length >= 1);
});

test("a successful child with no new native log is not treated as a benchmark success", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bench-no-log-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(checkInspectOutcome(process.cwd(), directory, new Set(), "missing"), /without creating an evaluation log/);
});

test("a failed native eval is rejected even when Inspect exits successfully", async (t) => {
  const provider = await fakeProvider(t, 403);
  const { logDir, before, runId } = await runSampleEval(t, connection(provider.baseUrl));
  await assert.rejects(checkInspectOutcome(process.cwd(), logDir, before, runId), /Inspect log status: error/);
});
