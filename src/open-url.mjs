import { spawn } from "node:child_process";
import { platform } from "node:os";

// Detached platform opener. The returned promise resolves once the opener
// process spawns; launch errors are safe to ignore (already swallowed) or
// await when the caller wants to surface them.
export function openExternalUrl(url) {
  const [command, args] = platform() === "darwin"
    ? ["open", [url]]
    : platform() === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  const spawned = new Promise((resolvePromise, reject) => {
    child.once("spawn", resolvePromise);
    child.once("error", reject);
  });
  spawned.catch(() => {});
  child.unref();
  return spawned;
}
