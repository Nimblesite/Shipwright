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

| Repo | Tool shape | Shipwright checklist |
| --- | --- | --- |
| [Too Many Cooks](https://github.com/Nimblesite/too-many-cooks) | TypeScript MCP server (npm binary) plus a VS Code extension. | Source the server version from package metadata; add a CLI `--version` contract; have the VSIX verify the binary before startup instead of assuming a global npm install. |
| [Deslop](https://github.com/Nimblesite/Deslop) | Rust workspace: CLI, LSP, MCP, VS Code extension, JetBrains plugin. | Add `--version` to the LSP; stop the `DESLOP_BINARY_DIR` override from bypassing the version check; have JetBrains verify version after resolving the binary. |
| [Basilisk](https://github.com/Nimblesite/Basilisk) | Rust workspace: `basilisk` CLI/LSP, Zed + VS Code extensions, profiler helper. | Bundle and verify the server binary in the VSIX; list the profiler helper in the manifest; verify version via the Zed LSP `initialize` handshake. |
| [SharpLsp](https://github.com/Nimblesite/SharpLsp) | Rust LSP, VS Code + Zed extensions, Rider plugin, .NET sidecars. | Call `ensureBinaries` on VSIX startup; enforce the expected version during resolution; add Zed LSP-initialize version enforcement. |
| [dart_mutant](https://github.com/Nimblesite/dart_mutant) | Single Rust CLI for Dart mutation testing. | CLI-only and already conformant; adopt the manifest contract if an IDE extension is added later. |

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
