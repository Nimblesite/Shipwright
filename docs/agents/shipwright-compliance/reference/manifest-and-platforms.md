# Manifest, Platforms, and Libraries

Reference for authoring `shipwright.json` and choosing the right library/platform ids. Authoritative
schema lives at `https://github.com/Nimblesite/Shipwright/tree/main/schemas/`. `[SWR-VERSION-MANIFEST]`,
`[SWR-VSIX-TARGETS]`, `[SWR-ARCH-LIBRARIES]`.

## Product manifest shape

`shipwright.json` at the repo root (and extension root). Minimal valid example:

```json
{
  "manifestVersion": 1,
  "product": {
    "id": "my-tool",
    "displayName": "My Tool",
    "version": "0.0.0-dev"
  },
  "components": [
    {
      "id": "my-tool-lsp",
      "kind": "lsp",
      "language": "rust",
      "binaryName": "my-tool-lsp",
      "expectedVersion": "0.0.0-dev",
      "platforms": ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"],
      "sources": ["bundled", "github-release"],
      "required": true
    }
  ]
}
```

Rules:

- `product.version` and every `expectedVersion` are `0.0.0-dev` in source; the release stamper rewrites
  them from the tag. Hard-coded release versions are a defect. `[SWR-VERSION-BUILD-STAMPING]`.
- Declare **one component per deployable executable/payload**. Anything bundled or released must be a
  component; nothing undeclared may ship. The manifest is the single source of truth.
- `binaryName` is the on-disk name (no `.exe`; the suffix is added per platform from `platforms.json`).

## Canonical platforms (`vsceTarget`)

| platform id | vsceTarget | GH Actions runner | npm_config_arch | exe |
| --- | --- | --- | --- | --- |
| darwin-arm64 | darwin-arm64 | macos-15 | arm64 | — |
| darwin-x64 | darwin-x64 | macos-13 | x64 | — |
| linux-x64 | linux-x64 | ubuntu-latest | x64 | — |
| linux-arm64 | linux-arm64 | ubuntu-latest | arm64 | — |
| win32-x64 | win32-x64 | windows-latest | x64 | .exe |
| win32-arm64 | win32-arm64 | windows-latest | arm | .exe |
| all | (none) | any | — | — |

`all` is for pure-Node / platform-agnostic binaries — bundle under `bin/all/<binaryName>` with no `.exe`
on any platform, and use the fat-VSIX strategy. `[SWR-VSIX-FAT]`. Any extra vsce target
(`alpine-x64`, `web`, …) must be added to `schemas/platforms.json` first.

## Component kinds

`lsp`, `mcp`, `cli`, `sidecar`, `helper`, `config` (config payloads carry no binary). `kind` drives which
version check applies: `lsp` → `serverInfo` handshake; `mcp` → MCP `serverInfo.version`; everything
executable → `--version`. `[SWR-VERSION-HANDSHAKE]`.

## `sources` cascade

Ordered list of where the host may resolve a component. Resolution stops at the first that yields a
version-matching binary. Self-contained IDE extensions use `["user-setting", "bundled"]` so they never
fall back to a system binary. `[SWR-IDE-RESOLUTION]`. Valid sources:

- `user-setting` — explicit per-component path or binary directory configured by the user.
- `env` — a documented environment override (only if the host documents one).
- `bundled` — the binary shipped inside the package (VSIX/plugin). Default for IDE extensions.
- `github-release` — managed download/cache, allowed **only** where marketplace packaging prevents
  bundling (e.g. Zed). Must verify version from LSP `initialize`.

**Never** include PATH / Homebrew / Scoop / npm-global / cargo / dotnet-tool as a normal startup source.
They are repair flows only, and only after an explicit prompt. `[SWR-IDE-PKG-REPAIR]`, `[SWR-SEC-CONTROLS]`.

## Version output contract

Every executable component supports:

```bash
my-tool-lsp --version          # → "my-tool-lsp 1.2.3"   (exit 0, < 1500 ms, no runtime/network)
my-tool-lsp --version --json   # → JSON per version-manifest.schema.json
```

JSON shape:

```json
{ "manifestVersion": 1, "name": "my-tool-lsp", "version": "1.2.3", "kind": "lsp", "language": "rust" }
```

Comparison: strip one leading `v`, compare the full semver, preserve pre-release + build metadata
(unless the manifest sets `ignoreBuildMetadata: true`). Unparseable/missing = mismatch. `[SWR-VERSION-MATCHING]`.

## Library / package names by registry

| Language | Library | Registry | Role |
| --- | --- | --- | --- |
| Rust | `shipwright` | crates.io | binary `--version` text/JSON |
| Rust | `shipwright-manifest` | crates.io | manifest data model |
| Rust | `shipwright-host` | crates.io | pure resolver (no I/O) |
| Rust | `shipwright-zed` | crates.io | Zed host integration |
| Rust | `shipwright-version-stamp` | crates.io / binary | release/test version stamper |
| TS | `@nimblesite/shipwright-core` | npm | path + `resolve()` cascade |
| TS | `@nimblesite/shipwright-vscode` | npm | VS Code manifest load + resolve |
| TS | `@nimblesite/shipwright-mcp` | npm | MCP `serverInfo.version` from `package.json` |
| TS | `@nimblesite/shipwright-validate-manifest` | npm | AJV manifest validator CLI |
| .NET | `Shipwright` | NuGet | `--version` from assembly metadata (+ global tool) |
| Dart | `shipwright` | pub.dev | resolver + `--version` helpers |
| Kotlin | `dev.shipwright:shipwright-intellij` | Maven Central | IntelliJ host |

Pick the library matching each binary's language; do not hand-roll version parsing or path resolution. `[SWR-ARCH-LIBRARIES]`.
