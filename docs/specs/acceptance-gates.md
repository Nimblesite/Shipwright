# Shipwright Acceptance Gates

```
Spec prefix: SWR-GATE-*
Status: Draft
```

These gates define what product repos must prove before they can claim Shipwright compliance.

## [SWR-GATE-VERIFY-BINARIES] `verify-binaries`

Inputs:

- Product `shipwright.json`.
- Target platform id.
- Build output root or installed tool root.

Required checks:

- Every required executable component resolves from the configured source chain.
- Every resolved executable returns the manifest `expectedVersion` from `--version`.
- Every executable that supports JSON output conforms to `schemas/version-manifest.schema.json`.
- Protocol servers expose the same version through initialize metadata when their host requires it.
- Optional components can fail only when the manifest marks `"required": false`.

## [SWR-GATE-VERIFY-EXT-PKG] `verify-extension-package`

Inputs:

- Product `shipwright.json`.
- Extension artifact path (VSIX, JetBrains ZIP/JAR, or Zed package).
- Target platform id.

Required checks:

- The artifact contains `shipwright.json`.
- VSIX native binaries are under `bin/<platform>/<binaryName><exe>`.
- VSIX platform-agnostic binaries are under `bin/all/<binaryName>`.
- JetBrains plugin packages either omit native binaries or place explicitly allowed helpers under plugin-root `bin/<platform>`.
- Zed packages declare `lsp-initialize` for components that cannot be preflighted by subprocess.
- Package contents include only manifest-listed binaries for the target platform.

## [SWR-GATE-VERIFY-EXT-TESTS] `verify-extension-tests`

Inputs:

- Product test command for the IDE extension.
- Product `shipwright.json`.
- Target platform id.

Required checks:

- The test command stages required binaries inside the extension bundle.
- Override variables for binary path and binary directory are cleared.
- Product binaries installed on PATH are removed or cause an immediate failure.
- Tests assert that every bundled required component resolves from `bundled`.
- Tests do not use build-output directories such as `target/release` as a resolver source.

## [SWR-GATE-STARTUP] Startup Contract

Every host library must exercise these resolver cases:

- Configured exact binary path.
- Configured directory containing the binary.
- Environment path and directory overrides.
- Bundled binary.
- Explicit package-manager repair prompt.
- Rejection of PATH/global-install fallback during normal startup.
- Version mismatch.
- Missing binary.
- Required component failure.
- Optional component warning.

## [SWR-GATE-CI] CI Contract

Product repos must run at minimum:

```bash
shipwright-validate-manifest shipwright.json
<binary> --version
<binary> --version --json
```

When the full CLI is available, also run:

```bash
shipwright verify-binaries --manifest shipwright.json --platform <target>
shipwright verify-extension-package --manifest shipwright.json --package <artifact> --platform <target>
shipwright verify-provenance --artifact <file> --repo <owner/repo> \
  --signer-workflow <owner/repo>/.github/workflows/release.yml
```

Product CI MUST also run the shipped supply-chain lint (zizmor via
`templates/gh-actions/lint-supply-chain.yml`), and MUST fail when a `githubRelease` component sets
`provenance`/`signature`/`sbom` to a weaker value than the product's `supplyChain` policy requires.
The six gates below define the conformance checks; each enforces a `SWR-SEC-*` control in
[supply-chain-security.md](supply-chain-security.md).

## [SWR-GATE-ACTION-PINNING] `action-pinning`

Parse every `.github/workflows/*.yml` and every shipped `templates/gh-actions/*.yml` with a real
YAML parser. Fail if any `uses:` value — or any reusable-workflow ref — is not a full 40-hex
commit SHA (a `@vN`, `@branch`, or `@master` ref fails). Enforces [SWR-SEC-ACTION-PINNING].

## [SWR-GATE-TOKEN-PRIVILEGE] `token-privilege`

Fail if any workflow omits a top-level `permissions:` block, or declares `contents: write`,
`id-token: write`, or `attestations: write` at the **workflow top level** (these must be job-scoped).
Enforces [SWR-SEC-TOKEN-PRIVILEGE].

## [SWR-GATE-FROZEN-INSTALL] `frozen-install`

Fail on any bare `npm install`/`pnpm install` (no `--frozen-lockfile`) or any `cargo build|test|run`
missing `--locked`, in workflows **and** in committed scripts. Fail on a `dtolnay/rust-toolchain@stable`
branch ref for a release build. Enforces [SWR-SEC-FROZEN-INSTALL].

## [SWR-GATE-PROVENANCE] `provenance`

Fail a release that produces a `githubRelease` asset (or a published VSIX/package) with no matching
`actions/attest-build-provenance` attestation, and fail if the manifest's `supplyChain.provenance`
is true but the release workflow emits none. Consumers verify with `gh attestation verify`
pinned to `--repo` + `--signer-workflow`. Enforces [SWR-SEC-PROVENANCE].

## [SWR-GATE-SBOM] `sbom`

Fail if no CycloneDX SBOM is generated and attested per artifact when `supplyChain.sbom` ≠ `none`.
Rust binaries MUST be built with `cargo-auditable`. Enforces [SWR-SEC-SBOM].

## [SWR-GATE-VULN-SCAN] `vuln-scan`

Require `osv-scanner`, `cargo-deny` (with a committed `deny.toml`), and `grype` (against the SBOM)
steps in product CI, failing at the `supplyChain.vulnGate` severity. Suppressions require a committed
reason **and** expiry date. Enforces [SWR-SEC-VULN-GATE].
