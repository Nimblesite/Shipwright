# Deployment Toolkit

Deployment Toolkit is the shared contract and library set for shipping binaries and IDE extensions that must stay version-matched.

The first adopters are Nimblesite products: Deslop, Basilisk, Forge, Too Many Cooks, and dart_mutant. The reusable libraries use generic public package names such as `deploy-toolkit-*`, `@deploy-toolkit/*`, and `DeployToolkit`. Product manifests and fixtures can still be Nimblesite-specific because they describe real products.

## What This Solves

IDE extensions and developer tools often drift apart:

- A VSIX ships one language server version while the extension expects another.
- A JetBrains or Zed plugin starts a binary from PATH without checking it.
- An MCP server reports a hard-coded protocol version that no longer matches the npm package.
- Release artifacts, package-manager manifests, and bundled binaries are verified differently in every repo.

This repo makes that consistent. Every product declares its deployable components in `deployment-toolkit.json`, every executable reports its version in the same format, and every host checks versions before startup or package release.

## Current Surfaces

| Path | Purpose |
| --- | --- |
| `schemas/deployment-toolkit.schema.json` | Product manifest schema. |
| `schemas/version-manifest.schema.json` | JSON shape for `--version --json`. |
| `schemas/platforms.json` | Canonical platform ids and runtime mappings. |
| `schemas/test-vectors.json` | Shared resolver vectors every host-library port must pass. |
| `fixtures/manifests/` | Golden Nimblesite product manifests. |
| `fixtures/invalid-manifests/` | Schema failure examples. |
| `fixtures/version-outputs/` | Plain and JSON version-output examples. |
| `tools/validate-manifest/` | AJV-backed manifest validator. |
| `crates/deploy-toolkit-manifest` | Rust manifest and version-output data types. |
| `crates/deploy-toolkit-host` | Rust resolver algorithm. |
| `clients/ts/packages/deploy-toolkit-core` | TypeScript resolver algorithm. |
| `templates/gh-actions/` | Reusable release, Homebrew tap, and Scoop bucket workflows. |
| `docs/specs/` | Contract specs. |
| `docs/plans/` | Implementation and migration plans. |

## Setup

Install dependencies from the repo root:

```bash
pnpm install
cargo fetch
```

Run the current validation suite:

```bash
pnpm test
```

That runs:

- schema and fixture validation
- all TypeScript resolver vectors
- Rust manifest formatter tests

## Validate A Manifest

Validate one manifest:

```bash
pnpm validate:manifest fixtures/manifests/deslop.json
```

Validate every manifest in a directory:

```bash
node tools/validate-manifest/index.mjs fixtures/manifests
```

Expected result:

```text
fixtures/manifests/deslop.json: valid
```

Invalid manifests under `fixtures/invalid-manifests/` must fail. Do not weaken the schema to make those pass.

## Write A Product Manifest

Each product repo opts in by adding `deployment-toolkit.json` at its root or package root.

Minimal CLI-only example:

```json
{
  "manifestVersion": 1,
  "product": {
    "id": "dart-mutant",
    "displayName": "dart_mutant",
    "version": "0.1.0"
  },
  "components": [
    {
      "id": "dart-mutant-cli",
      "kind": "cli",
      "language": "dart",
      "binaryName": "dart-mutant",
      "expectedVersion": "0.1.0",
      "platforms": ["all"],
      "sources": ["path", "github-release"],
      "verifyStartup": true,
      "versionCheckStrategy": "version-flag-json",
      "required": true
    }
  ],
  "hosts": {
    "cli": {
      "artifact": "archive",
      "activationVerifies": ["dart-mutant-cli"],
      "onMismatch": "error"
    }
  }
}
```

Use the existing product fixtures as starting points:

- `fixtures/manifests/deslop.json`
- `fixtures/manifests/basilisk.json`
- `fixtures/manifests/forge.json`
- `fixtures/manifests/too-many-cooks.json`
- `fixtures/manifests/dart-mutant.json`

## Version Contract

Every executable component must support a plain version line:

```bash
tool-name --version
```

Output:

```text
tool-name 1.2.3
```

Components that support JSON output must also support:

```bash
tool-name --version --json
```

Output must match `schemas/version-manifest.schema.json`, for example:

```json
{
  "manifestVersion": 1,
  "name": "deslop-lsp",
  "version": "0.1.0",
  "kind": "lsp",
  "language": "rust",
  "product": "deslop"
}
```

MCP and LSP servers must report the same version through protocol initialize metadata when the host cannot run `--version` before startup.

## Resolver Contract

Host libraries must resolve binaries in this order when those sources are enabled in the manifest:

1. exact configured binary path
2. configured directory containing the binary
3. environment path override
4. environment directory override
5. bundled binary
6. language or package-manager tool fallback
7. PATH lookup
8. protocol fallback, such as LSP initialize for Zed

Every resolver port must pass `schemas/test-vectors.json`.

Run the TypeScript resolver vectors:

```bash
pnpm test:ts-core
```

Run the Rust manifest tests:

```bash
pnpm test:rust-manifest
```

## IDE Packaging Rules

VS Code:

- VSIX packages must include `deployment-toolkit.json`.
- Native binaries go under `bin/<platform>/<binaryName><exe>`.
- Platform-agnostic tools go under `bin/all/<binaryName>`.
- Activation must fail visibly for required components with mismatched versions.

JetBrains:

- Plugins must load the manifest from plugin root.
- Startup must check configured and external binaries before LSP startup.
- If native bundling is used, helpers must be explicitly manifest-listed under plugin-root `bin/<platform>`.

Zed:

- Zed extensions cannot always spawn `--version` first.
- Use `lsp-initialize` for components that must be verified after server start.
- Cache/download metadata must record version and checksum.

## Release Workflow Templates

Reusable workflow templates live under `templates/gh-actions/`:

- `release-binary-multiplatform.yml`
- `publish-brew-tap.yml`
- `publish-scoop-bucket.yml`

These are generic templates. Product repos pass product-specific names, repos, versions, asset URLs, and checksums as inputs.

## CI Pattern For Product Repos

Product repos should run these gates:

```bash
pnpm validate:manifest deployment-toolkit.json
tool-name --version
tool-name --version --json
deploy-toolkit verify-binaries --manifest deployment-toolkit.json --platform <platform>
deploy-toolkit verify-extension-package --manifest deployment-toolkit.json --package <artifact> --platform <platform>
```

`verify-binaries` and `verify-extension-package` are planned CLI commands. Until they land, product repos should add explicit tests that prove the same behavior.

## Important Boundary

Do this:

- Keep reusable library names generic.
- Keep product manifests honest and product-specific.
- Keep Nimblesite repo URLs in fixtures when the fixture is about a Nimblesite product.
- Add failing product tests before implementing product fixes.
- Validate every new manifest against the schema.

Do not do this:

- Do not blanket-rebrand Nimblesite product fixtures.
- Do not hard-code versions in MCP/LSP metadata.
- Do not allow IDE extensions to start required binaries without version checks.
- Do not silently fall through from a user-configured binary with the wrong version.

## Main Docs

- [Binary Version Contract](docs/specs/binary-version-contract.md)
- [IDE Extension Deployment](docs/specs/ide-extension-deployment.md)
- [Acceptance Gates](docs/specs/acceptance-gates.md)
- [Library Architecture](docs/specs/library-architecture.md)
- [Framework Implementation Plan](docs/plans/framework-implementation-plan.md)
- [AI Agent Product Adoption Guide](docs/agents/product-repo-adoption-guide.md)
