<!-- agent-pmo:f481f8d -->
# Shipwright — Agent Instructions

> ⚠️ **TOKEN DISCIPLINE.** Check file size first. `Grep` over `Read`. Use `offset`/`limit`.
> Smallest diff that solves the problem. Delete dead code, unused imports, stale comments.
> Call out irrelevant context before proceeding. Bloat degrades reasoning. ⚠️

> Read this file in full. Rules below are NON-NEGOTIABLE — violations are rejected in review.

## Project Overview

`Shipwright` is a portfolio-shared library that scaffolds binary and IDE-extension deployment in a consistent way across multiple downstream products (Too Many Cooks, Deslop, Basilisk, SharpLsp, dart_mutant — see [docs/specs/source-projects.md](docs/specs/source-projects.md)). It defines the binary version contract, manifest schema, compatibility matrix, and the host-side resolution algorithm that IDE extensions use to locate and verify their backing binaries before launching them. See [docs/specs/](docs/specs/) for the authoritative behavior specs and [docs/plans/](docs/plans/) for the implementation plan.

**Primary language(s):** Rust (workspace, libraries) + Node/TypeScript (manifest validator + fixture tests)
**Build command:** `make ci`
**Test command:** `make test`
**Lint command:** `make lint`

## Too Many Cooks (Multi-Agent Coordination)

If the TMC server is available: register on start (name, intent, files), lock files before editing, broadcast your plan, check messages periodically, release locks when done. Never edit a locked file — wait or take another approach.

## Hard Rules — Universal (no exceptions)

- **NO git commands.** No `add`, `commit`, `push`, `checkout`, `merge`, `rebase`, etc. CI handles git.
- **ZERO DUPLICATION.** Search before writing. Move code, don't copy it.
- **NO EXCEPTIONS for control flow.** Return `Result<T,E>`. Exceptions are panic-level only.
- **NO REGEX on structured data.** Use real parsers for JSON/YAML/TOML/code.
- **NO PLACEHOLDERS.** Use `todo!()` — never silently no-op.
- **Functions < 20 lines. Files < 500 lines.** Refactor when over.
- **Never delete or skip tests. Never remove assertions.** 100% coverage is the goal.
- **`make test` is FAIL-FAST.** Stops at first failing test. Never `--no-fail-fast`. Saves CI minutes; stops agents idling on doomed runs. See REPO-STANDARDS-SPEC [TEST-RULES].
- **`make test` ALWAYS computes coverage AND enforces it.** Threshold lives in `coverage-thresholds.json` at the repo root — NOT env vars, NOT gh repo variables, NOT CI YAML. Below threshold = pipeline fails. Ratchet only. See [COVERAGE-THRESHOLDS-JSON].
- **Prefer E2E/integration tests.** Unit tests only for isolating problems.
- **Heavy structured logging everywhere.** See Logging below.
- **No linter suppressions.** Fix the code.
- **Pure functions over statements.**
- **Spec IDs are hierarchical, non-numeric: `[GROUP-TOPIC]` / `[GROUP-TOPIC-DETAIL]` or `SWR-GROUP-TOPIC` / `SWR-GROUP-TOPIC-DETAIL`** (e.g., `[AUTH-TOKEN-VERIFY]`, `[CI-TIMEOUT]`, `SWR-IDE-DOTNET-RUNTIME`). Same-group sections sit adjacent in the TOC. NO sequential numbers (`[SPEC-001]`, `SWR-SPEC-001`). Code/tests/docs that implement a spec section MUST reference its ID in a comment so `grep SWR-IDE` finds spec → code → tests in one shot.

## Logging Standards

- **Structured logging library only.** Never `println!` (Rust) or `console.log` (TS). Library per language: Rust `tracing`, TS `pino`.
- **Log at entry/exit of significant operations.** Levels: `error|warn|info|debug|trace`. Silent failures are forbidden.
- **Structured fields, not string interpolation.** `{ binary: "deslop-lsp", expected: "0.3.1", found: "0.2.0" }` — never `"deslop-lsp version mismatch"`.
- **NEVER log PII.** **NEVER log secrets.** Log `"key: present"` or a truncated hash, never the value.

## Hard Rules — Language-Specific

### Rust
- No `unwrap()`/`expect()` in production (tests OK for `expect`).
- No `panic!`/`todo!`/`unimplemented!`/`unreachable!` in production.
- No `unsafe {}` or `allow(clippy::...)` without documented justification.
- All public items have `///` doc comments.
- `thiserror` for library errors; `anyhow` only in application code.
- Workspace lints in `Cargo.toml [workspace.lints]` are deny-by-default — do not weaken them.
- `crates/shipwright-host` is the pure binary-resolution algorithm with NO I/O. The probe is injected. Keep it that way.

### TypeScript / Node
- No `any` (use `unknown` and narrow). No `!` non-null assertion. No `// @ts-ignore`/`@ts-nocheck`.
- No implicit `any` — annotate every parameter and return type.
- No `as Type` casts without a comment explaining safety.
- No throwing — return `Result<T,E>` (discriminated union).
- Tests use the Node built-in `node --test` runner (see `tests/fixtures.test.mjs` and `tools/validate-manifest/`). New TS code is allowed but must run on Node ≥ 20 with `"type": "module"`.

## Testing Rules

- **Never delete a failing test.** Fix the code or the expectation.
- **Never skip a test** without a ticket number AND expiry date in the skip reason.
- **Specific assertions only.** `assert.ok(true)` is illegal.
- **No try/catch in tests that swallows exceptions and asserts success.**
- **Deterministic.** No `sleep()`, no timing dependencies, no random state.
- **E2E tests: black-box only** — public APIs or CLI. Never reach into internals.
- **Manifest fixtures** live in `fixtures/manifests/` and `fixtures/golden-manifests/`. Add a fixture for every new schema branch you cover.

## Build Commands

Agent PMO make targets 

```bash
make build   # compile everything (Rust workspace + Node tools)
make test    # FAIL-FAST tests + coverage + threshold (ONLY test entry point)
make lint    # all linters/analyzers (no formatting)
make fmt     # format in place
make clean   # remove build artifacts
make ci      # lint + test + build (full CI simulation)
make setup   # post-create dev environment setup
```

`make test` runs the test runner with its fail-fast flag, collects coverage, asserts measured ≥ threshold from `coverage-thresholds.json`, and exits non-zero on any failure. To debug a single test, invoke the runner directly — that is not a Makefile target.

**`make fmt`** formats code in-place. **`make lint`** runs linters/analyzers (read-only, no formatting). **`make test`** runs tests with coverage. Three separate targets — no overlap.

## Repo Structure

```
crates/                            # Rust workspace members
  shipwright-host/                 # pure binary-resolution algorithm (no I/O)
  shipwright-manifest/             # workspace member declared in Cargo.toml — NOT YET CREATED
clients/                           # per-language client SDKs (placeholders)
  dart/  dotnet/  kotlin/  ts/
docs/
  specs/                           # behaviour specs (binary-version-contract, compatibility-matrix, etc.)
  plans/                           # implementation plans with TODO checklists
schemas/                           # JSON schemas (shipwright, version-manifest, platforms, test-vectors)
fixtures/                          # manifests, golden manifests, version outputs, platform definitions
tools/
  validate-manifest/               # Node-based AJV validator (shipwright-validate-manifest)
templates/
  gh-actions/                      # downstream-project release/publish workflow templates
examples/ci/                       # example consumer CI configurations
tests/fixtures.test.mjs            # Node test runner over fixtures
```

**Architecture invariants:**

1. The Rust host crate (`shipwright-host`) MUST stay pure — no filesystem, network, or process spawning. The version-probe function is injected by the caller (the IDE extension).
2. The JSON schemas in `schemas/` are the source of truth for the manifest format. Generated client code (Rust, TS, Dart, .NET, Kotlin) consumes these schemas.
3. Every fixture in `fixtures/` is exercised by `tests/fixtures.test.mjs` against the AJV validator in `tools/validate-manifest/`.
4. `templates/gh-actions/` is shipped as-is to downstream products — never inline-modify; treat as published interface.

## .NET Runtime in VS Code Extensions — NON-NEGOTIABLE

Any VS Code extension with framework-dependent .NET sidecars (`"language": "dotnet"` components) MUST use the `.NET Install Tool` extension to acquire the runtime. This is the ONLY permitted approach.

- `"extensionDependencies": ["ms-dotnettools.vscode-dotnet-runtime"]` in `package.json`
- `dotnet.findPath` then `dotnet.acquire` commands on activation — non-interactive toast spinner
- Set `DOTNET_ROOT` in the env passed to the Rust LSP host
- On failure: non-modal error notification + `retryDotnetAcquisition` command
- **NEVER** crash on missing .NET. **NEVER** `dotnet tool install`. **NEVER** hand-roll a download.

Full spec: `docs/specs/ide-extension-deployment.md` [SWR-IDE-DOTNET-RUNTIME]

## Key External References

Agents working on VSIX bundling, CI templates, or the vscode host library MUST read these before writing any code. The Microsoft sample is the authoritative source — follow it exactly.

- **Microsoft platform-specific sample** (AUTHORITATIVE): https://github.com/microsoft/vscode-platform-specific-sample/tree/main
  - CI workflow (Node 22.x, matrix shape, publish job): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.github/workflows/ci.yml
  - `.vscodeignore` (node_modules whitelist pattern): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.vscodeignore
  - Runtime binary resolution (`extension.js`): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/extension.js
- **VS Code bundling guide**: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- **Rust Analyzer release workflow** (inspiration): https://github.com/rust-lang/rust-analyzer/blob/2024-06-11/.github/workflows/release.yaml#L105
- **Shipwright VSIX spec** (implements the above): `docs/specs/vsix-platform-bundling.md`
- **Shipwright VSIX template** (ready to use): `templates/gh-actions/publish-vsix-per-platform.yml`
