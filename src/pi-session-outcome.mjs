import { readdir } from "node:fs/promises";
import { join } from "node:path";

// Pi's interactive exit code only reflects how the TUI was closed, never
// whether the model turn succeeded. The persisted session is the source of
// truth, so read it before any cleanup discards the transcript.
export async function inspectPiSessionOutcome(sessionDirectory, options = {}) {
  const open = options.openSession ?? openSession;
  const readdirImpl = options.readdirImpl ?? readdir;

  let names;
  try {
    names = (await readdirImpl(sessionDirectory))
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return unverified();
    throw error;
  }
  if (names.length === 0) return unverified();

  let branch;
  try {
    const session = await open(join(sessionDirectory, names.at(-1)));
    branch = session?.getBranch?.() ?? [];
  } catch {
    return unverified();
  }

  const assistant = [...branch]
    .reverse()
    .find((entry) => entry?.type === "message" && entry.message?.role === "assistant");
  if (!assistant) return unverified();

  switch (assistant.message.stopReason) {
    case "error":
      return { status: "failed", reason: "Pi ended the run with a model error. Check provider access and credentials." };
    case "aborted":
      return { status: "cancelled", reason: "The Pi run was aborted before it finished." };
    default:
      return { status: "ok" };
  }
}

function unverified() {
  return { status: "unverified", reason: "Pi recorded no finished assistant response for this run." };
}

async function openSession(path) {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  return SessionManager.open(path);
}
