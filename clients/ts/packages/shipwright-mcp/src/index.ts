export type ExecutableKind = "cli" | "lsp" | "mcp" | "sidecar" | "dap" | "tool";
export type RuntimeLanguage = "rust" | "dotnet" | "dart" | "typescript" | "kotlin" | "javascript";

export interface Result<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface PackageMetadata {
  name?: string;
  version?: string;
}

export interface ServerInfo {
  name: string;
  version: string;
}

export interface VersionSpec {
  name: string;
  version: string;
  kind: ExecutableKind;
  language: RuntimeLanguage;
  buildTime?: string;
  capabilities?: string[];
  gitDirty?: boolean;
  gitSha?: string;
  product?: string;
  target?: string;
  toolchain?: string;
}

export interface VersionManifest {
  manifestVersion: 1;
  name: string;
  version: string;
  kind: ExecutableKind;
  language: RuntimeLanguage;
  buildTime?: string;
  capabilities?: string[];
  gitDirty?: boolean;
  gitSha?: string;
  product?: string;
  target?: string;
  toolchain?: string;
}

export interface VersionCommandResult {
  handled: boolean;
  stdout: string;
}

const namePattern = /^[a-z0-9][a-z0-9-]{1,63}$/;
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function createMcpServerInfo(metadata: PackageMetadata, componentName?: string): Result<ServerInfo> {
  const name = componentName ?? metadata.name;
  if (!name || !namePattern.test(name)) {
    return err("MCP serverInfo.name must be a shipwright component id");
  }
  if (!metadata.version || !semverPattern.test(metadata.version)) {
    return err("MCP serverInfo.version must be a semantic version");
  }
  return ok({ name, version: metadata.version });
}

export function createVersionManifest(spec: VersionSpec): Result<VersionManifest> {
  const validation = validateSpec(spec);
  if (!validation.ok) return err(validation.error ?? "invalid version spec");

  const manifest: VersionManifest = {
    manifestVersion: 1,
    name: spec.name,
    version: spec.version,
    kind: spec.kind,
    language: spec.language,
  };

  if (spec.buildTime) manifest.buildTime = spec.buildTime;
  if (spec.capabilities && spec.capabilities.length > 0) manifest.capabilities = [...spec.capabilities];
  if (spec.gitDirty !== undefined) manifest.gitDirty = spec.gitDirty;
  if (spec.gitSha) manifest.gitSha = spec.gitSha;
  if (spec.product) manifest.product = spec.product;
  if (spec.target) manifest.target = spec.target;
  if (spec.toolchain) manifest.toolchain = spec.toolchain;

  return ok(manifest);
}

export function formatPlainVersion(spec: VersionSpec): Result<string> {
  const validation = validateSpec(spec);
  if (!validation.ok) return err(validation.error ?? "invalid version spec");
  return ok(`${spec.name} ${spec.version}\n`);
}

export function formatJsonVersion(spec: VersionSpec): Result<string> {
  const manifest = createVersionManifest(spec);
  if (!manifest.ok || !manifest.value) return err(manifest.error ?? "invalid version manifest");
  return ok(`${JSON.stringify(manifest.value)}\n`);
}

export function handleVersionArgs(args: readonly string[], spec: VersionSpec): Result<VersionCommandResult> {
  const mode = versionMode(args);
  if (mode === "none") {
    return ok({ handled: false, stdout: "" });
  }

  const rendered = mode === "json" ? formatJsonVersion(spec) : formatPlainVersion(spec);
  if (!rendered.ok || rendered.value === undefined) return err(rendered.error ?? "version rendering failed");
  return ok({ handled: true, stdout: rendered.value });
}

function validateSpec(spec: VersionSpec): Result<void> {
  if (!namePattern.test(spec.name)) return err("version spec name must be a component id");
  if (!semverPattern.test(spec.version)) return err("version spec version must be semantic");
  if (spec.product && !namePattern.test(spec.product)) return err("version spec product must be a product id");
  if (spec.gitSha && !/^[0-9a-f]{7,40}$/.test(spec.gitSha)) return err("version spec gitSha must be lowercase hex");
  return ok(undefined);
}

function versionMode(args: readonly string[]): "json" | "none" | "plain" {
  const hasVersion = args.includes("--version") || args.includes("-V");
  const hasJson = args.includes("--json") || (args.includes("--format") && args.includes("json"));
  if (!hasVersion) return "none";
  return hasJson ? "json" : "plain";
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(error: string): Result<T> {
  return { ok: false, error };
}
