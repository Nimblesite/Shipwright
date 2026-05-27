export type ComponentKind =
  | "cli" | "lsp" | "mcp" | "sidecar" | "dap"
  | "tool" | "extension-vscode" | "extension-jetbrains" | "extension-zed" | "asset";

export type Language = "rust" | "dotnet" | "dart" | "typescript" | "kotlin" | "javascript";

export type PlatformId =
  | "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64"
  | "win32-x64" | "win32-arm64" | "all";

export type SourceId =
  | "user-setting" | "env" | "path" | "bundled" | "pkgmgr"
  | "dotnet-tool" | "npm-global" | "cargo-bin" | "github-release" | "lsp-initialize";

export type ArtifactType =
  | "vsix-per-platform" | "vsix-fat" | "intellij-jar" | "zed-wasm"
  | "archive" | "brew-formula" | "scoop-manifest" | "nuget" | "pub";

export type MismatchAction = "error" | "warn" | "prompt-reinstall" | "prompt-pkgmgr";

export interface Product {
  id: string;
  displayName?: string;
  version: string;
  repository?: string;
  homepage?: string;
}

export interface BundledConfig {
  bundlePath: string;
  perPlatformArtifact?: boolean;
}

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

export interface GithubReleaseConfig {
  repo?: string;
  assetPattern?: string;
  checksum?: boolean;
  cosign?: boolean;
}

export interface Component {
  id: string;
  kind: ComponentKind;
  language?: Language;
  binaryName?: string;
  expectedVersion?: string;
  platforms?: PlatformId[];
  bundled?: BundledConfig;
  sources?: SourceId[];
  userSetting?: string;
  env?: EnvConfig;
  pkgmgr?: PkgmgrConfig;
  dotnetTool?: { package: string; command?: string };
  npm?: { package?: string; bin?: string };
  githubRelease?: GithubReleaseConfig;
  verifyStartup?: boolean;
  versionCheckStrategy?: string;
  required?: boolean;
  asset?: Record<string, unknown>;
}

export interface HostPolicy {
  artifact?: ArtifactType;
  activationVerifies?: string[];
  onMismatch?: MismatchAction;
}

export interface ShipwrightManifest {
  manifestVersion: number;
  product: Product;
  components: Component[];
  hosts?: Record<string, HostPolicy>;
}

export const ALL_PLATFORMS: PlatformId[] = [
  "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64",
  "win32-x64", "win32-arm64", "all",
];

export const ALL_KINDS: ComponentKind[] = [
  "cli", "lsp", "mcp", "sidecar", "dap", "tool",
  "extension-vscode", "extension-jetbrains", "extension-zed", "asset",
];

export const ALL_SOURCES: SourceId[] = [
  "user-setting", "env", "path", "bundled", "pkgmgr",
  "dotnet-tool", "npm-global", "cargo-bin", "github-release", "lsp-initialize",
];

export function tryParseManifest(text: string): ShipwrightManifest | undefined {
  try {
    const obj: unknown = JSON.parse(text);
    if (typeof obj === "object" && obj !== null && "manifestVersion" in obj) {
      return obj as ShipwrightManifest;
    }
  } catch {
    /* invalid JSON */
  }
  return undefined;
}
