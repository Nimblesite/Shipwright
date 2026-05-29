# Shipwright

Shipwright is a secure supply-chain deployment contract for teams shipping binaries and IDE extensions that must stay version-matched across multiple ecosystems and package registries.

It defines the version contract, manifest schema, compatibility matrix, and the host-side resolution algorithm that IDE extensions use to locate and verify their backing binaries before launching them.

Security stance: Shipwright prevents IDE tooling from launching hidden PATH binaries, stale bundled artifacts, mismatched user overrides, or package contents that do not match the manifest.

## What This Solves

IDE extensions and developer tools drift apart in predictable ways:

- A VSIX ships one language server version while the extension expects another.
- A JetBrains or Zed plugin starts a binary from PATH without checking it.
- An MCP server reports a hard-coded protocol version that no longer matches the npm package.
- Release artifacts, package-manager manifests, and bundled binaries are verified differently in every repo.

Shipwright makes that consistent. Every product declares its deployable components in `shipwright.json`, every executable reports its version in the same structured format, and every host checks versions before startup or package release.

## Packages

| Registry | Package |
| --- | --- |
| crates.io | `shipwright`, `shipwright-manifest`, `shipwright-host`, `shipwright-zed`, `shipwright-version-stamp` |
| npm | `@nimblesite/shipwright-core`, `@nimblesite/shipwright-vscode`, `@nimblesite/shipwright-mcp`, `@nimblesite/shipwright-validate-manifest` |
| NuGet | `Shipwright` |
| pub.dev | `shipwright` |

## Repo Layout

| Path | Purpose |
| --- | --- |
| `schemas/` | JSON schemas for the product manifest, version-output, platforms, and test vectors. |
| `fixtures/manifests/` | Example product manifests. |
| `fixtures/invalid-manifests/` | Schema failure examples. |
| `fixtures/version-outputs/` | Plain and JSON version-output examples. |
| `crates/shipwright-manifest/` | Rust data types for the version contract. |
| `crates/shipwright-host/` | Pure binary-resolution algorithm (no I/O). |
| `crates/shipwright/` | Binary-side helper (emits `--version` / `--version --json`). |
| `crates/shipwright-zed/` | Zed editor host integration. |
| `clients/ts/packages/shipwright-core/` | TypeScript core resolver. |
| `clients/ts/packages/shipwright-vscode/` | VS Code extension glue. |
| `clients/ts/packages/shipwright-mcp/` | MCP helpers. |
| `clients/dotnet/Shipwright/` | .NET library. |
| `clients/dotnet/Shipwright.Cli/` | .NET global tool (`shipwright`). |
| `clients/dart/shipwright/` | Dart client. |
| `tools/shipwright-version-stamp/` | Cross-platform version-stamping CLI. |
| `tools/validate-manifest/` | AJV-backed manifest validator. |
| `templates/gh-actions/` | Reusable release workflow templates for downstream product repos. |
| `docs/specs/` | Contract and architecture specs. |
| `docs/plans/` | Implementation plans. |

## Build

```bash
make ci       # lint + test + build (full CI)
make test     # tests + coverage + threshold enforcement
make lint     # linters only
make fmt      # format in place
make build    # compile all artifacts
make clean    # remove build artifacts
make setup    # post-create dev environment setup
```

## Version Contract

Every executable component must support:

```bash
tool-name --version        # prints "tool-name 1.2.3"
tool-name --version --json # prints JSON per schemas/version-manifest.schema.json
```

## Placeholder Versions

Source-controlled version fields MUST be `0.0.0-dev`. Real versions are stamped at release time by `shipwright-version-stamp` from the git tag. This applies to `Cargo.toml`, `package.json`, `*.csproj`, `pubspec.yaml`, and `shipwright.json`. Hard-coded release versions in source are a release-engineering defect. See [SWR-VERSION-BUILD-STAMPING](docs/specs/binary-version-contract.md#swr-version-build-stamping-build-time-version-stamping).

## Product Manifest

Each product declares its components in `shipwright.json`:

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
      "expectedVersion": "${PRODUCT_VERSION}",
      "platforms": ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"],
      "sources": ["bundled", "github-release"],
      "required": true
    }
  ]
}
```

## Docs

- [Binary Version Contract](docs/specs/binary-version-contract.md)
- [Supply Chain Security](docs/specs/supply-chain-security.md)
- [IDE Extension Deployment](docs/specs/ide-extension-deployment.md)
- [Library Architecture](docs/specs/library-architecture.md)
- [Compatibility Matrix](docs/specs/compatibility-matrix.md)
- [Acceptance Gates](docs/specs/acceptance-gates.md)
- [Release Pipeline](docs/plans/release-pipeline.md)

## License

Licensed under either of [MIT](LICENSE) or [Apache-2.0](LICENSE) at your option.

Copyright (c) 2026 NIMBLESITE PTY LTD
