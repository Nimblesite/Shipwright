#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";

const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export async function runCli(argv, io = process) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) return exitWithUsage(parsed.error, io);

  const result = parsed.value.command === "verify-binaries"
    ? verifyBinaries(parsed.value.options)
    : await verifyExtensionPackage(parsed.value.options);

  if (!result.ok) {
    io.stderr.write(`${result.error}\n`);
    return 1;
  }
  io.stdout.write(`${result.value}\n`);
  return 0;
}

export function verifyBinaries(options) {
  const manifest = readManifest(options.manifest);
  if (!manifest.ok) return manifest;

  const root = options.root ?? dirnameOf(options.manifest);
  const components = selectedExecutableComponents(manifest.value, options);
  if (components.length === 0) return err("no executable components selected for verification");

  for (const component of components) {
    const binaryPath = pathForComponent(component, manifest.value, options, root);
    const probed = probeVersion(binaryPath);
    if (!probed.ok) return err(`${component.id}: ${probed.error}`);
    const expected = expectedVersion(component, manifest.value);
    if (probed.value.name !== component.id) {
      return err(`${component.id}: expected name ${component.id}, found ${probed.value.name}`);
    }
    if (probed.value.version !== expected) {
      return err(`${component.id}: expected ${expected}, found ${probed.value.version}`);
    }
  }

  return ok(`verified ${components.length} binaries`);
}

export async function verifyExtensionPackage(options) {
  const manifest = readManifest(options.manifest);
  if (!manifest.ok) return manifest;

  const entries = await packageEntries(options.packagePath);
  if (!entries.ok) return entries;

  if (!entries.value.has("deployment-toolkit.json")) {
    return err("extension package is missing deployment-toolkit.json");
  }

  const expected = expectedPackageEntries(manifest.value, options.platform);
  for (const entry of expected) {
    if (!entries.value.has(entry)) return err(`extension package is missing ${entry}`);
  }

  for (const entry of entries.value) {
    if (entry.startsWith("bin/") && !expected.has(entry)) {
      return err(`extension package contains undeclared binary ${entry}`);
    }
  }

  return ok(`verified package with ${expected.size} bundled binaries`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "verify-binaries" && command !== "verify-extension-package") {
    return err("Usage: deploy-toolkit <verify-binaries|verify-extension-package> --manifest <path> [options]");
  }

  const options = { components: [], platform: "darwin-arm64" };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--manifest" && next) {
      options.manifest = resolve(next);
      index += 1;
    } else if (arg === "--platform" && next) {
      options.platform = next;
      index += 1;
    } else if (arg === "--root" && next) {
      options.root = resolve(next);
      index += 1;
    } else if (arg === "--bin-dir" && next) {
      options.binDir = resolve(next);
      index += 1;
    } else if (arg === "--component" && next) {
      options.components.push(next);
      index += 1;
    } else if (arg === "--package" && next) {
      options.packagePath = resolve(next);
      index += 1;
    } else {
      return err(`unknown or incomplete option: ${arg}`);
    }
  }

  if (!options.manifest) return err("--manifest is required");
  if (command === "verify-extension-package" && !options.packagePath) return err("--package is required");

  return ok({ command, options });
}

function readManifest(path) {
  try {
    return ok(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    return err(`failed to read manifest ${path}: ${error.message}`);
  }
}

function selectedExecutableComponents(manifest, options) {
  const selected = new Set(options.components);
  return manifest.components
    .filter((component) => component.binaryName && component.expectedVersion)
    .filter((component) => selected.size === 0 || selected.has(component.id))
    .filter((component) => supportsPlatform(component, options.platform));
}

function expectedPackageEntries(manifest, platform) {
  const entries = new Set();
  for (const component of manifest.components) {
    if (!component.bundled || !component.binaryName || !supportsPlatform(component, platform)) continue;
    entries.add(bundlePath(component, manifest, platform));
  }
  return entries;
}

function pathForComponent(component, manifest, options, root) {
  if (options.binDir) return join(options.binDir, executableName(component.binaryName, options.platform));
  if (component.bundled) return join(root, bundlePath(component, manifest, options.platform));
  return join(root, "bin", options.platform, executableName(component.binaryName, options.platform));
}

function bundlePath(component, manifest, platform) {
  const manifestPlatform = component.platforms?.includes(platform) ? platform : component.platforms?.includes("all") ? "all" : platform;
  return component.bundled.bundlePath
    .replaceAll("${platform}", manifestPlatform)
    .replaceAll("${binaryName}", component.binaryName)
    .replaceAll("${exe}", exeSuffix(platform));
}

function probeVersion(binaryPath) {
  try {
    const stdout = execFileSync(binaryPath, ["--version"], { encoding: "utf8", timeout: 1500 });
    return parseVersion(stdout);
  } catch (error) {
    return err(`failed to execute ${binaryPath}: ${error.message}`);
  }
}

function parseVersion(stdout) {
  const firstLine = stdout.trim().split(/\r?\n/, 1)[0];
  if (!firstLine) return err("version output was empty");
  if (firstLine.startsWith("{")) return parseJsonVersion(firstLine);

  const [name, version, extra] = firstLine.split(/\s+/);
  if (!name || !version || extra || !semverPattern.test(version)) {
    return err(`invalid version output: ${firstLine}`);
  }
  return ok({ name, version });
}

function parseJsonVersion(line) {
  try {
    const parsed = JSON.parse(line);
    if (!parsed.name || !parsed.version || !semverPattern.test(parsed.version)) {
      return err(`invalid JSON version output: ${line}`);
    }
    return ok({ name: parsed.name, version: parsed.version });
  } catch (error) {
    return err(`invalid JSON version output: ${error.message}`);
  }
}

async function packageEntries(packagePath) {
  if (!existsSync(packagePath)) return err(`package path does not exist: ${packagePath}`);
  if (statSync(packagePath).isDirectory()) return ok(walkPackageDirectory(packagePath));
  return listZipEntries(packagePath);
}

function walkPackageDirectory(root) {
  const entries = new Set();
  for (const file of walkFiles(root)) {
    entries.add(toPackagePath(relative(root, file)));
  }
  return entries;
}

function walkFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = join(root, entry.name);
    return entry.isDirectory() ? walkFiles(child) : [child];
  });
}

function listZipEntries(packagePath) {
  return new Promise((resolvePromise) => {
    yauzl.open(packagePath, { lazyEntries: true }, (openError, zip) => {
      if (openError || !zip) {
        resolvePromise(err(`failed to read package ${packagePath}: ${openError?.message ?? "unknown zip error"}`));
        return;
      }
      const entries = new Set();
      zip.readEntry();
      zip.on("entry", (entry) => {
        if (!entry.fileName.endsWith("/")) entries.add(toPackagePath(entry.fileName));
        zip.readEntry();
      });
      zip.on("end", () => resolvePromise(ok(entries)));
      zip.on("error", (zipError) => resolvePromise(err(`failed to read package ${packagePath}: ${zipError.message}`)));
    });
  });
}

function supportsPlatform(component, platform) {
  return !component.platforms || component.platforms.includes(platform) || component.platforms.includes("all");
}

function expectedVersion(component, manifest) {
  return component.expectedVersion.replaceAll("${PRODUCT_VERSION}", manifest.product.version);
}

function executableName(binaryName, platform) {
  return `${binaryName}${exeSuffix(platform)}`;
}

function exeSuffix(platform) {
  return platform === "win32-x64" || platform === "win32-arm64" ? ".exe" : "";
}

function toPackagePath(path) {
  return path.split(sep).join("/");
}

function dirnameOf(path) {
  return resolve(path, "..");
}

function exitWithUsage(message, io) {
  io.stderr.write(`${message}\n`);
  return 2;
}

function ok(value) {
  return { ok: true, value };
}

function err(error) {
  return { ok: false, error };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
