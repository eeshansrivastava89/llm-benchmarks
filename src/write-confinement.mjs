import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { BenchError } from "./errors.mjs";

export const WRITE_CONFINEMENT_MODE = "os-write-confinement";
export const MACOS_RUNTIME = "sandbox-exec";
export const LINUX_RUNTIME = "bubblewrap";

const MACOS_EXECUTABLE = "/usr/bin/sandbox-exec";
const MACOS_SCRATCH_ROOT = "/private/tmp";
const LINUX_SCRATCH_DIRECTORY = "/tmp/bench-interactive";
const PI_RUNTIME_BOOTSTRAP = [
  "set -eu",
  'source_agent_dir="$1"',
  'runtime_agent_dir="$2"',
  "shift 2",
  'mkdir -p "$runtime_agent_dir"',
  'chmod 700 "$runtime_agent_dir"',
  "for name in auth.json models.json models-store.json; do",
  '  if [ -f "$source_agent_dir/$name" ]; then',
  '    cp "$source_agent_dir/$name" "$runtime_agent_dir/$name"',
  '    chmod 600 "$runtime_agent_dir/$name"',
  "  fi",
  "done",
  'exec "$@"',
].join("\n");

export async function assertWriteConfinementAvailable(options = {}) {
  const platform = options.platform ?? process.platform;
  const environment = options.env ?? process.env;
  const accessImpl = options.accessImpl ?? access;
  const executable = await resolveConfinementExecutable(platform, environment, accessImpl);
  const runtime = runtimeForPlatform(platform);
  const probe = confinementProbe(runtime, executable);
  const result = await (options.probeImpl ?? runProbe)(probe.command, probe.args, {
    env: environment,
    spawnImpl: options.spawnImpl,
  });

  if (result.status !== 0) {
    throw new BenchError([
      "Interactive write confinement is unavailable.",
      `${runtimeLabel(runtime)} could not establish the required operating-system boundary.`,
      confinementInstallAdvice(platform),
    ].filter(Boolean).join("\n"));
  }

  return { platform, runtime, executable };
}

export async function createWriteConfinementLaunch(command, args, options) {
  if (!options?.runDirectory) {
    throw new BenchError("Interactive write confinement requires an assigned run directory");
  }

  const platform = options.platform ?? process.platform;
  const runtime = options.runtime ?? runtimeForPlatform(platform);
  const executable = options.executable
    ?? await resolveConfinementExecutable(
      platform,
      options.env ?? process.env,
      options.accessImpl ?? access,
    );
  const runDirectory = await (options.realpathImpl ?? realpath)(resolve(options.runDirectory));

  if (runtime === MACOS_RUNTIME) {
    const scratchDirectory = await (options.mkdtempImpl ?? mkdtemp)(
      join(MACOS_SCRATCH_ROOT, "bench-interactive-"),
    );
    const environment = writeConfinementEnvironment(
      options.env ?? process.env,
      scratchDirectory,
    );
    return {
      command: executable,
      args: [
        "-p",
        createSeatbeltProfile(runDirectory),
        "--",
        ...piRuntimeBootstrap(command, args, options.env ?? process.env, environment),
      ],
      env: environment,
      runtime: { platform, runtime, executable },
      runDirectory,
      scratchDirectory,
      cleanup: () => (options.rmImpl ?? rm)(scratchDirectory, { recursive: true, force: true }),
    };
  }

  if (runtime === LINUX_RUNTIME) {
    const environment = writeConfinementEnvironment(
      options.env ?? process.env,
      LINUX_SCRATCH_DIRECTORY,
    );
    return {
      command: executable,
      args: [
        "--die-with-parent",
        "--ro-bind", "/", "/",
        "--dev-bind", "/dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--dir", LINUX_SCRATCH_DIRECTORY,
        "--bind", runDirectory, runDirectory,
        "--chdir", runDirectory,
        "--",
        ...piRuntimeBootstrap(command, args, options.env ?? process.env, environment),
      ],
      env: environment,
      runtime: { platform, runtime, executable },
      runDirectory,
      scratchDirectory: LINUX_SCRATCH_DIRECTORY,
      cleanup: async () => {},
    };
  }

  throw unsupportedPlatformError(platform);
}

export function createSeatbeltProfile(runDirectory) {
  const runPath = schemeString(resolve(runDirectory));
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* (subpath ${runPath}))`,
    `(allow file-write* (subpath ${schemeString(MACOS_SCRATCH_ROOT)}))`,
    `(allow file-write* (subpath ${schemeString("/dev")}))`,
  ].join("\n");
}

export function writeConfinementEnvironment(source, scratchDirectory) {
  return {
    ...source,
    PI_CODING_AGENT_DIR: join(scratchDirectory, "pi-agent"),
    TMPDIR: scratchDirectory,
    TMP: scratchDirectory,
    TEMP: scratchDirectory,
    UV_CACHE_DIR: join(scratchDirectory, "uv-cache"),
    PIP_CACHE_DIR: join(scratchDirectory, "pip-cache"),
    npm_config_cache: join(scratchDirectory, "npm-cache"),
    PYTHONPYCACHEPREFIX: join(scratchDirectory, "python-cache"),
    MPLCONFIGDIR: join(scratchDirectory, "matplotlib"),
  };
}

export function writeConfinementMetadata(runtime, diagnostics) {
  return {
    mode: WRITE_CONFINEMENT_MODE,
    runtime: runtime.runtime,
    platform: runtime.platform,
    filesystem: "run-slot-and-temporary-write",
    reads: "host-readable",
    network: "host-access",
    diagnostics,
  };
}

export function confinementInstallAdvice(platform = process.platform) {
  if (platform === "linux") {
    return "Install Bubblewrap with your system package manager and enable unprivileged user namespaces.";
  }
  if (platform === "darwin") {
    return "This macOS version must provide /usr/bin/sandbox-exec.";
  }
  return "Interactive Visual and Data Science runs require macOS or Linux.";
}

async function resolveConfinementExecutable(platform, environment, accessImpl) {
  if (platform === "darwin") {
    try {
      await accessImpl(MACOS_EXECUTABLE, fsConstants.X_OK);
      return MACOS_EXECUTABLE;
    } catch {
      throw new BenchError([
        "Interactive write confinement is unavailable.",
        confinementInstallAdvice(platform),
      ].join("\n"));
    }
  }

  if (platform === "linux") {
    const executable = await findExecutable("bwrap", environment, accessImpl);
    if (executable) return executable;
    throw new BenchError([
      "Interactive write confinement is unavailable.",
      confinementInstallAdvice(platform),
    ].join("\n"));
  }

  throw unsupportedPlatformError(platform);
}

function runtimeForPlatform(platform) {
  if (platform === "darwin") return MACOS_RUNTIME;
  if (platform === "linux") return LINUX_RUNTIME;
  throw unsupportedPlatformError(platform);
}

function confinementProbe(runtime, executable) {
  if (runtime === MACOS_RUNTIME) {
    return {
      command: executable,
      args: ["-p", "(version 1)\n(allow default)\n(deny file-write*)", "--", "/usr/bin/true"],
    };
  }

  return {
    command: executable,
    args: [
      "--die-with-parent",
      "--ro-bind", "/", "/",
      "--dev-bind", "/dev", "/dev",
      "--proc", "/proc",
      "--tmpfs", "/tmp",
      "--",
      "/bin/true",
    ],
  };
}

function runProbe(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const child = (options.spawnImpl ?? spawn)(command, args, {
      env: options.env,
      stdio: "ignore",
    });
    const finish = (status) => {
      if (settled) return;
      settled = true;
      resolvePromise({ status });
    };
    child.once("error", () => finish(1));
    child.once("close", (code, signal) => finish(signal ? 1 : code ?? 1));
  });
}

async function findExecutable(command, environment, accessImpl) {
  const pathValue = environment.PATH ?? "";
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = resolve(directory, command);
    try {
      await accessImpl(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep searching the inherited PATH.
    }
  }
  return null;
}

function piRuntimeBootstrap(command, args, sourceEnvironment, runtimeEnvironment) {
  const sourceAgentDirectory = sourceEnvironment.PI_CODING_AGENT_DIR
    ?? join(sourceEnvironment.HOME ?? homedir(), ".pi", "agent");
  return [
    "/bin/sh",
    "-c",
    PI_RUNTIME_BOOTSTRAP,
    "bench-pi-bootstrap",
    sourceAgentDirectory,
    runtimeEnvironment.PI_CODING_AGENT_DIR,
    command,
    ...args,
  ];
}

function schemeString(value) {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

function runtimeLabel(runtime) {
  return runtime === MACOS_RUNTIME ? "macOS Seatbelt" : "Bubblewrap";
}

function unsupportedPlatformError(platform) {
  return new BenchError(`Interactive write confinement is not supported on ${platform}`);
}
