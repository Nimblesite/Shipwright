# Shipwright Repo Survey

```
Spec prefix: SWR-SURVEY-*
Status: Draft
```

This survey records the local evidence gathered from the current Nimblesite tool repos before specifying the deployment framework. It is intentionally concrete: the framework must support these shapes without forcing every product to rewrite its editor integration.

## [SWR-SURVEY-REPOS] Source Repos

| Repo | Tool Shape | Current Deployment and Version Evidence | Gaps for Framework |
| --- | --- | --- | --- |
| Too Many Cooks | TypeScript MCP server published as an npm binary plus a VS Code extension. | `too-many-cooks/packages/too-many-cooks/package.json` declares package version `0.5.0` and bin `too-many-cooks`. The VSIX spawns `too-many-cooks` from PATH in `too_many_cooks_vscode_extension/src/services/connectionManager.ts`. MCP server metadata is created in `packages/core/src/server.ts`. | The server version is hard-coded as `0.1.0` while the npm package is `0.5.0`. No CLI `--version` contract was found. The VSIX assumes a global npm install and does not verify binary version before startup. |
| Deslop | Rust workspace with CLI, LSP, MCP, VS Code extension, and JetBrains plugin. | Rust workspace version is `0.1.0`. Binaries include `deslop`, `deslop-lsp`, and `deslop-mcp`. The VSIX resolver in `clients/vscode/src/binary.ts` checks PATH binaries with `--version` and falls back to bundled `bin/<platform>/<binary>`. `clients/vscode/package.json` contributes an MCP server using `${extensionPath}/bin/${platform}/deslop-mcp`. | Deslop is the closest template, but the LSP binary entry point does not visibly implement `--version`; the VSIX resolver calls it. `DESLOP_BINARY_DIR` bypasses exact version comparison. JetBrains resolution in `DeslopBinaryResolver.kt` finds env, PATH, or bundled binaries but does not verify version. |
| Basilisk | Rust workspace with `basilisk` CLI/LSP subcommand, Zed extension, VS Code extension, and profiler helper binary. | `crates/basilisk-cli/src/main.rs` uses Clap `version`. `crates/basilisk-common/src/lib.rs` centralizes GitHub release asset naming. Zed extension downloads platform assets from GitHub releases and caches `basilisk-<version>`. VSIX has `basilisk.executablePath` and starts `basilisk lsp`. | VSIX does not bundle or verify the server binary. The profiler helper is a second binary but is not represented in a package-level binary manifest. Zed cannot run arbitrary subprocesses for preflight version checks, so it needs handshake-level version verification. |
| SharpLsp | Rust LSP binary, VS Code extension, Zed extension, Rider plugin, and .NET sidecar tools. | `sharplsp-lsp --version` prints `sharplsp-lsp <version>`. C# and F# sidecars print `sharplsp-sidecar-csharp <version>` and `sharplsp-sidecar-fsharp <version>`. `editors/vscode/src/install.ts` contains package-manager install/update logic for Homebrew, Scoop, and dotnet tools. Zed notes it cannot execute `--version` before startup. Rider resolves `sharplsp-lsp` from settings, `~/.local/bin`, or PATH. | `ensureBinaries` exists but is not currently called by VSIX startup. VSIX `client.ts` starts from configured, bundled, or PATH without version enforcement. Rider resolves but does not verify. Zed needs LSP initialize version enforcement. |
| dart_mutant | Single Rust CLI tool for Dart mutation testing. | `Cargo.toml` declares bin `dart_mutant`. Clap `version` is wired in `src/cli/mod.rs`; integration tests call `--version`. | No IDE extension yet. This is the simplest CLI-only consumer and should be the first low-risk adopter for the shared Rust version library. |

## [SWR-SURVEY-REQUIREMENTS] Requirements Distilled From Survey

1. Every executable component must have the same machine-readable version contract, independent of language.
2. Editor extensions must have a manifest listing every required binary and expected version.
3. User-configured binary paths are allowed, but they must not bypass version checks.
4. VSIX and JetBrains packages must bundle required binaries by default. Zed may use release download/cache where the marketplace model requires it, but must still check version after server initialization.
5. Long-running protocols must report version through their handshake as well as `--version`: LSP via `serverInfo`, MCP via `serverInfo`, and sidecar protocols via an initial hello frame or `--version`.
6. Package-manager installs are acceptable for CLI distribution and optional repair flows, but editor startup must not silently continue with missing or mismatched binaries.
7. Multi-binary products need a single product manifest so the editor can validate LSP, MCP, CLI, helper, and sidecar tools consistently.

## [SWR-SURVEY-TODO] TODO

- [ ] Confirm library names are final package names or working names.
- [ ] Re-check Deslop LSP `--version` behavior when implementation starts; the current evidence suggests a real mismatch with the VSIX resolver.
- [ ] Decide whether TMC should be treated as a Node-only binary first or moved behind the same manifest as native binaries immediately.
