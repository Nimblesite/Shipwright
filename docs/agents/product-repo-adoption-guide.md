# Product Repo Adoption Guide For AI Agents

```
Status: Draft
```

This guide is for AI agents integrating Shipwright into a product repo.

## First Rules

1. Lock every file before editing it.
2. Do not edit files locked by another agent.
3. Keep Shipwright library and package names generic.
4. Keep product manifests and fixtures product-specific.
5. Add or update tests before fixing implementation drift.
6. Validate with the smallest targeted command first, then run the repo's normal test command.
7. Message coordination status on TMC whenever you claim scope, change scope, hit a blocker, or finish a validation step.

## Opt-In Checklist

Use this checklist for every product repo.

### 1. Add `shipwright.json`

Create a product manifest at the product repo root or package root. Start from the closest fixture:

| Product shape | Start from |
| --- | --- |
| CLI-only | `fixtures/manifests/dart-mutant.json` |
| Rust CLI/LSP/MCP | `fixtures/manifests/deslop.json` |
| Rust LSP plus .NET sidecars | `fixtures/manifests/sharplsp.json` |
| VS Code plus Zed | `fixtures/manifests/basilisk.json` |
| Node/npm MCP server | `fixtures/manifests/too-many-cooks.json` |

Validate it from the Shipwright repo:

```bash
node tools/validate-manifest/index.mjs /path/to/product/shipwright.json
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

- LSP: `InitializeResult.serverInfo.version` must match.
- MCP: `serverInfo.version` must match the package version.

Add the failing tests first if the product does not support this yet.

### 3. Wire Version Implementation

Use the appropriate Shipwright library for the product language.

Rust:

- Use `shipwright` crate.
- `--version` must run before workspace-root parsing or server startup.
- `--version --json` must run before tracing/server startup if possible.

Node and MCP:

- Use `@nimblesite/shipwright-mcp`.
- Do not hard-code `serverInfo.version`.
- Add a test that compares `serverInfo.version` to `package.json`.

.NET:

- Use the `Shipwright` NuGet library.
- Derive version from assembly/package metadata.
- Keep plain and JSON output identical to the schema examples.

Dart:

- Use the `shipwright` pub package.
- Add a CLI version command.
- Emit JSON shape compatible with `schemas/version-manifest.schema.json`.

### 4. Wire Host Resolver Checks

Editor integrations must verify every required component before ready state.

VS Code:

- Load `shipwright.json` from the extension package.
- Use `@nimblesite/shipwright-vscode` for resolution.
- Resolve in this order: user setting, env, bundled.
- Do not inspect PATH, mutate PATH, run `which`/`where`, or use package-manager/global installs
  as normal VS Code startup sources. Package managers are explicit repair flows only.
- Accept a user-configured binary only when its version matches.
- Bundle native binaries under `bin/<vsceTarget>/<binaryName><exe>` where `vsceTarget` equals the platform id (e.g. `darwin-arm64`). See `schemas/platforms.json`.
- Bundle platform-agnostic tools under `bin/all/<binaryName>`.
- Execute bundled VSIX binaries directly from the unpacked extension folder. Do not copy them to
  another directory during install or activation.
- Surface mismatch errors with expected version, found version, and selected path.
- Extension tests must stage binaries inside the extension bundle, clear binary override environment variables, remove PATH-installed product binaries, and assert the accepted resolver source is `bundled`.
- `package.json` `engines.vscode` must be `^1.99.0` or later.
- Build VSIX with `npx vsce package --target <vsceTarget>`. See spec [SWR-VSIX-PACKAGE] in `docs/specs/vsix-platform-bundling.md`.

JetBrains:

- Load `shipwright.json` from plugin root.
- Resolve user setting, env, and bundled plugin binary before LSP descriptor startup.
- Package managers are explicit repair flows, not startup sources.
- Report failures through notifications/Event Log with expected and found versions.

Zed:

- Use `shipwright-zed`.
- If subprocess preflight is unavailable, declare `lsp-initialize`.
- Verify the server version from initialize metadata.

### 5. Add Package Contents Tests

For IDE extensions, add tests that inspect the produced package artifact.

VSIX must prove:

- `shipwright.json` is included at the extension root.
- Each required bundled native binary exists under `bin/<vsceTarget>/<binaryName><exe>` (e.g. `bin/darwin-arm64/product-lsp`).
- No unmanifested binary is present for the target platform.
- Bundled binary reports `expectedVersion`.
- Extension activation tests use bundled binaries, not `target/release` or PATH.
- Native VSIX packages contain exactly one `bin/<vsceTarget>/` directory and no foreign platform bins.
- VSIX artifacts do not contain `out/`, source trees, unbundled `node_modules/`, runtime caches, or
  post-install binary copies.

Verify binary presence in the VSIX automatically (see [SWR-VSIX-VERIFY] in `docs/specs/vsix-platform-bundling.md`):

```bash
unzip -l my-extension-darwin-arm64.vsix | grep -F "bin/darwin-arm64/my-lsp"
```

### 6. Add CI Gates

At minimum, product CI must run:

```bash
node /path/to/shipwright/tools/validate-manifest/index.mjs shipwright.json
<binary> --version
<binary> --version --json
```

VS Code extensions with native binaries MUST use the `publish-vsix-per-platform.yml` reusable workflow from `templates/gh-actions/`. It handles the 6-platform build matrix, binary staging, `vsce package --target`, VSIX content verification, and atomic Marketplace publish. See `docs/specs/vsix-platform-bundling.md` for the full pipeline spec.

When the full Shipwright CLI is available:

```bash
shipwright verify-binaries --manifest shipwright.json --platform <platform>
shipwright verify-extension-package --manifest shipwright.json --package <artifact> --platform <platform>
```

### 7. Update Shipwright Fixtures

When a product repo adopts or changes the contract, update the Shipwright repo too:

- `fixtures/manifests/<product>.json`
- `fixtures/version-outputs/<language>/<binary>.txt`
- `fixtures/version-outputs/<language>/<binary>.json`

## Resolver Port Instructions

Every resolver port must pass `schemas/test-vectors.json`.

Use the TypeScript core implementation as the most readable reference:

```text
clients/ts/packages/shipwright-core/src/resolve.ts
```

Use the Rust host crate as the strict reference:

```text
crates/shipwright-host/src/lib.rs
```

Required behavior:

- user setting mismatch is a hard error
- env mismatch is a hard error for required components
- bundled mismatch is a hard error for required components
- PATH and global package-manager installs are not normal startup sources
- package-manager repair returns a prompt action
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
- Keep Shipwright library code generic.

Before handoff:

- Run targeted tests.
- Run the repo's broader validation where reasonable.
- Update any plan TODOs you completed.
- Report expected failing tests clearly.
- Release locks you own.

## What Counts As Done

A product is opted in when:

- it has a valid `shipwright.json`
- every required executable reports exact plain and JSON versions
- protocol initialize metadata matches package/binary version
- every IDE extension verifies required components on startup
- package artifacts contain only manifest-listed binaries
- CI fails on manifest, binary, protocol, or package drift
