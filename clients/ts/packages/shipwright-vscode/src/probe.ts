import { execFile as nodeExecFile } from "node:child_process";
import type { ProbedVersion } from "@nimblesite/shipwright-core";

export interface ExecFileError extends Error {
  code?: number | string | null;
  killed?: boolean;
  signal?: NodeJS.Signals | string | null;
}

export interface ExecFileOptions {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  windowsHide?: boolean;
}

export type ExecFileCallback = (error: ExecFileError | null, stdout: string | Buffer, stderr: string | Buffer) => void;

export type ExecFile = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: ExecFileCallback
) => void;

export interface ProbeBinaryVersionOptions {
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFile;
  timeoutMs?: number;
  /** Retry once when the first attempt times out (first-run AV scan). Default true. */
  retryOnTimeout?: boolean;
}

/** Why a probe failed. Collapsing all of these into `undefined` is what made issue #5 undiagnosable. */
export type ProbeFailureReason = "timeout" | "not-found" | "permission-denied" | "launch-error" | "unparseable";

export interface ProbeFailure {
  reason: ProbeFailureReason;
  timedOut: boolean;
  code?: string | number | null;
  signal?: string | null;
}

export type ProbeResult = { ok: true; version: ProbedVersion } | { ok: false; failure: ProbeFailure };

// Issue #6: 1.5s is too tight for a ~10 MB unsigned NativeAOT exe whose first run triggers a
// Defender scan. 10s comfortably covers the first-run scan while still returning the instant the
// binary answers on the happy path. Hosts may override per-call via `timeoutMs`.
const defaultTimeoutMs = 10000;
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export async function probeBinaryVersion(
  file: string,
  options: ProbeBinaryVersionOptions = {}
): Promise<ProbedVersion | undefined> {
  const result = await probeBinaryVersionResult(file, options);
  return result.ok ? result.version : undefined;
}

/**
 * Probe `<file> --version`, returning either the parsed version or a structured failure reason.
 * Retries once on timeout (issue #6) so a first-run antivirus scan does not brick activation.
 */
export async function probeBinaryVersionResult(
  file: string,
  options: ProbeBinaryVersionOptions = {}
): Promise<ProbeResult> {
  const execFile = options.execFile ?? defaultExecFile;
  const timeout = options.timeoutMs ?? defaultTimeoutMs;
  const maxAttempts = options.retryOnTimeout === false ? 1 : 2;

  let failure: ProbeFailure = { reason: "launch-error", timedOut: false };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runProbeOnce(execFile, file, timeout, options.env);
    if (result.ok) return result;
    failure = result.failure;
    if (failure.reason !== "timeout") break;
  }
  return { ok: false, failure };
}

async function runProbeOnce(
  execFile: ExecFile,
  file: string,
  timeout: number,
  env: NodeJS.ProcessEnv | undefined
): Promise<ProbeResult> {
  const execOptions: ExecFileOptions = {
    timeout,
    windowsHide: true,
  };
  if (env) execOptions.env = env;

  try {
    const stdout = await execFileStdout(execFile, file, ["--version"], execOptions);
    const version = parseVersionOutput(stdout);
    if (version) return { ok: true, version };
    return { ok: false, failure: { reason: "unparseable", timedOut: false } };
  } catch (error) {
    // Safety: execFileStdout only rejects with the Node ExecFile error passed to its callback.
    return { ok: false, failure: classifyExecError(error as ExecFileError) };
  }
}

function classifyExecError(error: ExecFileError): ProbeFailure {
  if (error?.killed === true) {
    const signal = typeof error.signal === "string" ? error.signal : null;
    return { reason: "timeout", timedOut: true, signal };
  }
  const code = error?.code ?? null;
  if (code === "ENOENT") return { reason: "not-found", timedOut: false, code };
  if (code === "EACCES" || code === "EPERM") return { reason: "permission-denied", timedOut: false, code };
  return { reason: "launch-error", timedOut: false, code };
}

export function parseVersionOutput(stdout: string | Buffer): ProbedVersion | undefined {
  const text = stdout.toString("utf8").trim();
  if (!text) return undefined;

  const firstLine = text.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) return undefined;

  if (firstLine.startsWith("{")) {
    return parseJsonVersion(firstLine);
  }

  const [name, version, extra] = firstLine.split(/\s+/);
  if (!name || !version || extra || !semverPattern.test(version)) {
    return undefined;
  }

  return { name, version };
}

function parseJsonVersion(firstLine: string): ProbedVersion | undefined {
  try {
    // Safety: fields are narrowed with typeof checks below before use
    const parsed = JSON.parse(firstLine) as {
      componentId?: unknown;
      name?: unknown;
      version?: unknown;
    };
    const name = typeof parsed.componentId === "string" ? parsed.componentId : parsed.name;
    if (typeof name !== "string" || typeof parsed.version !== "string") {
      return undefined;
    }
    if (!semverPattern.test(parsed.version)) {
      return undefined;
    }
    return { name, version: parsed.version };
  } catch {
    return undefined;
  }
}

function execFileStdout(
  execFile: ExecFile,
  file: string,
  args: readonly string[],
  options: ExecFileOptions
): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

const defaultExecFile: ExecFile = (file, args, options, callback) => {
  nodeExecFile(file, [...args], options, (error, stdout, stderr) => {
    callback(error, stdout, stderr);
  });
};
