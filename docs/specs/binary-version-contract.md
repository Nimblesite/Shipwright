# Binary Version Contract Spec

Status: Draft

## Purpose

All Nimblesite binaries, language servers, MCP servers, sidecars, helper tools, and CLI entry points must expose one consistent version contract. IDE extensions use this contract at startup to ensure the binaries they launch match the extension package that installed or selected them.

The contract exists to prevent an extension package from launching the wrong server, stale sidecar, old MCP tool, or incompatible CLI.

## Required `--version` Behavior

Every executable component MUST support:

```text
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
forge-sidecar-csharp 0.1.0
```

Stderr SHOULD be empty for `--version`. If a platform runtime writes unavoidable warnings, the version parser MUST only trust the first stdout line.

## JSON Version Output

Every component SHOULD also support:

```text
<binary> --version --format json
```

The JSON shape is:

```json
{
  "schemaVersion": 1,
  "componentId": "deslop-lsp",
  "version": "0.1.0",
  "productId": "deslop",
  "target": "darwin-arm64",
  "commit": "optional-git-sha",
  "buildProfile": "release"
}
```

The plain text contract is mandatory because it works for existing tools and simple shell tests. The JSON form is for richer diagnostics and future compatibility checks.

## Protocol Handshake Version

Long-running components MUST report the same version during protocol initialization.

LSP servers MUST set `InitializeResult.serverInfo`:

```json
{
  "name": "basilisk",
  "version": "0.1.0"
}
```

MCP servers MUST set `serverInfo` in the initialize response:

```json
{
  "name": "too-many-cooks",
  "version": "0.5.0"
}
```

Custom sidecar protocols MUST either support `--version` before launch or send a first hello frame before doing work:

```json
{
  "type": "hello",
  "componentId": "forge-sidecar-csharp",
  "version": "0.1.0"
}
```

## Matching Rules

The expected version comes from the installing package manifest. For marketplace IDE extensions this is normally the extension version. For a product with intentionally split component versions, the extension manifest MUST list each expected component version explicitly.

Version comparison rules:

1. Strip one optional leading `v` before comparison.
2. Compare the complete semantic version string after normalization.
3. Preserve and compare pre-release identifiers exactly.
4. Preserve and compare build metadata exactly unless the manifest declares `ignoreBuildMetadata: true`.
5. Treat an unparsable or missing version as a mismatch.

User overrides MUST NOT bypass this check. A configured path, environment override, PATH discovery result, bundled binary, downloaded Zed asset, or package-manager install result all go through the same comparison.

## Product Binary Manifest

Each package that launches binaries MUST include a deployment manifest. Suggested path:

```text
deployment-toolkit.json
```

Suggested shape:

```json
{
  "schemaVersion": 1,
  "productId": "forge",
  "packageVersion": "0.1.0",
  "components": [
    {
      "id": "forge-lsp",
      "kind": "lsp",
      "version": "0.1.0",
      "command": "forge-lsp",
      "required": true
    },
    {
      "id": "forge-sidecar-csharp",
      "kind": "dotnet-tool",
      "version": "0.1.0",
      "command": "forge-sidecar-csharp",
      "required": true
    }
  ]
}
```

The manifest is the single source of truth for startup validation, package assembly, release checks, and CI tests.

## Language Bindings

Rust binaries MUST use a shared crate that wires version output from `CARGO_PKG_VERSION` and product metadata.

.NET binaries and dotnet tools MUST use a shared package that wires version output from MSBuild package metadata.

Node binaries MUST read version from their own `package.json` at build time or from generated constants. Hard-coded server versions are forbidden.

Editor extensions MUST use shared resolver libraries instead of custom per-product parsers.

## Test Requirements

Every product repo MUST include tests that prove:

1. Each binary exits `0` for `--version`.
2. The first stdout line is exactly `<component-id> <version>`.
3. Protocol initialization reports the same version.
4. A mismatched configured path causes a visible startup error.
5. A matching bundled binary starts successfully.
6. A PATH binary with the wrong version is rejected or ignored in favor of a matching bundled binary.

## TODO

- [ ] Define the canonical JSON schema file and validation fixtures.
- [ ] Decide whether 1500 ms is the final timeout for all platforms or only the VS Code resolver default.
- [ ] Add a formal compatibility field for rare cases where protocol compatibility intentionally differs from package version.
