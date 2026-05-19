# IDE Extension Deployment Spec

```
Spec prefix: SWR-IDE-*
Status: Draft
```

## Purpose

IDE extensions using Shipwright must install with minimal friction while guaranteeing that the matching binaries are present and compatible. A user should normally install one VSIX, JetBrains plugin, Zed extension, or package-manager entry and get the right language server, MCP server, CLI, sidecar, and helper tools without manual setup.

For VS Code extensions with native binaries, the Microsoft platform-specific sample is authoritative:
the installed extension package is the runtime source. The extension MUST execute the binary from
the unpacked extension directory, not from PATH or a package-manager global install.

## Required Startup Behavior

Every IDE extension MUST validate required binaries before reporting itself ready.

Startup sequence:

1. Load `shipwright.json` from the package.
2. Resolve every required component for the current platform.
3. Run the component version check or protocol handshake check.
4. Compare the reported version with the manifest `expectedVersion`.
5. Start the LSP, MCP, sidecar, helper, or CLI integration only after all required checks pass.
6. Surface a clear error if any required component is missing or mismatched.

The extension MUST NOT silently continue with a missing or incompatible binary.

## Bundling Rule

VSIX and JetBrains plugin packages MUST bundle required runtime binaries by default.

Directory names under `bin/` are `vsceTarget` values from `schemas/platforms.json` (e.g. `darwin-arm64`, `win32-x64`). The full VSIX packaging pipeline — build matrix, binary staging, `vsce package --target`, content verification, and Marketplace publish — is specified in [vsix-platform-bundling.md](vsix-platform-bundling.md).

VS Code MUST use the files unpacked by VS Code into the extension directory as-is. It MUST NOT copy
bundled binaries to another runtime directory during installation or activation, and it MUST NOT
create a per-user binary cache for bundled VSIX contents.

Normative layout:

```text
bin/
  darwin-arm64/
    product-lsp
    product-mcp
  darwin-x64/
    product-lsp
  linux-x64/
    product-lsp
  linux-arm64/
    product-lsp
  win32-x64/
    product-lsp.exe
  win32-arm64/
    product-lsp.exe
  all/
    tmc-server        ← platform-agnostic (pure-Node) binary
shipwright.json
```

Zed extensions may download and cache release assets when marketplace packaging prevents bundling native binaries. In that case, the extension MUST validate the server version from LSP initialize before enabling product features.

## Extension Test Isolation

Extension tests MUST prove the installed-package path, not a developer machine fallback.

Required test behavior:

1. Stage required binaries inside the extension package or extension development directory before activation.
2. Clear binary override environment variables.
3. Remove known locally installed product binaries from PATH before tests.
4. Fail before activation if a required product binary still resolves on PATH.
5. Assert that the accepted resolver source for every bundled required component is `bundled`.

Tests MUST NOT point an IDE extension at `target/release`, `~/.cargo/bin`, Homebrew, Scoop, npm-global, dotnet tools, or any other external install. A missing or stale extension bundle must fail the test instead of being masked by a binary installed on the developer or CI runner machine.

## User Override Settings

Every IDE extension MUST provide a user setting for external binaries.

Supported forms:

1. A binary directory containing all required components.
2. A per-component absolute path.

The override is a resolver input, not a bypass. If a user points to a mismatched binary, the extension MUST stop startup and report the expected and found versions.

Suggested setting names:

| Host | Setting |
| --- | --- |
| VS Code | `<product>.binaries.path` for a directory, `<product>.binaries.<componentId>` for per-component paths |
| JetBrains | Settings → Tools → `<Product>` → Binary directory / component paths |
| Zed | LSP setting `binary.path` where supported |

## Resolution Order

For each component, resolvers SHOULD use this order:

1. Explicit per-component path.
2. Explicit binary directory.
3. Explicit environment override, if the host documents one.
4. Bundled package binary.
5. Managed extension download/cache only where marketplace packaging prevents bundling.

VS Code native-binary extensions MUST stop at the bundled package binary unless the user explicitly
configured an absolute override. They MUST NOT inspect PATH, prepend or append to PATH, shell out to
`which`/`where`, or use Homebrew, Scoop, npm-global, Cargo, dotnet tools, or any other global package
manager as a normal startup source.

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
my-tool cannot start: my-tool-lsp version mismatch.
Expected 1.2.3 from the extension manifest.
Found 1.1.0 at /usr/local/bin/my-tool-lsp.
Reinstall the extension or update your configured binary path.
```

## [SWR-IDE-DOTNET-RUNTIME] .NET Runtime Acquisition for VS Code Extensions

Any VS Code extension that bundles framework-dependent .NET sidecars (i.e. components with `"language": "dotnet"` and `"bundlePath": "bin/all/..."` in `shipwright.json`) MUST acquire the .NET runtime via Microsoft's `.NET Install Tool` extension — **not** by requiring the user to pre-install .NET, not by crashing with a "missing .NET" error, and not by hand-rolling a download.

### Mandatory wiring

1. **Declare the dependency** in `package.json`:
   ```json
   "extensionDependencies": ["ms-dotnettools.vscode-dotnet-runtime"]
   ```
   VS Code installs this extension automatically when the user installs your extension. This is the same pattern used by C# Dev Kit, the C# extension, .NET MAUI, Unity, CMake, and Bicep.

2. **Acquire the runtime on activation** using the `dotnet.findPath` then `dotnet.acquire` command sequence:
   ```ts
   // Step 1: check if a suitable runtime already exists
   const found = await vscode.commands.executeCommand('dotnet.findPath', {
     acquireContext: {
       version: '10.0',
       mode: 'runtime',
       requestingExtensionId: 'your-publisher.your-extension',
     },
     versionSpecRequirement: 'greater_than_or_equal',
   });

   // Step 2: acquire if not found — shows a non-interactive toast with spinner
   if (!found) {
     await vscode.window.withProgress(
       { location: vscode.ProgressLocation.Notification, title: 'MyProduct: Installing .NET runtime', cancellable: false },
       () => vscode.commands.executeCommand('dotnet.acquire', {
         version: '10.0',
         mode: 'runtime',
         requestingExtensionId: 'your-publisher.your-extension',
       })
     );
   }
   ```

3. **Set `DOTNET_ROOT`** in the environment passed to the Rust LSP host process so the .NET apphost can locate the runtime:
   ```ts
   const dotnetDir = path.dirname(dotnetPath);
   env['DOTNET_ROOT'] = dotnetDir;
   ```
   The Rust sidecar spawn inherits this env and the framework-dependent apphost resolves the runtime correctly.

4. **On acquisition failure** — show a non-modal error notification with `[Open dot.net]` and `[Show log]` buttons. Enter a degraded state. Do NOT block the editor or throw unhandled exceptions. Register a `<product>.retryDotnetAcquisition` command so the user can retry without reloading the window.

### What is forbidden

- **No `dotnet tool install`** for sidecar distribution. Sidecars ship inside the VSIX at `bin/all/`.
- **No crashing activation** when .NET is missing. Acquire it instead.
- **No modal/blocking UI** during acquisition. Progress notifications only.
- **No hand-rolled runtime download** logic. The `.NET Install Tool` handles this.
- **No `SelfContained=true`** publish. Sidecars are framework-dependent; the runtime is acquired via the Install Tool.

### Reference

This is the authoritative pattern from Microsoft. Downstream products MUST follow it exactly:
- `.NET Install Tool` extension: https://marketplace.visualstudio.com/items?itemName=ms-dotnettools.vscode-dotnet-runtime
- C# Dev Kit `extensionDependencies` declaration is the canonical reference implementation.

## Package-Manager Repair

Package managers can be used as repair flows, but not as hidden startup side effects.

Allowed repair flows:

1. VS Code command: `<Product>: Install or Repair Binaries`.
2. JetBrains notification action: `Install matching binaries`.
3. CLI command: `shipwright repair`.

The extension MUST ask before running Homebrew, Scoop, npm, cargo install, or dotnet tool commands.

## Required Host Library Capabilities

Every host resolver library MUST provide:

1. Platform id normalization.
2. Manifest loading.
3. Binary path resolution.
4. `--version` execution where host permits.
5. Protocol handshake fallback where host cannot execute preflight commands.
6. Consistent diagnostic objects.
7. Tests for env override, configured path, bundled binary, missing binary, mismatch, and rejection
   of PATH/global-install fallback during normal startup.
