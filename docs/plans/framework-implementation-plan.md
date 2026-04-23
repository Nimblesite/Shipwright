# Deployment Toolkit Framework Implementation Plan

Status: Draft

## Goal

Build a shared deployment framework that lets Nimblesite products ship matching binaries and IDE extensions with one-click installation and predictable startup checks.

Detailed library algorithms, module ownership, and package layout belong in the companion libs plan: `docs/plans/libs-implementation-plan.md`. This plan owns the rollout shape, integration gates, product migration order, and cross-repo acceptance criteria.

## Phase 1: Lock the Contract

Turn the specs into enforceable contracts before any product migration starts.

Deliverables:

- `deployment-toolkit.json` schema.
- Golden manifests for Deslop, Basilisk, Forge, TMC, and dart_mutant.
- Golden `--version` outputs for Rust, Node, and .NET components.
- Platform id fixtures for `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, and `win32-x64`.
- A compatibility matrix that says which checks run in VS Code, JetBrains, Zed, CLI-only, and package-manager-only contexts.

Exit criteria:

- Schema validation passes for every golden manifest.
- Invalid fixtures cover missing component id, bad semver, unsupported platform, and missing required binary.
- Each spec has a matching test fixture or explicit implementation ticket.

## Phase 2: Define Cross-Repo Acceptance Gates

Create the checks every product repo must eventually run.

Deliverables:

- A `verify-binaries` acceptance checklist.
- A `verify-extension-package` acceptance checklist.
- A CI contract that fails on extension/binary version drift.
- A startup contract that fails on missing or mismatched configured paths.

Required checks:

- Every required component reports the expected version.
- Every bundled binary path exists for the declared platform.
- Every protocol server reports the same version through initialize.
- Every editor resolver has tests for configured path, configured dir, bundled binary, PATH fallback, mismatch, and missing binary.

## Phase 3: CLI Pilot

Use the simplest repo to prove the binary contract without editor packaging noise.

Pilot:

- `dart_mutant`

Exit criteria:

- The binary reports the shared text and JSON version contract.
- CI proves the version contract without needing an IDE.
- The product has a minimal manifest with one component.

## Phase 4: VS Code Package Pilots

Use VS Code next because VSIX packaging is the strictest one-click install path.

Pilots:

- Deslop VSIX: strong existing resolver, needs exact override behavior and LSP `--version` proof.
- Forge VSIX: existing install helpers, needs startup to call verification and include sidecars.
- Basilisk VSIX: needs bundled binaries and exact startup checks.
- TMC VSIX: needs npm binary version validation before spawning the local MCP server.

Exit criteria:

- VSIX packages include a manifest.
- Required bundled binaries exist where the product requires bundling.
- Activation fails visibly on version mismatch.
- A matching configured external binary works.

## Phase 5: JetBrains and Zed Pilots

Move to hosts with different process and packaging constraints.

JetBrains pilots:

- Deslop JetBrains plugin.
- Forge Rider plugin.

Zed pilots:

- Basilisk Zed.
- Forge Zed.

Exit criteria:

- JetBrains plugins verify external and bundled binaries before LSP startup.
- Zed extensions verify version through LSP initialize when preflight subprocess execution is unavailable.
- User-facing errors include expected version, found version, and next action.

## Phase 6: Multi-Binary Products

Close the hard cases after the resolver contract is stable.

Products:

- Forge: Rust LSP plus .NET sidecars.
- Basilisk: Rust CLI/LSP plus profiler helper.
- Deslop: CLI, LSP, MCP, VSIX contribution, and JetBrains plugin.
- Too Many Cooks: npm binary plus MCP server metadata.

Exit criteria:

- Every required sidecar/helper is listed in the manifest.
- The editor checks every required component before ready state.
- Package-manager repair flows are explicit and prompted.

## Phase 7: Release and CI Rollout

Add release packaging only after the product integrations prove the runtime contract.

Deliverables:

- Product CI examples.
- Release asset verification checklist.
- VSIX and JetBrains package contents verification.
- Version drift failure examples.

Exit criteria:

- A product repo fails CI when an extension version and bundled binary version drift.
- A generated IDE package contains only manifest-listed binaries for supported platforms.

## Product Migration Order

Recommended order:

1. dart_mutant: simplest Rust CLI adopter.
2. Forge: has explicit Rust and .NET `--version` contracts and sidecar complexity.
3. Deslop: strong VSIX precedent, but needs LSP and JetBrains gaps closed.
4. Basilisk: broader surface with VSIX, Zed, and profiler helper.
5. Too Many Cooks: Node/npm contract and MCP version drift cleanup.

## TODO

- [ ] Keep detailed library implementation steps in `docs/plans/libs-implementation-plan.md`.
- [ ] Review `docs/plans/libs-implementation-plan.md` for overlap before either plan is marked accepted.
- [ ] Create the initial manifest schema and golden fixtures in this repo.
- [ ] Add a failing contract test in Deslop proving `deslop-lsp --version` must exit with `deslop-lsp 0.1.0`.
- [ ] Add a failing contract test in TMC proving MCP `serverInfo.version` must match npm package version `0.5.0`.
- [ ] Define the VSIX package contents check for bundled binaries under `bin/<platform>`.
- [ ] Define the JetBrains plugin contents check for bundled binaries under plugin-root `bin/<platform>`.
- [ ] Define the Zed initialize-version check for hosts that cannot run `--version` before startup.
- [ ] Create product migration tickets for dart_mutant, Forge, Deslop, Basilisk, and Too Many Cooks.
- [ ] Add CI gate examples that fail on manifest/binary drift.
