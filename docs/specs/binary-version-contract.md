# Binary Version Contract Spec

```
Spec prefix: SWR-VERSION-*
Status: Draft
```

## Purpose

All binaries, language servers, MCP servers, sidecars, helper tools, and CLI entry points managed by Shipwright must expose one consistent version contract. IDE extensions use this contract at startup to ensure the binaries they launch match the extension package that installed or selected them.

The contract prevents an extension from launching the wrong server, stale sidecar, old MCP tool, or incompatible CLI.

## Required `--version` Behavior

Every executable component MUST support:

```bash
<binary> --version
```

The command MUST:

1. Exit with status code `0`.
2. Complete within 1500 ms on a normal developer machine.
3. Avoid starting the real LSP, MCP, server, watcher, or sidecar runtime.
4. Avoid network access, workspace scanning, config mutation, or cache writes.
5. Print exactly one parseable first line to stdout:

```text
<component-id> <semantic-version>
```

Example:

```text
my-tool-lsp 1.2.3
```

Stderr SHOULD be empty for `--version`. If a platform runtime writes unavoidable warnings, the version parser MUST only trust the first stdout line.

## JSON Version Output

Every component SHOULD also support:

```bash
<binary> --version --json
```

The JSON shape must conform to `schemas/version-manifest.schema.json`:

```json
{
  "manifestVersion": 1,
  "name": "my-tool-lsp",
  "version": "1.2.3",
  "kind": "lsp",
  "language": "rust"
}
```

The plain text contract is mandatory because it works for existing tools and simple shell tests. The JSON form is for richer diagnostics and future compatibility checks.

## Protocol Handshake Version

Long-running components MUST report the same version during protocol initialization.

LSP servers MUST set `InitializeResult.serverInfo`:

```json
{
  "name": "my-tool-lsp",
  "version": "1.2.3"
}
```

MCP servers MUST set `serverInfo` in the initialize response:

```json
{
  "name": "my-tool-mcp",
  "version": "1.2.3"
}
```

Custom sidecar protocols MUST either support `--version` before launch or send a first hello frame before doing work:

```json
{
  "type": "hello",
  "componentId": "my-tool-sidecar",
  "version": "1.2.3"
}
```

## Matching Rules

The expected version comes from `shipwright.json`. Version comparison rules:

1. Strip one optional leading `v` before comparison.
2. Compare the complete semantic version string after normalization.
3. Preserve and compare pre-release identifiers exactly.
4. Preserve and compare build metadata exactly unless the manifest declares `ignoreBuildMetadata: true`.
5. Treat an unparsable or missing version as a mismatch.

User overrides MUST NOT bypass this check. A configured path, environment override, bundled binary, downloaded asset, or repair-installed binary all go through the same comparison.

## [SWR-VERSION-BUILD-STAMPING] Build-Time Version Stamping

Source-controlled version files SHOULD use the valid semantic placeholder `0.0.0-dev`.
Release and package jobs MUST treat the release version as an explicit build input and stamp the
runner working tree before compiling, verifying, or packaging artifacts.

Rules:

1. The tag-triggered release MUST build the exact tagged source SHA.
2. Release jobs MUST NOT commit, push, or move source-control refs after the tag exists.
3. Stamping MUST be implemented as a first-class script or build target that accepts the version.
4. Tests MUST be able to pass an arbitrary semantic version into the same stamper.
5. Stamping MUST update every deployed version carrier: project manifests, package manifests,
   lock files that carry project versions, `shipwright.json` product version, and every component
   `expectedVersion`.
6. Stamping MUST use structured parsers for structured files. Ad hoc `sed` rewrites of JSON, YAML,
   TOML, XML, or lock files are not acceptable.

## Product Manifest

Each package that launches binaries MUST include `shipwright.json`. Minimal example:

```json
{
  "manifestVersion": 1,
  "product": {
    "id": "my-tool",
    "version": "0.0.0-dev"
  },
  "components": [
    {
      "id": "my-tool-lsp",
      "kind": "lsp",
      "language": "rust",
      "binaryName": "my-tool-lsp",
      "expectedVersion": "0.0.0-dev",
      "required": true
    }
  ]
}
```

The manifest is the single source of truth for startup validation, package assembly, release checks, and CI tests.

## Language Bindings

Rust binaries MUST use `shipwright` to wire version output from `CARGO_PKG_VERSION` and build metadata.

.NET binaries and dotnet tools MUST use `Shipwright` to wire version output from MSBuild package metadata.

Node/MCP binaries MUST use `@nimblesite/shipwright-mcp` to derive `serverInfo.version` from `package.json`. Hard-coded server versions are forbidden.

IDE extensions MUST use `@nimblesite/shipwright-vscode`, `shipwright-host`, or the appropriate host library instead of custom per-product parsers.

## Test Requirements

Every product repo MUST include tests that prove:

1. Each binary exits `0` for `--version`.
2. The first stdout line is exactly `<component-id> <version>`.
3. Protocol initialization reports the same version.
4. A mismatched configured path causes a visible startup error.
5. A matching bundled binary starts successfully.
6. Test-time version stamping updates every deployed version carrier.
7. A packaged artifact contains the stamped manifest and binaries reporting the stamped version.
