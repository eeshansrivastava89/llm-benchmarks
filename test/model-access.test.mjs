import assert from "node:assert/strict";
import test from "node:test";

import { accessFailureMessage, probeCloudModelAccess } from "../src/model-access.mjs";
import { opencodeSessionHeaders } from "../src/inspect-translate.mjs";

function model(location) {
  return { provider: "kimi", id: "k3", api: "openai-completions", backend: { location } };
}

function opencodeGoModel() {
  return { ...model("cloud"), provider: "opencode-go", id: "deepseek-v4-flash" };
}

test("a cloud model is probed with one real request", async () => {
  const calls = [];
  const runtime = {
    completeSimple: async (requested, context, options) => {
      calls.push({ requested, context, options });
      return { stopReason: "stop" };
    },
  };

  assert.deepEqual(await probeCloudModelAccess(runtime, model("cloud")), { status: "ready" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].requested.id, "k3");
  assert.equal(calls[0].options.maxTokens, 16);
});

test("local and unknown models are never probed", async () => {
  let called = false;
  const runtime = { completeSimple: async () => { called = true; return { stopReason: "stop" }; } };

  assert.deepEqual(await probeCloudModelAccess(runtime, model("local")), { status: "skipped" });
  assert.deepEqual(await probeCloudModelAccess(runtime, model("unknown")), { status: "skipped" });
  assert.equal(called, false);
});

test("an opencode-go probe carries the session headers the provider requires", async () => {
  const calls = [];
  const runtime = {
    completeSimple: async (requested, context, options) => {
      calls.push({ requested, options });
      return { stopReason: "stop" };
    },
  };

  // Without x-opencode-session the provider rejects the request (400
  // MissingSessionID) even with a valid subscription, a false denial.
  assert.deepEqual(await probeCloudModelAccess(runtime, opencodeGoModel()), { status: "ready" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["x-opencode-client"], "bench");
  assert.match(calls[0].options.headers["x-opencode-session"], /^[0-9a-f-]{36}$/);
});

test("the shared opencode session headers stay per-call and provider-specific", () => {
  const first = opencodeSessionHeaders(opencodeGoModel(), "inspect-ai");
  const second = opencodeSessionHeaders(opencodeGoModel(), "inspect-ai");
  assert.equal(first["x-opencode-client"], "inspect-ai");
  assert.notEqual(first["x-opencode-session"], second["x-opencode-session"]);
  assert.equal(opencodeSessionHeaders(model("cloud"), "bench"), undefined);
});

test("a provider denial surfaces only the error shape and status", async () => {
  const denial = Object.assign(
    new Error("Your current subscription does not have access to Kimi Code"),
    { name: "APIStatusError", status: 403 },
  );
  const runtime = { completeSimple: async () => { throw denial; } };

  await assert.rejects(probeCloudModelAccess(runtime, model("cloud")), (error) => {
    assert.match(error.message, /APIStatusError/);
    assert.match(error.message, /HTTP 403/);
    assert.doesNotMatch(error.message, /subscription does not have access/);
    return true;
  });
});

test("an errored stream result counts as a denial", async () => {
  const runtime = { completeSimple: async () => ({ stopReason: "error", errorMessage: "403" }) };
  await assert.rejects(probeCloudModelAccess(runtime, model("cloud")), /Model request failed/);
});

test("accessFailureMessage omits unavailable detail", () => {
  assert.equal(
    accessFailureMessage({}),
    "Model request failed (provider error). Check provider access and credentials.",
  );
});
