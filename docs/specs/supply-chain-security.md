# Supply Chain Security Spec

```
Spec prefix: SWR-SEC-*
Status: Draft
Date: 2026-06-05
```

## [SWR-SEC-PURPOSE] Purpose

Shipwright is the build-and-distribution **integrity contract** for every Nimblesite
product (`too-many-cooks`, `Deslop`, `Basilisk`, `SharpLsp`, `dart_mutant`). It guarantees
that the binary, VSIX, npm package, crate, or NuGet package a user installs was built from
the reviewed source, by the expected pipeline, and reaches the running process unmodified.

The contract floor is **SLSA v1.0 Build Level 2** — the level GitHub-hosted runners deliver
through Artifact Attestations: provenance that is *signed* and bound to a *hosted* build
platform, so it cannot be forged after the build. Build Level 3 (tamper-proof run isolation
with signing material inaccessible to build steps) is **NOT** achievable on standard
GitHub-hosted runners and MUST NOT be claimed in any spec, manifest, or marketing.
See SLSA v1.0 levels (slsa.dev/spec/v1.0/levels) and GitHub Docs, which states plainly that
"Artifact attestations by itself provides SLSA v1.0 Build Level 2"
(docs.github.com/en/actions/concepts/security/artifact-attestations).

Therefore every release artifact MUST be built on a GitHub-hosted runner — **never** a
developer workstation, which provides no attestable build identity.

## [SWR-SEC-POSITIONING] Positioning

Shipwright **requires and verifies** build provenance, a software bill of materials, and a
cryptographically signed checksum set for every distributed artifact, and it enforces those
integrity claims at the download/bundle boundary and at host activation.

A self-published `SHA256SUMS` file is **not** sufficient on its own: an attacker who can write
to a GitHub Release (a leaked token, an over-scoped CI job) can replace the artifact *and* its
checksum together — this is the Codecov Bash Uploader class of attack. Integrity is therefore
anchored to a Sigstore-signed, Rekor-logged signature and to provenance bound to the exact
producing workflow identity, not to a checksum the producer simply asserts.

Shipwright **complements, and does not replace:**

- **OS code signing** — Apple Developer ID + notarization (Gatekeeper) and Windows
  Authenticode (SmartScreen). Sigstore proves *who built it and that it is unmodified*; OS
  signing is what lets the OS *run it without a scary dialog*. Both are required on the
  platforms that demand them. See [binary-signing-notarization.md](binary-signing-notarization.md).
- **Package registries** — Shipwright does not run a registry; it pins how products publish to
  and consume from npm, crates.io, NuGet, pub.dev, Maven Central, and the VS Code Marketplace.

## [SWR-SEC-THREATS] Threat Model

Each threat below is grounded in a real, named, recent incident and is closed by a control in
the matrix that follows. Authorities are cited inline.

1. **Build-system tampering under a legitimate signature.** Malicious code injected during the
   build, shipped signed and "clean". → *SolarWinds Orion / SUNBURST*, 2020 (CISA AA20-352A).
   Closed by **[SWR-SEC-PROVENANCE]**.
2. **Published artifact differs from reviewed source.** The backdoor lives only in the release
   tarball, not in the repository. → *xz-utils / liblzma backdoor*, CVE-2024-3094, 2024
   (thesamesam xz writeup). Closed by **[SWR-SEC-PROVENANCE]** + **[SWR-SEC-SBOM]**.
3. **Mutable action tag silently repointed to a malicious commit.** A `@v4`/`@v1` tag is moved
   to attacker code that dumps CI secrets. → *tj-actions/changed-files* (CVE-2025-30066),
   chained from *reviewdog/action-setup* (CVE-2025-30154), 2025 (CISA 2025-03-18 alert; Wiz).
   Closed by **[SWR-SEC-ACTION-PINNING]**.
4. **Over-broad `GITHUB_TOKEN` exfiltrated.** A compromised step inherits a workflow-wide
   write/`id-token` token and exfiltrates it. → *tj-actions/changed-files* secret leakage, 2025.
   Closed by **[SWR-SEC-TOKEN-PRIVILEGE]**.
5. **In-place tamper of a build tool/uploader.** A downloaded script is altered to steal CI
   environment secrets. → *Codecov Bash Uploader*, 2021 (CISA 2021-04-30). Closed by
   **[SWR-SEC-CHECKSUM]**.
6. **Stolen publishing token poisons a registry/marketplace.** A leaked npm/VSCE/Open VSX token
   publishes a malicious version under a trusted identity. → *event-stream*, 2018 (npm blog);
   *GlassWorm* on Open VSX, Oct 2025 / Jan 2026 (Eclipse Foundation; Dark Reading); *debug/chalk
   "Qix"* npm wave, 2025. Closed by **[SWR-SEC-OIDC-PUBLISH]**.
7. **Non-frozen install pulls a freshly published malicious version.** `npm install` resolves a
   newer, sabotaged version than the lockfile. → *colors.js/faker.js*, 2022; *ua-parser-js*,
   2021; *Shai-Hulud* npm worm, 2025 (Unit 42). Closed by **[SWR-SEC-FROZEN-INSTALL]** +
   **[SWR-SEC-VULN-GATE]**.
8. **Install-time script executes attacker code.** A hijacked dependency's `postinstall` runs
   in CI with secrets in scope. → *ua-parser-js*, 2021; *Shai-Hulud* self-replication via
   `postinstall`, 2025. Closed by **[SWR-SEC-FROZEN-INSTALL]**.
9. **Dependency confusion.** A public package shadows an internal name. → *Birsan dependency
   confusion*, 2021 (GitHub avoiding-npm-substitution-attacks). Closed by **[SWR-SEC-FROZEN-INSTALL]**.
10. **Deep transitive vulnerability is hard to locate.** "Are we affected, and where?" takes days.
    → *Log4Shell*, CVE-2021-44228, 2021 (CISA). Closed by **[SWR-SEC-SBOM]** + **[SWR-SEC-VULN-GATE]**.
11. **A VSIX ships a backing binary never verified against the signed release.** The bundled LSP
    is swapped between build and package. → *GlassWorm* VS Code extension supply-chain, 2025.
    Closed by **[SWR-SEC-CHECKSUM]** / `SWR-VSIX-BUNDLE-VERIFY`.
12. **Hidden binary substitution at runtime.** A stale global binary on PATH shadows the bundled
    one. Closed by the resolver rules in
    [ide-extension-deployment.md](ide-extension-deployment.md) (`SWR-IDE-RESOLUTION`).
13. **Version drift.** Package version and binary version disagree. Closed by the
    [Binary Version Contract](binary-version-contract.md) (`SWR-VERSION-MATCHING`).

## [SWR-SEC-CONTROLS] Controls Matrix

This is the centerpiece of the spec. Every row pairs a threat and a named incident with the
Shipwright control, the spec ID that owns it, and the authority that defines the practice.

| Threat | Named incident | Shipwright control | Spec ID | Authority |
|---|---|---|---|---|
| Build-time tampering shipped signed | SolarWinds / SUNBURST (2020) | Signed SLSA L2 build provenance; consumer verifies signer-workflow, fails closed | SWR-SEC-PROVENANCE | SLSA.dev; GitHub Docs; CISA AA20-352A |
| Published artifact ≠ source | xz-utils backdoor, CVE-2024-3094 (2024) | Provenance binds artifact digest to attested source+workflow; SBOM enumerates contents; Rekor logs every signature | SWR-SEC-PROVENANCE / SWR-SEC-SBOM | SLSA.dev; GitHub `attest-sbom` |
| Mutable tag repointed to malware | tj-actions/changed-files CVE-2025-30066 + reviewdog CVE-2025-30154 (2025) | SHA-pin every `uses:` and reusable-workflow ref; Dependabot refresh | SWR-SEC-ACTION-PINNING | CISA 2025-03-18; GitHub security-hardening |
| Over-broad token exfiltrated | tj-actions secret leakage (2025) | Top-level `contents: read`; per-job least privilege; `id-token`/`attestations` job-scoped; `persist-credentials: false` | SWR-SEC-TOKEN-PRIVILEGE | GitHub Docs GITHUB_TOKEN permissions |
| In-place tamper of a build tool | Codecov Bash Uploader (2021) | Cosign-signed `SHA256SUMS` + non-bypassable verify at the download boundary | SWR-SEC-CHECKSUM | CISA 2021-04-30; Sigstore docs |
| Self-published checksum altered with artifact | Codecov Bash Uploader (2021) | Integrity anchored to Sigstore/Rekor signature, not a vendor checksum; verify digest AND identity-pinned signature | SWR-SEC-CHECKSUM | Sigstore docs; Kubernetes verify-signed-artifacts |
| Stolen publish token poisons registry | event-stream (2018); GlassWorm Open VSX (2025); Qix debug/chalk (2025) | OIDC trusted publishing (no long-lived token) + protected publish environment + provenance | SWR-SEC-OIDC-PUBLISH | npm/crates.io/NuGet trusted-publishing docs |
| Deep transitive vuln, slow to locate | Log4Shell, CVE-2021-44228 (2021) | Attested CycloneDX SBOM per artifact + `cargo-auditable` embedded dep tree | SWR-SEC-SBOM | CISA Log4Shell; CycloneDX/OWASP |
| Non-frozen install pulls malicious version | colors/faker (2022); ua-parser-js (2021); Shai-Hulud (2025) | `npm ci` / `pnpm --frozen-lockfile` / `cargo --locked` from committed lockfiles | SWR-SEC-FROZEN-INSTALL / SWR-SEC-VULN-GATE | npm/pnpm/Cargo docs; Unit 42 |
| Dependency confusion | Birsan (2021) | Frozen lockfile + scoped packages pinned to the private registry | SWR-SEC-FROZEN-INSTALL | GitHub avoiding-npm-substitution-attacks |
| VSIX bundles unverified backing binary | GlassWorm (2025) | Verify staged binary SHA-256 vs signed release before `vsce package`; host re-verifies at activation | SWR-SEC-CHECKSUM (`SWR-VSIX-BUNDLE-VERIFY`) | Eclipse Foundation; Sigstore |
| Unsigned/tampered native binary blocked by OS | (class) Gatekeeper/SmartScreen | Apple Developer ID + notarization AND cosign provenance — two complementary signatures | SWR-SIGN-COSIGN (+ SWR-SIGN-APPLE-WORKFLOW) | Apple; Microsoft SmartScreen; Sigstore |

## [SWR-SEC-PROVENANCE] Build Provenance (SLSA L2)

Every `githubRelease` component and every published package MUST carry a **signed SLSA v1.0
Build Level 2 provenance attestation**, produced by `actions/attest-build-provenance` on a
GitHub-hosted runner. The attestation binds the artifact's SHA-256 digest to an in-toto
provenance statement (source ref, workflow, builder) and records it in the Rekor transparency
log. The attest step runs **after** the artifact is final — post-`vsce package` for a VSIX,
post-`dotnet pack` for a NuGet, post-archive for a binary — so the attested digest matches what
is published.

Permissions are declared **at the job level only**:

```yaml
permissions:
  id-token: write       # mint the Sigstore OIDC signing token
  attestations: write   # persist the attestation
  contents: read
steps:
  - uses: actions/attest-build-provenance@96b4a1ef7235a096b17240c259729fdd70c83d45 # v2
    with:
      subject-path: 'dist/<artifact>'
```

Consumers — the host resolver's `github-release` source, and any downstream CI that promotes an
artifact — MUST verify provenance and **fail closed**, pinning the producing workflow:

```bash
gh attestation verify ./<artifact> \
  --repo Nimblesite/<repo> \
  --signer-workflow Nimblesite/<repo>/.github/workflows/release.yml
```

`--signer-workflow` defeats a token stolen in a *different* repo or workflow: such a token
cannot produce an attestation that names this exact release workflow. A missing or mismatched
attestation MUST block execution/bundling.

Authorities: SLSA.dev/spec/v1.0/levels; GitHub Docs "Using artifact attestations to establish
provenance"; `actions/attest-build-provenance`; `gh attestation verify`.

## [SWR-SEC-SBOM] Software Bill of Materials

Every release artifact MUST ship an attested **CycloneDX JSON** SBOM, generated from the
committed lockfile and bound to the artifact digest with `actions/attest-sbom`:

- **Node** — `npm sbom --sbom-format cyclonedx` (or `anchore/sbom-action` over the build dir).
- **Rust** — `cargo cyclonedx`, and binaries MUST additionally be built with **`cargo-auditable`**
  so the dependency manifest travels inside the binary's `.dep-v0` section and survives
  distribution.
- **Compiled binaries / VSIX** — `anchore/sbom-action` (Syft) over the final artifact.

Consumers assert the SBOM predicate when verifying:

```bash
gh attestation verify ./<artifact> --owner Nimblesite \
  --predicate-type https://cyclonedx.org/bom
```

An attested SBOM turns "are we exposed to <CVE>, and in which products and versions?" — the
Log4Shell question — into a one-line query across the portfolio.

Authorities: CycloneDX (OWASP, ECMA-424); `npm sbom`; CycloneDX/cargo-cyclonedx; rust-secure-code/cargo-auditable; Anchore Syft; GitHub `attest-sbom`.

## [SWR-SEC-CHECKSUM] Signed Checksums

A release MUST publish **one** `SHA256SUMS` over all assets, **keyless-signed with cosign**
(Sigstore: Fulcio short-lived cert from a GitHub OIDC identity, Rekor transparency log, no
long-lived key). The release uploads `SHA256SUMS`, plus the cosign bundle
(`SHA256SUMS.sigstore.json` — or the legacy `.sig` + `.pem` pair).

```bash
# sign (release job, id-token: write)
cosign sign-blob --yes --bundle SHA256SUMS.sigstore.json SHA256SUMS
```

The host resolver, Homebrew/Scoop consumers, and the IDE `github-release` source MUST, before
executing a downloaded binary, **both**:

1. recompute the SHA-256 and match it against `SHA256SUMS`, **and**
2. verify the signature with an identity pinned to the exact release workflow ref — never
   `--insecure-ignore-tlog`:

```bash
cosign verify-blob --bundle SHA256SUMS.sigstore.json \
  --certificate-identity-regexp '^https://github.com/Nimblesite/<repo>/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  SHA256SUMS
```

Both checks fail closed. This makes `githubRelease.checksum` and `githubRelease.signature` in
`shipwright.json` binding, closing the gap where a downloader (Basilisk's Neovim client, the
Deslop host) fetched a binary with no integrity check at all.

Authorities: Sigstore docs (signing/verifying blobs); CISA Codecov alert; Kubernetes
verify-signed-artifacts.

## [SWR-SEC-ACTION-PINNING] Action and Reusable-Workflow Pinning

Every `uses:` reference — third-party **and** first-party — and every reusable-workflow ref
(e.g. `…/release.reusable.yml@v1`) in any shipped template or product workflow MUST be a full
**40-character commit SHA** with a trailing `# vX.Y.Z` comment. Mutable tags (`@v4`) and branch
refs (`@stable`, `@master`) are forbidden: an attacker who controls the action repo can repoint
a tag at malicious code, which is exactly how tj-actions/changed-files and reviewdog/action-setup
were weaponized. SHA pinning is the only immutable-release mechanism GitHub documents.

```yaml
# CORRECT — immutable, SHA-pinned, version in comment
- uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
# WRONG — mutable tag, can be repointed
# - uses: actions/checkout@v4
```

A committed `.github/dependabot.yml` (github-actions ecosystem, weekly — see
`templates/gh-actions/dependabot.yml`) keeps pins fresh so they do not rot. Enforced by
**[SWR-GATE-ACTION-PINNING]**.

Authority: CISA 2025-03-18 alert; GitHub Docs "Security hardening for GitHub Actions" and
"secure use" (full-length commit SHA pinning).

## [SWR-SEC-TOKEN-PRIVILEGE] Least-Privilege `GITHUB_TOKEN`

Every workflow MUST declare a top-level `permissions:` block defaulting to `contents: read`.
Write scopes (`contents: write`, `packages: write`), `id-token: write`, and `attestations: write`
are granted **per job only**, never at the workflow top level. `actions/checkout` sets
`persist-credentials: false` on any job that does not itself `git push`. No secret or token is
placed in the `env:` of an `npm ci` / `cargo build` step without a documented need — install
lifecycle scripts run with whatever the environment holds.

Enforced by **[SWR-GATE-TOKEN-PRIVILEGE]**. Authority: GitHub Docs "Automatic token
authentication" / "secure use"; OpenSSF Scorecard `Token-Permissions`.

## [SWR-SEC-FROZEN-INSTALL] Deterministic Frozen Installs

CI and release installs MUST be lockfile-frozen:

- `npm ci` — never `npm install` (and never `--no-audit` on the install that gates the release).
- `pnpm install --frozen-lockfile`.
- `cargo build|test|run --locked`.

Lockfiles MUST be committed for every ecosystem. `dtolnay/rust-toolchain@stable` (a moving
branch) is forbidden for release builds — pin a SHA and an explicit `toolchain:`, or commit a
`rust-toolchain.toml`. Where a job does not need install scripts, prefer `npm ci --ignore-scripts`;
native builds that require scripts run in a dedicated least-privilege job. pnpm products SHOULD
enable a `minimumReleaseAge` cooldown to blunt freshly-published worm waves.

Enforced by **[SWR-GATE-FROZEN-INSTALL]**. Authority: npm `npm-ci`; pnpm settings
(`frozenLockfile`, `minimumReleaseAge`); Cargo `--locked`; GitHub avoiding-npm-substitution-attacks.

## [SWR-SEC-OIDC-PUBLISH] OIDC Trusted Publishing

Registry publishing MUST use OIDC trusted publishing with **no long-lived token**:

- **npm** — `npm publish --provenance` from an `id-token: write` job (npm ≥ 11.5.1). Already
  live in Shipwright's `release.yml`; do not regress it.
- **crates.io** — trusted publishing via GitHub OIDC (`rust-lang/crates-io-auth-action`).
- **NuGet** — trusted publishing via `NuGet/login` + `id-token: write`.

The **VS Code Marketplace** and **Open VSX** still authenticate with a Personal Access Token.
That PAT MUST be stored as an **environment-scoped** secret behind a protected GitHub
Environment (required reviewers + tag restriction `v*.*.*`), scoped to the minimum (Marketplace
→ Manage for `vsce`), and given a short expiry. The Open VSX GlassWorm incident (Oct 2025, with
a Jan 2026 escalation) traced directly to publisher tokens leaked into public repos; an
environment-scoped, short-lived, reviewer-gated token is the containment.

Enforced by **[SWR-GATE-PROVENANCE]** (publish identity) and the environment rule above.
Authority: npm Trusted Publishing; crates.io Trusted Publishing; Microsoft Learn NuGet Trusted
Publishing; Eclipse Foundation Open VSX security update (Oct 2025); GitHub environments.

## [SWR-SEC-VULN-GATE] Dependency Vulnerability Gates

Product CI MUST scan dependencies and fail at high severity:

- **`osv-scanner`** (Google OSV) — unified Rust + Node; PR-diff gate on new vulnerabilities
  plus a scheduled/release full scan.
- **`cargo-deny`** — advisories + bans + licenses + sources, from a committed `deny.toml`.
- **`cargo audit --deny warnings`** against the RustSec database.
- **`npm audit --audit-level=high --omit=dev`**.
- **`grype`** against the generated SBOM, `--fail-on high`.

Suppressions are allowed only via a committed ignore list with a reason **and an expiry date**
(mirroring the repo's no-skip-without-ticket rule). Enforced by **[SWR-GATE-VULN-SCAN]**.
Authority: Google OSV-Scanner; EmbarkStudios cargo-deny; RustSec cargo-audit; npm audit; Anchore grype.

## [SWR-SEC-VSIX-MARKETPLACE] VS Code Marketplace & Open VSX Integrity

VS Code extension distribution has its own trust chain, owned jointly with
[vsix-platform-bundling.md](vsix-platform-bundling.md):

- **Marketplace repository signing.** The VS Code Marketplace signs every extension on upload;
  VS Code verifies that signature at install via its extension signature-verification service
  (`@vscode/vsce-sign`, PKCS#7 `.signature.p7s` + a `.signature.manifest` listing the size and
  SHA-256 of every file in the `.vsix`). This is automatic and requires no publisher action, but
  it protects only the Marketplace→client hop — it does **not** vouch for the backing binary
  bundled inside the VSIX. That binary is covered by **[SWR-SEC-CHECKSUM]** /
  `SWR-VSIX-BUNDLE-VERIFY`.
- **Per-platform VSIX provenance.** Each per-target `.vsix` is attested with
  `actions/attest-build-provenance` after `vsce package` — see
  [vsix-platform-bundling.md](vsix-platform-bundling.md) `SWR-VSIX-PROVENANCE`.
- **No committed VSIX.** A prebuilt `.vsix` MUST NOT be committed to a product source repo; it
  is built and attested in CI only. The Marketplace also secret-scans every published extension
  and `vsce` scans `.env` at package time — do not rely on that as a primary control; keep
  secrets and source out of the package with an allowlist `.vscodeignore`.
- **Open VSX.** Open VSX uses a separate signing model (`node-ovsx-sign`, PKCS#8) and a separate
  PAT. Apply the same environment-scoped, short-lived, reviewer-gated token rule from
  **[SWR-SEC-OIDC-PUBLISH]**; the GlassWorm campaign rode leaked Open VSX publisher tokens.

Authorities: VS Code "Publishing Extensions" and Extension Marketplace docs;
microsoft/vscode signed-extension verification (#162284 / PR #162285); `@vscode/vsce-sign`;
filiptronicek/node-ovsx-sign; Eclipse Foundation Open VSX security update (Oct 2025).

## [SWR-SEC-MANIFEST] Manifest Surface

`shipwright.json` encodes this posture so products opt in declaratively and the host enforces it:

- Top-level **`supplyChain`** policy block: `slsaBuildLevel` (only `2`), `provenance`, `sbom`,
  `signedChecksums`, `frozenInstall`, `pinnedActions`, `oidcPublish`, `vulnGate`. Absent = inherit
  the secure Shipwright defaults above.
- Per-component **`githubRelease`** integrity fields: `checksum`, `signature` (`cosign`|`none`),
  `signerWorkflow`, `provenance`, `sbom`, `predicateType`. The host verifies these before exec.
- **`bundled.checksum`** — the host re-verifies a VSIX-bundled binary's digest at activation
  (`SWR-VSIX-BUNDLE-VERIFY`).
- **`asset.requireHashes`** — pip/url-vendored assets install with `--require-hashes`.

See `schemas/shipwright.schema.json`. Conformance is enforced by the gates in
[acceptance-gates.md](acceptance-gates.md).

## [SWR-SEC-REFERENCES] Authorities

- SLSA v1.0 levels & requirements — https://slsa.dev/spec/v1.0/levels
- GitHub artifact attestations — https://docs.github.com/en/actions/concepts/security/artifact-attestations
- `gh attestation verify` — https://cli.github.com/manual/gh_attestation_verify
- Sigstore cosign sign/verify blobs — https://docs.sigstore.dev/cosign/signing/signing_with_blobs/
- GitHub "Security hardening for GitHub Actions" — https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- GitHub `GITHUB_TOKEN` permissions — https://docs.github.com/en/actions/security-guides/automatic-token-authentication
- npm trusted publishing / provenance — https://docs.npmjs.com/trusted-publishers/ , https://docs.npmjs.com/generating-provenance-statements
- crates.io trusted publishing — https://crates.io/docs/trusted-publishing
- NuGet trusted publishing — https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing
- CycloneDX — https://cyclonedx.org/tool-center/ ; cargo-auditable — https://github.com/rust-secure-code/cargo-auditable
- OSV-Scanner — https://google.github.io/osv-scanner/github-action/ ; cargo-deny — https://embarkstudios.github.io/cargo-deny/
- CISA: SolarWinds AA20-352A; Codecov (2021-04-30); tj-actions/reviewdog (2025-03-18); Log4Shell
- Eclipse Foundation Open VSX security update (Oct 2025) — https://blogs.eclipse.org/post/mika%C3%ABl-barbero/open-vsx-security-update-october-2025
- VS Code publishing & signed-extension verification — https://code.visualstudio.com/api/working-with-extensions/publishing-extension
