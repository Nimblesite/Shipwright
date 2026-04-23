# Deployment Toolkit Product Migration Tickets

Status: Draft

These tickets are Nimblesite-specific because they track the first product migrations. The reusable libraries they adopt must keep generic package names.

## DTK-MIG-001: dart_mutant CLI Pilot

Goal:

- Adopt the binary version contract in the CLI-only product first.

Tasks:

- Add `deployment-toolkit.json` from `fixtures/manifests/dart-mutant.json`.
- Add text and JSON `--version` output using the shared helper once available.
- Add CI that runs `deploy-toolkit-validate-manifest deployment-toolkit.json`.
- Add CI that checks the built binary reports `dart-mutant 0.1.0`.

Exit criteria:

- CLI release fails on manifest/version drift.

## DTK-MIG-002: Forge Multi-Binary Pilot

Goal:

- Prove Rust LSP plus .NET sidecar verification.

Tasks:

- Add the Forge product manifest from `fixtures/manifests/forge.json`.
- Add Rust LSP version output.
- Add .NET sidecar JSON version output for C# and F# sidecars.
- Add VSIX and JetBrains startup checks before language server ready state.
- Add package contents verification for VSIX `bin/<platform>`.

Exit criteria:

- Forge CI fails if any sidecar reports a different version from the extension manifest.

## DTK-MIG-003: Deslop VS Code and JetBrains Pilot

Goal:

- Replace bespoke resolver behavior with the shared resolver while preserving existing override behavior.

Tasks:

- Add the Deslop product manifest from `fixtures/manifests/deslop.json`.
- Add contract tests for `deslop`, `deslop-lsp`, and `deslop-mcp` version output.
- Add VSIX package checks for bundled `deslop-lsp` and `deslop-mcp`.
- Add JetBrains startup checks for `deslop-lsp`.

Exit criteria:

- Activation fails visibly when a configured or bundled binary reports the wrong version.

## DTK-MIG-004: Basilisk VS Code and Zed Pilot

Goal:

- Prove mixed VS Code bundling and Zed initialize-time verification.

Tasks:

- Add the Basilisk product manifest from `fixtures/manifests/basilisk.json`.
- Add VSIX bundled binary checks for `basilisk-lsp`.
- Add optional sidecar warning behavior for `basilisk-profiler-helper`.
- Add Zed initialize-version check for `basilisk-lsp`.

Exit criteria:

- Zed reports expected/found version when initialize metadata mismatches.

## DTK-MIG-005: Too Many Cooks Node/MCP Pilot

Goal:

- Remove MCP server version drift by deriving server metadata from npm package metadata.

Tasks:

- Add the Too Many Cooks product manifest from `fixtures/manifests/too-many-cooks.json`.
- Add `tmc-server --version` and `tmc-server --version --json`.
- Add an MCP startup test proving `serverInfo.version` equals npm package version `0.5.0`.
- Add VSIX activation check before spawning the MCP server.

Exit criteria:

- TMC CI fails when npm package version and MCP `serverInfo.version` drift.
