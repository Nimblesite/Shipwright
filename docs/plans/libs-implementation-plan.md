# Deployment Toolkit Libraries Implementation Plan

Status: Draft

## Scope Boundary

Reusable libraries, command names, package names, crates, and NuGet packages must be generic because they are intended for public release. Nimblesite-specific product manifests, fixtures, repository references, and migration tickets remain Nimblesite-specific because they describe the first adopters.

## Package Names

| Surface | Public package name | Role |
| --- | --- | --- |
| Rust manifest crate | `deploy-toolkit-manifest` | Product manifest types, schema loading, platform ids, version output structs. |
| Rust binary helper | `deploy-toolkit-cli` | Standard `--version` and `--version --json` helpers for Rust CLIs, LSPs, MCPs, and sidecars. |
| Rust host resolver | `deploy-toolkit-host` | Pure resolver algorithm and probe result model. |
| Zed helper crate | `deploy-toolkit-zed` | Zed/WASM adapter for initialize-time version checks and cached binary metadata. |
| TypeScript core | `@deploy-toolkit/core` | Manifest parser, resolver algorithm, diagnostics, and shared test vectors. |
| VS Code adapter | `@deploy-toolkit/vscode` | VS Code settings/env/bundled/PATH resolver and activation diagnostics. |
| Node binary helper | `@deploy-toolkit/node` | Node/npm `--version`, JSON output, and MCP `serverInfo.version` helpers. |
| JetBrains adapter | `deploy-toolkit-jetbrains` | Kotlin resolver and LSP descriptor helpers. |
| .NET package | `DeployToolkit` | .NET sidecar/global-tool version output and host resolver helpers. |
| Validator tool | `@deploy-toolkit/validate-manifest` | AJV-backed manifest validation for CI. |

## Phase A: Contract Fixtures

Deliverables:

- Nimblesite product manifests in `fixtures/manifests/`.
- Invalid manifests in `fixtures/invalid-manifests/`.
- Plain and JSON version output fixtures in `fixtures/version-outputs/`.
- Platform id fixture in `fixtures/platforms/platform-ids.json`.
- `tests/fixtures.test.mjs` proving golden manifests pass, invalid manifests fail, version outputs match, and specs have coverage.

Exit gate:

- `pnpm test` passes.

## Phase B: Manifest Validator

Deliverables:

- `tools/validate-manifest/` workspace package.
- `deploy-toolkit-validate-manifest` bin entry.
- AJV 2020-12 validation using `schemas/deployment-toolkit.schema.json`.
- Directory and file target support for CI.

Exit gate:

- `node tools/validate-manifest/index.mjs fixtures/manifests` validates every golden manifest.
- Every invalid fixture under `fixtures/invalid-manifests/` exits non-zero.

## Phase C: Binary-Side Libraries

Rust:

- Implement `deploy-toolkit-cli` formatting for plain and JSON output.
- Read package version from Cargo metadata and optional build metadata from generated environment variables.
- Add Clap and manual-argv examples.

Node:

- Implement `@deploy-toolkit/node` helpers for npm binaries.
- Generate MCP `serverInfo.version` from package metadata instead of hard-coded constants.

.NET:

- Implement `DeployToolkit` version output from assembly/package metadata.
- Support global tool and sidecar entry points.

Exit gate:

- Fixture outputs for `deslop`, `deslop-lsp`, `deslop-mcp`, `tmc-server`, `forge-sidecar-csharp`, and `dart-mutant` can be generated from helper libraries without hand-written string formatting.

## Phase D: Host Resolver Libraries

Shared resolver order:

1. Exact configured binary path.
2. Configured directory containing the expected binary.
3. Environment path override.
4. Environment directory override.
5. Bundled binary under the host package root.
6. Package manager or language tool fallback.
7. PATH lookup.
8. Host-specific protocol fallback such as Zed LSP initialize.

Required resolver outcomes:

- `resolved-match`
- `resolved-version-mismatch`
- `resolved-unparseable-version`
- `missing-required`
- `missing-optional`
- `probe-failed`

Exit gate:

- Rust and TypeScript resolver test vectors share the same fixture JSON.
- VS Code, JetBrains, and Zed adapters report expected version, found version, selected source, and next action.

## Phase E: Packaging and Release Workflows

Deliverables:

- `deploy-toolkit verify-binaries`.
- `deploy-toolkit verify-extension-package`.
- `templates/gh-actions/release-binary-multiplatform.yml`.
- `templates/gh-actions/publish-brew-tap.yml`.
- `templates/gh-actions/publish-scoop-bucket.yml`.

Exit gate:

- A product CI job fails when `deployment-toolkit.json` expects one version and the built binary reports another.
- VSIX package checks enforce `bin/<platform>/<binaryName><exe>` for native binaries.
- Brew and Scoop templates receive release asset URLs and sha256 values as inputs.

## Ownership

| Path | Owner |
| --- | --- |
| `schemas/*` | DepToolkitOpus unless explicitly handed off |
| `fixtures/*` | DepToolkitCodex |
| `tools/validate-manifest/*` | DepToolkitCodex |
| `templates/gh-actions/*` | DepToolkitCodex |
| `docs/specs/*` | Shared, lock before editing |
| `docs/plans/*` | Shared, lock before editing |

## TODO

- [x] Establish generic public package names for reusable libraries.
- [x] Keep Nimblesite product fixtures Nimblesite-specific.
- [x] Add AJV manifest validator workspace package.
- [x] Add golden and invalid fixture tests.
- [x] Add reusable GitHub Actions workflow templates for binary release, Brew, and Scoop.
- [x] Scaffold `deploy-toolkit-manifest` with version-output types and formatter tests.
- [x] Implement `@deploy-toolkit/core` resolver conformance against `schemas/test-vectors.json`.
- [x] Implement `deploy-toolkit-cli` Rust helpers.
- [x] Implement `@deploy-toolkit/vscode` activation helper.
- [x] Implement `@deploy-toolkit/node` MCP version helper.
- [x] Implement `DeployToolkit` .NET version helper.
- [x] Implement `deploy-toolkit verify-binaries`.
- [x] Implement `deploy-toolkit verify-extension-package`.
