export type Source =
  | "user-setting"
  | "env"
  | "path"
  | "bundled"
  | "pkgmgr"
  | "dotnet-tool"
  | "npm-global"
  | "cargo-bin"
  | "github-release"
  | "lsp-initialize";

export type Platform =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-x64"
  | "linux-arm64"
  | "win32-x64"
  | "win32-arm64"
  | "all";

export type Status = "ok" | "ok-with-warning" | "deferred" | "prompt" | "error";
export type WarningCode = "env-version-mismatch" | "bundled-version-drift";
export type ErrorCode = "user-setting-version-mismatch" | "no-source-resolved" | "binary-name-mismatch";
export type DeferredCheck = "lsp-initialize";

export interface ProbedVersion {
  name: string;
  version: string;
}

export type Probe = (path: string) => ProbedVersion | undefined;

export interface EnvConfig {
  pathVar?: string;
  dirVar?: string;
}

export interface PkgmgrConfig {
  brew?: string;
  scoop?: string;
  apt?: string;
  winget?: string;
}

export interface DotnetToolConfig {
  package: string;
  command?: string;
}

export interface ResolveInput {
  binaryName: string;
  expectedName?: string;
  expectedVersion: string;
  sources: Source[];
  platform?: Platform;
  userSettingPath?: string | null;
  env?: Record<string, string>;
  envConfig?: EnvConfig;
  path?: string[];
  bundledDir?: string | null;
  cargoBin?: string;
  pkgmgr?: PkgmgrConfig;
  dotnetTool?: DotnetToolConfig;
}

export type PromptAction =
  | { kind: "pkgmgr-install"; commands: Record<string, string> }
  | { kind: "dotnet-tool-update"; command: string };

export interface Resolution {
  source: Source | null;
  path?: string | null;
  version?: string | null;
  status: Status;
  warningCode?: WarningCode;
  errorCode?: ErrorCode;
  errorDetails?: {
    expected: string;
    found: string;
    at: string;
  };
  action?: PromptAction;
  deferredCheck?: DeferredCheck;
}

// ── Canonical path helpers ─────────────────────────────────────────────
// ALL path construction MUST go through these functions.  There is exactly
// ONE way to join a directory + binary name, and it lives here.
// shipwright-vscode (and every other host) MUST import these — never
// re-implement path joining.

/** Platform-native path separator: `\` on win32, `/` everywhere else. */
export function platformSeparator(platform: Platform): string {
  return platform === "win32-x64" || platform === "win32-arm64" ? "\\" : "/";
}

/** `.exe` on win32 platforms, empty string everywhere else. */
export function exeSuffix(platform: Platform): string {
  return platform === "win32-x64" || platform === "win32-arm64" ? ".exe" : "";
}

/** Binary name with platform-appropriate executable suffix. */
export function executableName(binaryName: string, platform: Platform): string {
  return `${binaryName}${exeSuffix(platform)}`;
}

/**
 * Join a directory and binary name using the platform's native separator.
 * This is THE ONLY function that constructs binary paths from components.
 */
export function joinBinary(dir: string, binaryName: string, platform: Platform): string {
  const sep = platformSeparator(platform);
  const needsSep = dir.length > 0 && !dir.endsWith("/") && !dir.endsWith("\\");
  return `${dir}${needsSep ? sep : ""}${binaryName}${exeSuffix(platform)}`;
}

/**
 * Determine if a PATH entry already points at the binary file, or if it
 * is a directory that needs the binary name appended.
 */
export function pathCandidate(entry: string, binaryName: string, platform: Platform): string {
  const expectedFile = executableName(binaryName, platform);
  if (entry.endsWith(`/${expectedFile}`) || entry.endsWith(`\\${expectedFile}`) || entry === expectedFile) {
    return entry;
  }
  return joinBinary(entry, binaryName, platform);
}

/** Resolve the binary path from environment variables. */
export function envPath(input: ResolveInput, platform: Platform): string | undefined {
  const env = input.env ?? {};
  const config = input.envConfig ?? {};
  if (config.pathVar && env[config.pathVar]) {
    return env[config.pathVar];
  }
  const configuredDir = config.dirVar ? env[config.dirVar] : undefined;
  if (configuredDir) {
    return joinBinary(configuredDir, input.binaryName, platform);
  }
  return undefined;
}

// ── Resolver ──────────────────────────────────────────────────────────

export function resolve(input: ResolveInput, probe: Probe): Resolution {
  let deferredPath: { source: Source; path: string } | undefined;
  const platform = input.platform ?? "darwin-arm64";

  for (const source of input.sources) {
    if (source === "user-setting" && input.userSettingPath) {
      const path = input.userSettingPath;
      const got = probe(path);
      if (!got) {
        return userSettingMismatch(input, "", path);
      }
      if (!nameMatches(input, got)) {
        return error("binary-name-mismatch");
      }
      if (got.version !== input.expectedVersion) {
        return userSettingMismatch(input, got.version, path);
      }
      return ok(source, path, got.version);
    }

    if (source === "env") {
      const path = envPath(input, platform);
      if (!path) continue;
      const got = probe(path);
      if (!got) continue;
      if (!nameMatches(input, got)) {
        return error("binary-name-mismatch");
      }
      if (got.version === input.expectedVersion) {
        return ok(source, path, got.version);
      }
      return okWithWarning(source, path, got.version, "env-version-mismatch");
    }

    if (source === "path") {
      for (const entry of input.path ?? []) {
        const candidate = pathCandidate(entry, input.binaryName, platform);
        const got = probe(candidate);
        if (!got) continue;
        if (!nameMatches(input, got)) {
          return error("binary-name-mismatch");
        }
        if (got.version === input.expectedVersion) {
          return ok(source, candidate, got.version);
        }
      }
    }

    if (source === "bundled" && input.bundledDir) {
      const candidate = joinBinary(input.bundledDir, input.binaryName, platform);
      const got = probe(candidate);
      if (!got) continue;
      if (!nameMatches(input, got)) {
        return error("binary-name-mismatch");
      }
      if (got.version === input.expectedVersion) {
        return ok(source, candidate, got.version);
      }
      return okWithWarning(source, candidate, got.version, "bundled-version-drift");
    }

    if (source === "cargo-bin" && input.cargoBin) {
      const got = probe(input.cargoBin);
      if (got) {
        if (!nameMatches(input, got)) {
          return error("binary-name-mismatch");
        }
        if (got.version === input.expectedVersion) {
          return ok(source, input.cargoBin, got.version);
        }
      }
      deferredPath = { source, path: input.cargoBin };
    }

    if (source === "dotnet-tool" && input.dotnetTool) {
      const command = input.dotnetTool.command ?? input.binaryName;
      const got = probe(command);
      if (!got) continue;
      if (!nameMatches(input, got)) {
        return error("binary-name-mismatch");
      }
      if (got.version === input.expectedVersion) {
        return ok(source, command, got.version);
      }
      return {
        source: null,
        path: null,
        version: null,
        status: "prompt",
        action: {
          kind: "dotnet-tool-update",
          command: `dotnet tool update -g ${input.dotnetTool.package} --version ${input.expectedVersion}`
        }
      };
    }

    if (source === "pkgmgr" && input.pkgmgr) {
      return {
        source: null,
        path: null,
        version: null,
        status: "prompt",
        action: { kind: "pkgmgr-install", commands: pkgmgrCommands(input.pkgmgr) }
      };
    }

    if (source === "lsp-initialize" && deferredPath) {
      return {
        source: deferredPath.source,
        path: deferredPath.path,
        version: null,
        status: "deferred",
        deferredCheck: "lsp-initialize"
      };
    }
  }

  return error("no-source-resolved");
}

function ok(source: Source, path: string, version: string): Resolution {
  return { source, path, version, status: "ok" };
}

function okWithWarning(source: Source, path: string, version: string, warningCode: WarningCode): Resolution {
  return { source, path, version, status: "ok-with-warning", warningCode };
}

function error(errorCode: ErrorCode): Resolution {
  return { source: null, path: null, version: null, status: "error", errorCode };
}

function userSettingMismatch(input: ResolveInput, found: string, at: string): Resolution {
  return {
    source: null,
    path: null,
    version: null,
    status: "error",
    errorCode: "user-setting-version-mismatch",
    errorDetails: { expected: input.expectedVersion, found, at }
  };
}

function nameMatches(input: ResolveInput, got: ProbedVersion): boolean {
  return got.name === (input.expectedName ?? input.binaryName);
}


function pkgmgrCommands(pkgmgr: PkgmgrConfig): Record<string, string> {
  const commands: Record<string, string> = {};
  if (pkgmgr.brew) {
    commands["darwin-arm64"] = `brew install ${pkgmgr.brew}`;
    commands["darwin-x64"] = `brew install ${pkgmgr.brew}`;
    commands["linux-arm64"] = `brew install ${pkgmgr.brew}`;
    commands["linux-x64"] = `brew install ${pkgmgr.brew}`;
  }
  if (pkgmgr.scoop) {
    commands["win32-arm64"] = `scoop install ${pkgmgr.scoop}`;
    commands["win32-x64"] = `scoop install ${pkgmgr.scoop}`;
  }
  return commands;
}
