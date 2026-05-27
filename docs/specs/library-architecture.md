# Shipwright Library Architecture Spec

```
Spec prefix: SWR-ARCH-*
Status: Draft
```

## [SWR-ARCH-PURPOSE] Purpose

Shipwright provides shared libraries and tooling for deploying binaries and IDE extensions. The libraries use generic public package names and are designed for any team shipping language servers, MCP servers, sidecars, or CLI tools alongside IDE extensions.

Product repos stop maintaining bespoke version parsers, platform directory conventions, package manifests, and startup checks. Instead they adopt Shipwright and get consistent behavior across all host environments.

## [SWR-ARCH-LIBRARIES] Libraries

### Rust

**`shipwright`**
- Adds a standard `--version` implementation for Rust binaries.
- Exposes plain text and JSON version metadata.
- Reads `CARGO_PKG_NAME`, `CARGO_PKG_VERSION`, target triple, and optional build metadata.

**`shipwright-manifest`**
- Defines the `shipwright.json` product manifest data model.
- Validates component ids, versions, platform names, checksums, and required flags.
- Generates target-specific asset names.

**`shipwright-host`**
- Pure binary-resolution algorithm for IDE extension hosts.
- No I/O — the version-probe function is injected by the caller.
- Every resolver port must pass `schemas/test-vectors.json`.

**`shipwright-zed`**
- Zed editor host integration built on `shipwright-host`.

### TypeScript

**`@nimblesite/shipwright-vscode`**
- Loads `shipwright.json` from a VS Code extension.
- Resolves binaries using only the sources declared in the product's `shipwright.json` manifest.
- Runs `--version` through `execFile` or `spawn` without a shell.
- Returns structured diagnostics and user-facing messages.

**`@nimblesite/shipwright-core`**
- Canonical path construction: `joinBinary`, `pathCandidate`, `envPath`, `executableName`, `exeSuffix`, `platformSeparator`. All host packages (vscode, IntelliJ, Zed) MUST import these — never reimplement path joining.
- Pure `resolve()` algorithm: walks only the sources listed in the component's `sources` array with an injected probe callback. Products control their own cascade — e.g. `["user-setting", "bundled"]` for self-contained extensions that must never fall back to system binaries.
- Platform ids, error types, and type definitions shared across all hosts.

**`@nimblesite/shipwright-mcp`**
- Adds `--version` handling for npm/MCP binaries.
- Generates MCP server `serverInfo.version` from `package.json`.
- Prevents hard-coded server versions drifting from package metadata.

**`@nimblesite/shipwright-validate-manifest`**
- AJV-backed CLI for validating `shipwright.json` in product CI.

### .NET

**`Shipwright`** (library)
- Adds `--version` handling to .NET sidecars and global tools.
- Reads package version from assembly metadata.
- Emits the same plain text and JSON contract as Rust and Node.

**`Shipwright`** (global tool — `dotnet tool install -g Shipwright`)
- CLI for validating manifests, verifying binaries, and inspecting packages.

### Dart

**`shipwright`**
- Binary resolver and `--version` contract helpers for Dart/Flutter applications.

## [SWR-ARCH-VERSION-STAMP] Version-Stamping Tool

**`shipwright-version-stamp`**

Stamps a semver tag into every manifest file in the repo with a single command:

```bash
shipwright-version-stamp --tag v1.2.3 --root .
```

Supports: `Cargo.toml`, `package.json`, `*.csproj`, `pubspec.yaml`.

## [SWR-ARCH-MANIFEST-MODEL] Manifest Model

| Entity | Meaning |
| --- | --- |
| Product | A tool family with a stable id and version. |
| Component | A runtime executable or config payload required by a product. |
| Host | An IDE or runtime environment that resolves and launches components. |
| Resolver | Host-specific logic that locates and validates a component. |
| Verification | Version, checksum, platform, and protocol checks before startup or release. |

The manifest supports native binaries, .NET tools, Node binaries, WASM/Zed extension libraries, config payloads, and helper executables.

## [SWR-ARCH-INTEGRATION] Integration Pattern

Product repos integrate in this order:

1. Add `shipwright` (or the appropriate language library) to every binary and sidecar.
2. Add `shipwright.json` to each package.
3. Replace local editor resolver code with the appropriate host library.
4. Update release packaging to place binaries under standard `bin/<platform>` directories.
5. Add CI checks that validate the manifest and verify binaries.

## [SWR-ARCH-COMPAT-RULES] Compatibility Rules

1. The manifest schema is versioned via `manifestVersion`.
2. Host libraries must reject incompatible newer manifest schemas.
3. Host libraries may warn on older compatible schemas.
4. Component kinds are extensible — new host types can be added without breaking existing fields.
