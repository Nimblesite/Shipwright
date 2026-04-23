# Deployment Toolkit Library Architecture Spec

Status: Draft

## Purpose

This repo will provide shared libraries and tooling for deploying Nimblesite binaries and IDE extensions. Product repos should stop maintaining bespoke version parsers, platform directory conventions, package manifests, and startup checks.

## Libraries

### Rust

`deployment-toolkit-version`

- Adds a standard `--version` implementation for Rust binaries.
- Exposes plain text and JSON version metadata.
- Provides helpers for Clap-based CLIs and manual argument parsing.
- Reads `CARGO_PKG_NAME`, `CARGO_PKG_VERSION`, target triple, and optional git metadata.

`deployment-toolkit-manifest`

- Defines the product deployment manifest data model.
- Validates component ids, versions, platform names, checksums, and required flags.
- Generates target-specific asset names.

`deployment-toolkit-release`

- Builds release manifests from product build outputs.
- Verifies every produced binary reports the expected version.
- Emits checksums and package contents for VSIX, JetBrains, Zed, npm, cargo, and dotnet tool workflows.

### TypeScript

`@nimblesite/deployment-toolkit-vscode`

- Loads `deployment-toolkit.json` from a VS Code extension.
- Resolves configured, bundled, cached, and PATH binaries.
- Runs `--version` through `execFile` or `spawn` without a shell.
- Prepends matching bundled directories to the extension process PATH when needed.
- Returns structured diagnostics and user-facing messages.

`@nimblesite/deployment-toolkit-common`

- Owns JSON schemas, platform ids, error types, and manifest parsing shared by VS Code and build scripts.

### Kotlin / JetBrains

`deployment-toolkit-jetbrains`

- Loads plugin-root manifests.
- Resolves user-configured, bundled, and PATH binaries.
- Runs version checks using `GeneralCommandLine`.
- Converts failures into JetBrains notifications and Event Log entries.
- Provides LSP descriptor helpers so products do not reimplement path search.

### .NET

`Nimblesite.DeploymentToolkit.Versioning`

- Adds `--version` handling to .NET sidecars and global tools.
- Reads package version from assembly metadata.
- Emits the same plain text and JSON contract as Rust and Node.

### Node

`@nimblesite/deployment-toolkit-node`

- Adds `--version` handling for npm binaries.
- Generates MCP server `serverInfo.version` from package metadata.
- Prevents hard-coded server versions drifting from `package.json`.

## CLI Tool

`deployment-toolkit`

The repo should eventually produce a CLI used by product repos and CI:

```text
deployment-toolkit verify-manifest
deployment-toolkit verify-binaries --manifest deployment-toolkit.json
deployment-toolkit package-vsix
deployment-toolkit package-jetbrains
deployment-toolkit release-assets
deployment-toolkit repair
```

The CLI must be product-agnostic and driven by the manifest.

## Manifest Model

Core entities:

| Entity | Meaning |
| --- | --- |
| Product | A tool family such as Deslop, Basilisk, Forge, or Too Many Cooks. |
| Package | A distributable artifact such as VSIX, JetBrains plugin, npm package, cargo crate, dotnet tool, or Zed extension. |
| Component | A runtime executable or config payload required by a package. |
| Resolver | Host-specific logic that locates and validates a component. |
| Verification | Version, checksum, platform, and protocol checks before startup or release. |

The manifest must support native binaries, .NET tools, Node binaries, WASM/Zed extension libraries, config payloads, and helper executables.

## Integration Pattern

Product repos should integrate in this order:

1. Add the version library to every binary and sidecar.
2. Add `deployment-toolkit.json` to each package.
3. Replace local editor resolver code with the shared host library.
4. Update release packaging to place binaries under standard `bin/<platform>` directories.
5. Add CI checks that run `deployment-toolkit verify-binaries`.

## Compatibility Rules

1. The manifest schema must be versioned.
2. Host libraries must reject newer incompatible manifest schemas.
3. Host libraries may warn on older compatible schemas.
4. Component kinds must be extensible so future products can add Intellij, Zed, Neovim, MCP-only, and CLI-only packages without changing existing fields.

## TODO

- [ ] Agree final crate, npm package, Kotlin module, and NuGet package names with `deployment_toolkit_open`.
- [ ] Define the first JSON schema and generate bindings for Rust and TypeScript.
- [ ] Decide whether the CLI should be Rust-first or Node-first for fastest integration with VSIX packaging.
