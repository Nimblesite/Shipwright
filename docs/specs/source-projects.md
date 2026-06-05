# Source Projects and Survey

```
Spec prefix: SWR-SRC-*
Status: Draft
```

Shipwright exists to scaffold binary and IDE-extension deployment **consistently** across a portfolio
of otherwise-unrelated products. This document records who those products are and the concrete shapes
they exhibit today — the evidence that drove every rule in the rest of the specs. It is intentionally
specific: the framework must support these shapes without forcing each product to rewrite its editor
integration.

## [SWR-SRC-PROJECTS] Deployment Targets

The products Shipwright scaffolds for: **Too Many Cooks**, **Deslop**, **Basilisk**, **SharpLsp**, and
**dart_mutant**. Basilisk and Deslop are the reference adopters — they carry the rudiments of a complete
Shipwright pipeline and are the templates the others follow.

## [SWR-SRC-SURVEY] Survey of Current Shapes

| Repo | Tool shape | Deployment / version evidence | Gaps the framework must close |
| --- | --- | --- | --- |
| Too Many Cooks | TypeScript MCP server published as an npm binary plus a VS Code extension. | `packages/too-many-cooks/package.json` declares version and bin `too-many-cooks`. The VSIX spawns `too-many-cooks` from PATH in `connectionManager.ts`. MCP metadata created in `packages/core/src/server.ts`. | Server version hard-coded and out of sync with the package; no CLI `--version` contract; the VSIX assumes a global npm install and does not verify version before startup. |
| Deslop | Rust workspace: CLI, LSP, MCP, VS Code extension, JetBrains plugin. | Binaries `deslop`, `deslop-lsp`, `deslop-mcp`. The VSIX resolver checks PATH with `--version` and falls back to bundled `bin/<platform>/<binary>`; `package.json` contributes an MCP server from `${extensionPath}/bin/${platform}/deslop-mcp`. | Closest template, but the LSP did not visibly implement `--version`; `DESLOP_BINARY_DIR` bypassed exact version comparison; JetBrains resolution found a binary but did not verify version. |
| Basilisk | Rust workspace: `basilisk` CLI/LSP, Zed extension, VS Code extension, profiler helper. | Clap `version` wired; `basilisk-common` centralizes GitHub-release asset naming; the Zed extension downloads platform assets from GitHub releases and caches `basilisk-<version>`. | VSIX did not bundle or verify the server binary; the profiler helper was not in a package-level manifest; Zed cannot spawn a preflight `--version`, so it needs handshake-level verification. |
| SharpLsp | Rust LSP, VS Code + Zed extensions, Rider plugin, .NET sidecars. | `sharplsp-lsp --version` prints the contract line; C#/F# sidecars print theirs; VS Code has Homebrew/Scoop/dotnet-tool install logic; Rider resolves from settings, `~/.local/bin`, or PATH. | `ensureBinaries` exists but was not called by VSIX startup; resolution did not enforce version; Zed needs LSP-initialize enforcement. |
| dart_mutant | Single Rust CLI for Dart mutation testing. | `Cargo.toml` bin `dart_mutant`; Clap `version` wired; integration tests call `--version`. | No IDE extension yet — the simplest CLI-only consumer and the first low-risk adopter for the shared Rust version library. |

## [SWR-SRC-REQUIREMENTS] Requirements Distilled From the Survey

1. Every executable component has the same machine-readable version contract, independent of language.
2. Editor extensions carry a manifest listing every required binary and its expected version.
3. User-configured binary paths are allowed but must not bypass version checks.
4. VSIX and JetBrains packages bundle required binaries by default; Zed may download/cache release assets
   where the marketplace model requires it, but still verifies version after server initialization.
5. Long-running protocols report version through their handshake as well as `--version` — LSP and MCP via
   `serverInfo`, custom sidecars via an initial hello frame or `--version`.
6. Package-manager installs are fine for CLI distribution and optional repair flows, but editor startup
   never silently continues with a missing or mismatched binary.
7. Multi-binary products use a single product manifest so the editor validates LSP, MCP, CLI, helper, and
   sidecar tools consistently.
