# IDE Extension Deployment Spec

Status: Draft

## Purpose

Nimblesite IDE extensions must install with minimal friction while guaranteeing that the matching binaries are present and compatible. A user should normally install one VSIX, JetBrains plugin, Zed extension, or package-manager entry and get the right language server, MCP server, CLI, sidecar, and helper tools without manual setup.

## Required Startup Behavior

Every IDE extension MUST validate required binaries before reporting itself ready.

Startup sequence:

1. Load the package deployment manifest.
2. Resolve every required component for the current platform.
3. Run the component version check or protocol handshake check.
4. Compare the reported version with the manifest version.
5. Start the LSP, MCP, sidecar, helper, or CLI integration only after all required checks pass.
6. Surface a clear error if any required component is missing or mismatched.

The extension MUST NOT silently continue with a missing or incompatible binary.

## Bundling Rule

VSIX and JetBrains plugin packages MUST bundle required runtime binaries by default.

Recommended layout:

```text
bin/
  darwin-arm64/
    product-lsp
    product-mcp
    product-cli
  darwin-x64/
    product-lsp
  linux-x64/
    product-lsp
  linux-arm64/
    product-lsp
  win32-x64/
    product-lsp.exe
deployment-toolkit.json
```

JetBrains packages can use the same layout inside the plugin root.

Zed extensions may download and cache release assets when marketplace packaging prevents bundling native binaries. In that case, the extension MUST validate the server version from LSP initialize before enabling product features.

## User Override Settings

Every IDE extension MUST provide a user setting for external binaries.

Supported forms:

1. A binary directory containing all required components.
2. A per-component absolute path.
3. A PATH mode that accepts system-installed binaries only when versions match.

The override is a resolver input, not a bypass. If a user points to a mismatched binary, the extension MUST stop startup and report the expected and found versions.

Suggested setting names:

| Host | Setting |
| --- | --- |
| VS Code | `<product>.binaries.path` for a directory and `<product>.binaries.<componentId>` for per-component paths |
| JetBrains | Settings -> Tools -> `<Product>` -> Binary directory / component paths |
| Zed | LSP setting `binary.path` where supported |
| Neovim | setup option `binaries.path` or `binaries.<componentId>` |

Existing product settings can be mapped into these names during migration.

## Resolution Order

For each component, resolvers SHOULD use this order:

1. Explicit per-component path.
2. Explicit binary directory.
3. Bundled package binary.
4. Managed package cache or extension-managed download.
5. PATH or package-manager global install.

PATH is last because a global install is the easiest place to accidentally pick up an older binary. A matching PATH binary may be used, but a mismatched PATH binary must not block a matching bundled binary.

If the user explicitly configured a path and it mismatches, do not fall back. The user needs a precise error so they can fix the configured path.

## Error Reporting

Startup errors MUST include:

1. Product and extension version.
2. Component id.
3. Expected version.
4. Found version or `not found`.
5. Source path or resolver source.
6. Next action: reinstall extension, rebuild local binary, update package manager tool, or fix setting.

Example:

```text
Forge cannot start: forge-sidecar-csharp version mismatch.
Expected 0.1.0 from the Forge extension manifest.
Found 0.0.9 at /Users/me/.dotnet/tools/forge-sidecar-csharp.
Update the dotnet tool or clear the configured binary path.
```

## Package-Manager Repair

Package managers can be used as repair flows, but not as hidden startup side effects.

Allowed repair flows:

1. VS Code command: `<Product>: Install or Repair Binaries`.
2. JetBrains notification action: `Install matching binaries`.
3. CLI command: `deployment-toolkit repair`.

The extension MUST ask before running Homebrew, Scoop, npm, cargo install, or dotnet tool commands. The command output must go to the product output channel or IDE event log.

## Required Host Libraries

Every host resolver library MUST provide:

1. Platform id normalization.
2. Manifest loading.
3. Binary path resolution.
4. `--version` execution where host permits.
5. Protocol handshake fallback where host cannot execute preflight commands.
6. Consistent diagnostic objects.
7. Tests for env override, configured path, bundled binary, PATH fallback, missing binary, and mismatch.

## TODO

- [ ] Confirm the final setting names for VS Code, JetBrains, Zed, and Neovim.
- [ ] Define whether MCP server contributions in VS Code `package.json` should be generated from `deployment-toolkit.json`.
- [ ] Decide the exact repair-command policy for package managers that need elevation or shell profile changes.
