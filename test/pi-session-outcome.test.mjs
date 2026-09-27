import assert from "node:assert/strict";
import test from "node:test";

import { inspectPiSessionOutcome } from "../src/pi-session-outcome.mjs";

function assistant(stopReason) {
  return { type: "message", message: { role: "assistant", stopReason } };
}

function options(branch, names = ["run.jsonl"]) {
  return {
    readdirImpl: async () => names,
    openSession: async () => ({ getBranch: () => branch }),
  };
}

test("a final errored assistant turn fails the run", async () => {
  const outcome = await inspectPiSessionOutcome("/run/.bench-session", options([assistant("error")]));
  assert.equal(outcome.status, "failed");
});

test("a recovered retry passes when the active branch ends successfully", async () => {
  const outcome = await inspectPiSessionOutcome(
    "/run/.bench-session",
    options([assistant("error"), assistant("stop")]),
  );
  assert.deepEqual(outcome, { status: "ok" });
});

test("an aborted turn is reported as cancelled", async () => {
  const outcome = await inspectPiSessionOutcome("/run/.bench-session", options([assistant("aborted")]));
  assert.equal(outcome.status, "cancelled");
});

test("a session with no finished assistant response is never success", async () => {
  assert.equal((await inspectPiSessionOutcome("/run/.bench-session", options([]))).status, "unverified");
  assert.equal((await inspectPiSessionOutcome("/run/.bench-session", options([assistant("stop")], []))).status, "unverified");
});

test("a missing directory or unreadable session is unverified", async () => {
  const missing = {
    readdirImpl: async () => {
      throw Object.assign(new Error("gone"), { code: "ENOENT" });
    },
  };
  assert.equal((await inspectPiSessionOutcome("/run/.bench-session", missing)).status, "unverified");
  assert.equal((await inspectPiSessionOutcome("/run/.bench-session", {
    readdirImpl: async () => ["run.jsonl"],
    openSession: async () => { throw new Error("unreadable"); },
  })).status, "unverified");
});
