import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolve,
  type DotnetToolConfig,
  type EnvConfig,
  type PkgmgrConfig,
  type Platform,
  type ProbedVersion,
  type Resolution,
  type ResolveInput,
  type Source
} from "@nimblesite/shipwright-core";
import { probeBinaryVersion, type ExecFile } from "./probe.js";

export interface DeploymentManifest {
  manifestVersion: number;
  product: {
    id: string;
    displayName?: string;
    version: string;
  };
  components: ManifestComponent[];
  hosts?: {
    vscode?: HostPolicy;
  };
}

export interface ManifestComponent {
  id: string;
  kind: string;
  binaryName?: string;
  expectedVersion?: string;
  platforms?: Platform[];
  bundled?: {
    bundlePath: string;
    perPlatformArtifact?: boolean;
  };
  sources?: Source[];
  userSetting?: string;
  env?: EnvConfig;
  pkgmgr?: PkgmgrConfig;
  dotnetTool?: DotnetToolConfig;
  verifyStartup?: boolean;
  versionCheckStrategy?: "version-flag" | "version-flag-json" | "lsp-initialize";
  required?: boolean;
}

type ExecutableManifestComponent = ManifestComponent & {
  binaryName: string;
  expectedVersion: string;
  sources: Source[];
};

export interface HostPolicy {
  artifact?: string;
  activationVerifies?: string[];
  onMismatch?: "error" | "warn" | "prompt-reinstall" | "prompt-pkgmgr";
}

export interface ExtensionContextLike {
  extensionPath?: string;
  extensionUri?: {
    fsPath: string;
  };
}

export interface VscodeApiLike {
  workspace: {
    getConfiguration(section?: string): {
      get<T>(key: string): T | undefined;
    };
  };
  window: {
    showErrorMessage(message: string, options: { modal: boolean }, ...items: string[]): Promise<string | undefined> | string | undefined;
    showWarningMessage(message: string, options: { modal: boolean }, ...items: string[]): Promise<string | undefined> | string | undefined;
  };
}

export interface ActivateShipwrightOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  execFile?: ExecFile;
  manifestPath?: string;
  pathEntries?: string[];
  platform?: Platform;
  readText?: (file: string) => Promise<string>;
  showMessages?: boolean;
  timeoutMs?: number;
  vscode?: VscodeApiLike;
}

export interface ActivationDiagnostic {
  blocking: boolean;
  componentId: string;
  message: string;
  resolution: Resolution;
  selectedAction?: string;
}

export interface ActivationResult {
  diagnostics: ActivationDiagnostic[];
  manifest: DeploymentManifest;
  ok: boolean;
}

export async function activateShipwright(
  context: ExtensionContextLike,
  options: ActivateShipwrightOptions = {}
): Promise<ActivationResult> {
  const extensionRoot = extensionRootPath(context);
  const manifestPath = options.manifestPath ?? path.join(extensionRoot, "shipwright.json");
  const manifest = await loadShipwrightManifest(manifestPath, options.readText);
  const hostPolicy = manifest.hosts?.vscode;
  const platform = options.platform ?? detectPlatform(process.platform, process.arch);
  const env = normalizeEnv(options.env ?? process.env);
  const pathEntries = options.pathEntries ?? splitPath(env.PATH);
  const componentIds = hostPolicy?.activationVerifies ?? startupComponentIds(manifest.components);
  const diagnostics: ActivationDiagnostic[] = [];

  for (const componentId of componentIds) {
    const component = manifest.components.find((candidate) => candidate.id === componentId);
    if (!component) {
      diagnostics.push(missingComponentDiagnostic(componentId, manifest));
      continue;
    }

    if (!isSupportedOnPlatform(component, platform)) {
      diagnostics.push(unsupportedPlatformDiagnostic(component, manifest, platform));
      continue;
    }

    if (!isExecutableComponent(component)) {
      diagnostics.push(nonExecutableDiagnostic(component, manifest));
      continue;
    }

    const resolveContext: ResolveContext = {
      env,
      extensionRoot,
      pathEntries,
      platform
    };
    if (options.vscode) resolveContext.vscode = options.vscode;

    const input = toResolveInput(component, manifest, context, resolveContext);
    const probes = await probeCandidates(input, options);
    const resolution = resolve(input, (candidate) => probes.get(candidate));
    const diagnostic = diagnosticForResolution(component, manifest, resolution, hostPolicy);

    if (options.showMessages !== false && diagnostic.blocking) {
      const selectedAction = await showDiagnostic(options.vscode, diagnostic);
      if (selectedAction) diagnostic.selectedAction = selectedAction;
    }

    diagnostics.push(diagnostic);
  }

  return {
    diagnostics,
    manifest,
    ok: diagnostics.every((diagnostic) => !diagnostic.blocking)
  };
}

export async function loadShipwrightManifest(
  manifestPath: string,
  readText: (file: string) => Promise<string> = (file) => readFile(file, "utf8")
): Promise<DeploymentManifest> {
  return JSON.parse(await readText(manifestPath)) as DeploymentManifest;
}

export function detectPlatform(platform: NodeJS.Platform, arch: string): Platform {
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin") return "darwin-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "linux") return "linux-x64";
  if (platform === "win32" && arch === "arm64") return "win32-arm64";
  if (platform === "win32") return "win32-x64";
  return "linux-x64";
}

interface ResolveContext {
  env: Record<string, string>;
  extensionRoot: string;
  pathEntries: string[];
  platform: Platform;
  vscode?: VscodeApiLike;
}

function toResolveInput(
  component: ExecutableManifestComponent,
  manifest: DeploymentManifest,
  context: ExtensionContextLike,
  resolveContext: ResolveContext
): ResolveInput {
  const configuredPath = configuredBinaryPath(component, manifest, resolveContext.platform, resolveContext.vscode);
  const sources = configuredPath && !component.sources.includes("user-setting")
    ? (["user-setting", ...component.sources] as Source[])
    : component.sources;

  const input: ResolveInput = {
    binaryName: component.binaryName,
    expectedName: component.id,
    expectedVersion: resolveExpectedVersion(component.expectedVersion, manifest.product.version),
    sources,
    platform: resolveContext.platform,
    path: resolveContext.pathEntries,
    env: resolveContext.env
  };

  if (configuredPath) input.userSettingPath = configuredPath;
  if (component.env) input.envConfig = component.env;
  if (component.pkgmgr) input.pkgmgr = component.pkgmgr;
  if (component.dotnetTool) input.dotnetTool = component.dotnetTool;

  const bundledPath = bundledBinaryPath(component, resolveContext.extensionRoot, resolveContext.platform);
  if (bundledPath) {
    input.bundledDir = path.dirname(bundledPath);
  }

  if (component.sources.includes("cargo-bin")) {
    input.cargoBin = path.join(resolveContext.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo"), "bin", executableName(component.binaryName, resolveContext.platform));
  }

  return input;
}

async function probeCandidates(
  input: ResolveInput,
  options: Pick<ActivateShipwrightOptions, "env" | "execFile" | "timeoutMs">
): Promise<Map<string, ProbedVersion | undefined>> {
  const probes = new Map<string, ProbedVersion | undefined>();
  const candidates = candidatePaths(input);
  await Promise.all(
    candidates.map(async (candidate) => {
      const probeOptions = {
        env: normalizeEnv(options.env ?? process.env)
      };
      if (options.execFile) Object.assign(probeOptions, { execFile: options.execFile });
      if (options.timeoutMs !== undefined) Object.assign(probeOptions, { timeoutMs: options.timeoutMs });
      probes.set(candidate, await probeBinaryVersion(candidate, probeOptions));
    })
  );
  return probes;
}

function candidatePaths(input: ResolveInput): string[] {
  const candidates = new Set<string>();
  const platform = input.platform ?? "darwin-arm64";

  if (input.userSettingPath) candidates.add(input.userSettingPath);

  const envCandidate = envPath(input, platform);
  if (envCandidate) candidates.add(envCandidate);

  for (const entry of input.path ?? []) {
    candidates.add(pathCandidate(entry, input.binaryName, platform));
  }

  if (input.bundledDir) {
    candidates.add(path.join(input.bundledDir, executableName(input.binaryName, platform)));
  }

  if (input.cargoBin) candidates.add(input.cargoBin);

  if (input.dotnetTool) {
    candidates.add(input.dotnetTool.command ?? input.binaryName);
  }

  return [...candidates];
}

function configuredBinaryPath(
  component: ManifestComponent,
  manifest: DeploymentManifest,
  platform: Platform,
  vscode: VscodeApiLike | undefined
): string | undefined {
  const config = contextConfiguration(vscode);
  const explicitSetting = component.userSetting ?? `${manifest.product.id}.binaries.${component.id}`;
  const explicit = settingString(config, explicitSetting);
  if (explicit) return explicit;

  const directory = settingString(config, `${manifest.product.id}.binaries.path`);
  if (directory && component.binaryName) {
    return path.join(directory, executableName(component.binaryName, platform));
  }

  return undefined;
}

function contextConfiguration(vscode: VscodeApiLike | undefined): ReturnType<VscodeApiLike["workspace"]["getConfiguration"]> {
  if (vscode) return vscode.workspace.getConfiguration();
  return {
    get: () => undefined
  };
}

function settingString(config: { get<T>(key: string): T | undefined }, key: string): string | undefined {
  const value = config.get<unknown>(key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function diagnosticForResolution(
  component: ManifestComponent,
  manifest: DeploymentManifest,
  resolution: Resolution,
  hostPolicy: HostPolicy | undefined
): ActivationDiagnostic {
  const onMismatch = hostPolicy?.onMismatch ?? "error";
  const blocking = component.required !== false && resolution.status !== "ok" && resolution.status !== "deferred" && onMismatch !== "warn";
  return {
    blocking,
    componentId: component.id,
    message: formatDiagnosticMessage(component, manifest, resolution),
    resolution
  };
}

async function showDiagnostic(vscode: VscodeApiLike | undefined, diagnostic: ActivationDiagnostic): Promise<string | undefined> {
  if (!vscode) return undefined;

  const actionLabels = actionCommands(diagnostic.resolution);
  if (diagnostic.resolution.status === "prompt") {
    return vscode.window.showWarningMessage(diagnostic.message, { modal: true }, ...actionLabels);
  }

  return vscode.window.showErrorMessage(diagnostic.message, { modal: true }, ...actionLabels);
}

function actionCommands(resolution: Resolution): string[] {
  if (!resolution.action) return [];
  if (resolution.action.kind === "dotnet-tool-update") {
    return [resolution.action.command];
  }
  return [...new Set(Object.values(resolution.action.commands))];
}

function formatDiagnosticMessage(component: ManifestComponent, manifest: DeploymentManifest, resolution: Resolution): string {
  const productName = manifest.product.displayName ?? manifest.product.id;
  const expected = resolveExpectedVersion(component.expectedVersion ?? manifest.product.version, manifest.product.version);
  const found = resolution.errorDetails?.found || resolution.version || "not found";
  const at = resolution.errorDetails?.at || resolution.path || resolution.source || "no resolved source";

  if (resolution.status === "prompt") {
    return `${productName} needs ${component.id} ${expected}. Install or repair the matching binary before startup can continue.`;
  }

  if (resolution.errorCode === "binary-name-mismatch") {
    return `${productName} cannot start: ${component.id} reported the wrong component name. Expected ${component.id}.`;
  }

  if (resolution.status === "ok-with-warning") {
    return `${productName} cannot start: ${component.id} version mismatch. Expected ${expected}; found ${found} at ${at}.`;
  }

  if (resolution.status === "deferred") {
    return `${productName} will verify ${component.id} during protocol initialization.`;
  }

  return `${productName} cannot start: ${component.id} version check failed. Expected ${expected}; found ${found} at ${at}.`;
}

function missingComponentDiagnostic(componentId: string, manifest: DeploymentManifest): ActivationDiagnostic {
  return {
    blocking: true,
    componentId,
    message: `${manifest.product.displayName ?? manifest.product.id} cannot start: ${componentId} is listed in hosts.vscode.activationVerifies but is missing from components.`,
    resolution: {
      source: null,
      path: null,
      version: null,
      status: "error",
      errorCode: "no-source-resolved"
    }
  };
}

function unsupportedPlatformDiagnostic(component: ManifestComponent, manifest: DeploymentManifest, platform: Platform): ActivationDiagnostic {
  return {
    blocking: component.required !== false,
    componentId: component.id,
    message: `${manifest.product.displayName ?? manifest.product.id} cannot start: ${component.id} is not shipped for ${platform}.`,
    resolution: {
      source: null,
      path: null,
      version: null,
      status: "error",
      errorCode: "no-source-resolved"
    }
  };
}

function nonExecutableDiagnostic(component: ManifestComponent, manifest: DeploymentManifest): ActivationDiagnostic {
  return {
    blocking: component.required !== false,
    componentId: component.id,
    message: `${manifest.product.displayName ?? manifest.product.id} cannot start: ${component.id} does not declare binaryName, expectedVersion, and sources.`,
    resolution: {
      source: null,
      path: null,
      version: null,
      status: "error",
      errorCode: "no-source-resolved"
    }
  };
}

function startupComponentIds(components: ManifestComponent[]): string[] {
  return components
    .filter((component) => component.verifyStartup !== false && component.kind !== "asset")
    .map((component) => component.id);
}

function isSupportedOnPlatform(component: ManifestComponent, platform: Platform): boolean {
  return !component.platforms || component.platforms.includes(platform) || component.platforms.includes("all");
}

function isExecutableComponent(component: ManifestComponent): component is ExecutableManifestComponent {
  return Boolean(component.binaryName && component.expectedVersion && component.sources);
}

function bundledBinaryPath(component: ManifestComponent, extensionRoot: string, platform: Platform): string | undefined {
  if (!component.bundled || !component.binaryName) return undefined;
  const manifestPlatform = component.platforms?.includes(platform) ? platform : component.platforms?.includes("all") ? "all" : platform;
  const relative = component.bundled.bundlePath
    .replaceAll("${platform}", manifestPlatform)
    .replaceAll("${binaryName}", component.binaryName)
    .replaceAll("${exe}", exeSuffix(platform));
  return path.join(extensionRoot, relative);
}

function resolveExpectedVersion(expectedVersion: string, productVersion: string): string {
  return expectedVersion.replaceAll("${PRODUCT_VERSION}", productVersion);
}

function envPath(input: ResolveInput, platform: Platform): string | undefined {
  const env = input.env ?? {};
  const config = input.envConfig ?? {};
  if (config.pathVar && env[config.pathVar]) {
    return env[config.pathVar];
  }
  const configuredDir = config.dirVar ? env[config.dirVar] : undefined;
  if (configuredDir) {
    return path.join(configuredDir, executableName(input.binaryName, platform));
  }
  return undefined;
}

function pathCandidate(entry: string, binaryName: string, platform: Platform): string {
  const expectedFile = executableName(binaryName, platform);
  if (entry.endsWith(`/${expectedFile}`) || entry.endsWith(`\\${expectedFile}`) || entry.endsWith(expectedFile)) {
    return entry;
  }
  return path.join(entry, expectedFile);
}

function executableName(binaryName: string, platform: Platform): string {
  return `${binaryName}${exeSuffix(platform)}`;
}

function exeSuffix(platform: Platform): string {
  return platform === "win32-x64" || platform === "win32-arm64" ? ".exe" : "";
}

function splitPath(value: string | undefined): string[] {
  return value?.split(path.delimiter).filter(Boolean) ?? [];
}

function normalizeEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function extensionRootPath(context: ExtensionContextLike): string {
  return context.extensionUri?.fsPath ?? context.extensionPath ?? process.cwd();
}
