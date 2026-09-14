import { BenchError } from "./errors.mjs";

export const VIEWER_HOST = "127.0.0.1";
export const DEFAULT_INSPECT_VIEWER_PORT = 7575;
export const DEFAULT_VISUAL_VIEWER_PORT = 4321;

export function resolveViewerEndpoints(environment = {}) {
  const inspectPort = viewerPort(
    environment.BENCH_INSPECT_VIEWER_PORT,
    DEFAULT_INSPECT_VIEWER_PORT,
    "BENCH_INSPECT_VIEWER_PORT",
  );
  const visualPort = viewerPort(
    environment.BENCH_VISUAL_VIEWER_PORT,
    DEFAULT_VISUAL_VIEWER_PORT,
    "BENCH_VISUAL_VIEWER_PORT",
  );
  if (inspectPort === visualPort) {
    throw new BenchError("Inspect and Visual viewers must use different ports");
  }

  return {
    inspect: {
      host: VIEWER_HOST,
      port: inspectPort,
      url: `http://${VIEWER_HOST}:${inspectPort}`,
    },
    visual: {
      host: VIEWER_HOST,
      port: visualPort,
      url: `http://${VIEWER_HOST}:${visualPort}`,
    },
  };
}

export function resolveInspectResultsUrl({ staticBuild = false, environment = {} } = {}) {
  if (!staticBuild) return resolveViewerEndpoints(environment).inspect.url;

  const value = environment.PUBLIC_INSPECT_VIEWER_URL?.trim();
  if (!value) return undefined;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new BenchError("PUBLIC_INSPECT_VIEWER_URL must be a valid HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new BenchError("PUBLIC_INSPECT_VIEWER_URL must be an HTTP(S) URL without credentials");
  }
  if (isLoopbackHostname(url.hostname)) {
    throw new BenchError("PUBLIC_INSPECT_VIEWER_URL must not target localhost or a loopback address");
  }
  return url.href;
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized === "[::1]"
    || normalized === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function viewerPort(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new BenchError(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}
