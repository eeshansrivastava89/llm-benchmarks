import { BenchError } from "./errors.mjs";
import { opencodeSessionHeaders } from "./inspect-translate.mjs";

// Pi's model catalog only proves that credentials exist, not that the provider
// accepts them. One short real request is the only reliable live access check.
// Local models are never probed: a request would load them into memory.
// The opencode-go API requires session headers that Pi's own agent adds only
// inside a session, so the probe supplies them itself.
export async function probeCloudModelAccess(modelRuntime, model) {
  if (model?.backend?.location !== "cloud") return { status: "skipped" };

  let response;
  try {
    response = await modelRuntime.completeSimple(model, {
      messages: [{ role: "user", content: [{ type: "text", text: "Reply OK." }] }],
    }, {
      maxTokens: 16,
      headers: opencodeSessionHeaders(model, "bench"),
    });
  } catch (error) {
    throw new BenchError(accessFailureMessage(error));
  }
  // Pi can resolve an errored stream instead of throwing; inspect the result.
  if (response?.stopReason === "error") throw new BenchError(accessFailureMessage(response));
  return { status: "ready" };
}

// Provider error text can carry account details, so surface only its shape.
export function accessFailureMessage(error) {
  const status = error?.status ?? error?.statusCode;
  const name = error?.name ?? "provider error";
  return `Model request failed (${name}${status ? `, HTTP ${status}` : ""}). Check provider access and credentials.`;
}
