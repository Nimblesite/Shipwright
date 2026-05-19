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

export type ExecFileCallback = (
  error: ExecFileError | null,
  stdout: string | Buffer,
  stderr: string | Buffer
) => void;

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
}

const defaultTimeoutMs = 1500;
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export async function probeBinaryVersion(
  file: string,
  options: ProbeBinaryVersionOptions = {}
): Promise<ProbedVersion | undefined> {
  const execFile = options.execFile ?? defaultExecFile;
  const timeout = options.timeoutMs ?? defaultTimeoutMs;

  try {
    const execOptions: ExecFileOptions = {
      timeout,
      windowsHide: true
    };
    if (options.env) execOptions.env = options.env;

    const stdout = await execFileStdout(execFile, file, ["--version"], execOptions);
    return parseVersionOutput(stdout);
  } catch {
    return undefined;
  }
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
