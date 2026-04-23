# Product Repo Adoption Guide For AI Agents

Status: Draft

This guide is for AI agents modifying Deslop, Basilisk, Forge, Too Many Cooks, dart_mutant, or any later product repo that opts into Deployment Toolkit.

## First Rules

1. Lock every file before editing it.
2. Do not edit files locked by another agent.
3. Keep reusable library/package names generic.
4. Keep Nimblesite product manifests and fixtures product-specific.
5. Add or update tests before fixing implementation drift.
6. Validate with the smallest targeted command first, then run the repo's normal test command.
7. Message coordination status on TMC whenever you claim scope, change scope, hit a blocker, or finish a validation step.

## Opt-In Checklist

Use this checklist for every product repo.

### 1. Add `deployment-toolkit.json`

Create a product manifest at the product repo root or package root. Start from the closest fixture:

| Product shape | Start from |
| --- | --- |
| CLI-only | `fixtures/manifests/dart-mutant.json` |
| Rust CLI/LSP/MCP | `fixtures/manifests/deslop.json` |
| Rust LSP plus .NET sidecars | `fixtures/manifests/forge.json` |
| VS Code plus Zed | `fixtures/manifests/basilisk.json` |
| Node/npm MCP server | `fixtures/manifests/too-many-cooks.json` |

Validate it from `deployment_toolkit`:

```bash
pnpm validate:manifest /path/to/product/deployment-toolkit.json
```

If validation fails, fix the manifest or schema deliberately. Do not remove required fields to make the test easier.

### 2. Add Binary Version Tests

Every executable component in `components[]` must have tests for:

```bash
<binary> --version
<binary> --version --json
```

Plain output must be exactly:

```text
<binaryName> <expectedVersion>
```

JSON output must conform to `schemas/version-manifest.schema.json`.

For protocol servers, also test initialize metadata:

- LSP: initialize result must carry the same product version where supported.
- MCP: `serverInfo.version` must match the npm/package version.

Add the failing tests first if the product does not support this yet.

### 3. Wire Version Implementation

Use shared helpers where they exist. If the helper for the product language is not ready, implement the product behavior directly but keep the exact contract.

Rust:

- Use generic `deploy-toolkit-*` crates when available.
- `--version` must run before workspace-root parsing or server startup.
- `--version --json` must run before tracing/server startup if possible.

Node and MCP:

- Do not hard-code `serverInfo.version`.
- Derive it from the package version or a generated build/version module.
- Add a test that compares `serverInfo.version` to `package.json`.

.NET:

- Derive version from assembly/package metadata.
- Support sidecars and dotnet tools.
- Keep plain and JSON output identical to the schema examples.

Dart:

- Add a CLI version command.
- Emit JSON shape compatible with `schemas/version-manifest.schema.json`.

### 4. Wire Host Resolver Checks

Editor integrations must verify every required component before ready state.

VS Code:

- Load `deployment-toolkit.json` from the extension package.
- Resolve in this order when declared: user setting, env, bundled, package manager/tool, PATH.
- Accept a user-configured binary only when its version matches.
- Bundle native binaries under `bin/<platform>/<binaryName><exe>`.
- Bundle platform-agnostic tools under `bin/all/<binaryName>`.
- Surface mismatch errors with expected version, found version, and selected path.

JetBrains:

- Load the manifest from plugin root.
- Resolve user setting, env, package manager/tool, and PATH before LSP descriptor startup.
- If native binaries are bundled, ensure every bundled path is listed in the manifest.
- Report failures through notifications/Event Log with expected and found versions.

Zed:

- If subprocess preflight is unavailable, declare `lsp-initialize`.
- Verify the server version from initialize metadata.
- Record cached binary version and checksum for downloaded binaries.

CLI/package-manager:

- Check release asset version before publishing package-manager manifests.
- Brew and Scoop metadata must point at the same tag/version and asset checksum.

### 5. Add Package Contents Tests

For IDE extensions, add tests that inspect the produced package artifact.

VSIX must prove:

- `deployment-toolkit.json` is included.
- each required bundled native binary exists under `bin/<platform>/`
- no unmanifested binary is present for the target platform
- bundled binary reports `expectedVersion`

JetBrains must prove:

- plugin root contains `deployment-toolkit.json`
- any bundled helpers are listed in the manifest
- LSP startup is blocked on mismatched required binaries

Zed must prove:

- components that cannot be preflighted use `lsp-initialize`
- initialize metadata mismatch is reported and blocks readiness

### 6. Add CI Gates

At minimum, product CI must run:

```bash
pnpm validate:manifest deployment-toolkit.json
<binary> --version
<binary> --version --json
```

When the shared CLI commands are available, add:

```bash
deploy-toolkit verify-binaries --manifest deployment-toolkit.json --platform <platform>
deploy-toolkit verify-extension-package --manifest deployment-toolkit.json --package <artifact> --platform <platform>
```

Until then, implement equivalent product-local tests.

### 7. Update Deployment Toolkit Fixtures

When a product repo adopts or changes the contract, update this repo too:

- `fixtures/manifests/<product>.json`
- `fixtures/version-outputs/<language>/<binary>.txt`
- `fixtures/version-outputs/<language>/<binary>.json`
- `docs/plans/product-migration-tickets.md`

Run:

```bash
pnpm test
```

## Product-Specific Instructions

### dart_mutant

Goal: CLI pilot.

Do:

- Add `deployment-toolkit.json`.
- Add `dart-mutant --version`.
- Add `dart-mutant --version --json`.
- Validate package release version against the manifest.

Do not:

- Add IDE packaging complexity before the CLI contract is green.

### Forge

Goal: multi-binary pilot.

Do:

- Add manifest entries for `forge-lsp`, `forge-sidecar-csharp`, and `forge-sidecar-fsharp`.
- Make every sidecar report the same expected version.
- Check sidecars before editor ready state.
- Verify VSIX bundled `forge-lsp` paths under `bin/<platform>`.

Do not:

- Let the Rust LSP and .NET sidecars carry separate release versions unless the manifest explicitly models that.

### Deslop

Goal: VS Code and JetBrains pilot.

Do:

- Add or keep tests for `deslop`, `deslop-lsp`, and `deslop-mcp`.
- Ensure `deslop-lsp --version` prints `deslop-lsp 0.1.0`.
- Ensure `--version` is handled before interpreting args as a workspace root.
- Check VSIX package contents for `deslop-lsp`, `deslop-mcp`, and `deslop` where bundled.
- Keep JetBrains resolver behavior aligned with the manifest.

Known contract test:

```bash
cargo test -p deslop-lsp prints_exact_version_contract
```

### Basilisk

Goal: VS Code plus Zed pilot.

Do:

- Add manifest entries for CLI, LSP, and optional profiler helper.
- Use `lsp-initialize` for Zed verification when subprocess checks are unavailable.
- Treat profiler helper failures as optional only when `"required": false`.

Do not:

- Block the main LSP on optional profiler helper failure unless the manifest marks it required.

### Too Many Cooks

Goal: Node/npm MCP pilot.

Do:

- Add `deployment-toolkit.json`.
- Add `tmc-server --version`.
- Add `tmc-server --version --json`.
- Derive MCP `serverInfo.version` from the package version.
- Add a contract test that compares serverInfo version to `package.json`.

Known contract test:

```bash
node --import tsx --test --test-concurrency=1 packages/too-many-cooks/test/server_version_contract_test.ts
```

Expected current failure until fixed:

```text
'0.1.0' == '0.5.0'
```

## Resolver Port Instructions

Every resolver port must pass `schemas/test-vectors.json`.

Use the TypeScript core implementation as the most readable reference:

```text
clients/ts/packages/deploy-toolkit-core/src/resolve.ts
```

Use the Rust host crate as the strict reference:

```text
crates/deploy-toolkit-host/src/lib.rs
```

Required behavior:

- user setting mismatch is a hard error
- PATH mismatch is skipped in favor of later sources
- env mismatch is accepted with a warning
- bundled mismatch is accepted with a warning
- missing package-manager binaries return a prompt action
- Zed-style `lsp-initialize` returns a deferred check
- Windows platforms append `.exe`

## Coordination Checklist For Agents

Before editing:

- Register on TMC.
- Read the current TMC messages.
- Lock the exact files you will edit.
- Announce the repo and scope.

While editing:

- Send TMC updates after each meaningful step.
- Keep product-specific manifests product-specific.
- Keep shared library code generic.
- Do not change schema identifiers or product names as a rebrand exercise.

Before handoff:

- Run targeted tests.
- Run the repo's broader validation where reasonable.
- Update any plan TODOs you completed.
- Report expected failing tests clearly.
- Release locks you own.

## What Counts As Done

A product is opted in when:

- it has a valid `deployment-toolkit.json`
- every required executable reports exact plain and JSON versions
- protocol initialize metadata matches package/binary version
- every IDE extension verifies required components on startup
- package artifacts contain only manifest-listed binaries
- CI fails on manifest, binary, protocol, or package drift
