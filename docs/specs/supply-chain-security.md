# Supply Chain Security

```
Spec prefix: SWR-SEC-* (build/distribution integrity), SWR-SIGN-* (OS code signing)
Status: Draft
Date: 2026-06-05
```

## [SWR-SEC-PURPOSE] What this is and why it exists

Shipwright products are not shipped through one door. The same release flows out to GitHub Releases,
the VS Code Marketplace, Open VSX, a Homebrew tap, a Scoop bucket, a Neovim downloader, and the
language registries — crates.io, npm, NuGet, pub.dev — with Zed, JetBrains, and Android Studio close
behind. Each of those is a distinct trust boundary an attacker can target, and each has been targeted
in the wild. A single supply-chain spec that only covered the VSIX would leave most of the surface
undefended.

This document is the **build-and-distribution integrity contract** for the whole portfolio. It
guarantees that the artifact a user installs — through *any* channel — was built from the reviewed
source, by the expected pipeline, and reaches the running process unmodified. It does this with a
small set of controls applied everywhere (provenance, an SBOM, signed checksums, pinned actions,
least-privilege tokens, frozen installs, OIDC publishing, vulnerability gates) and a **per-channel
plan** that says exactly how those controls land on each door we ship through.

The contract floor is **SLSA v1.0 Build Level 2** — the level GitHub-hosted runners deliver through
Artifact Attestations: provenance that is *signed* and bound to a *hosted* build platform, so it
cannot be forged after the build. Build Level 3 (tamper-proof run isolation with signing material
inaccessible to build steps) is **not** achievable on standard GitHub-hosted runners and MUST NOT be
claimed. Every release artifact is therefore built on a GitHub-hosted runner — never a developer
workstation, which has no attestable build identity.

## [SWR-SEC-POSITIONING] What it requires, what it complements

Shipwright **requires and verifies** build provenance, a software bill of materials, and a
cryptographically signed checksum set for every distributed artifact, and it enforces those claims at
the download/bundle boundary and at host activation. A self-published `SHA256SUMS` is not enough on
its own: whoever can write a GitHub Release (a leaked token, an over-scoped CI job) can replace the
artifact *and* its checksum together — the Codecov class of attack. Integrity is therefore anchored to
a Sigstore-signed, Rekor-logged signature and to provenance bound to the exact producing workflow,
not to a checksum the producer merely asserts.

It **complements, and does not replace**, two things. First, OS code signing — Apple Developer ID +
notarization (Gatekeeper) and Windows Authenticode (SmartScreen): Sigstore proves *who built it and
that it is unmodified*; OS signing is what lets the OS *run it without a scary dialog*. Both are
required where the platform demands them (see [OS Code Signing](#os-code-signing-swr-sign) below).
Second, the registries themselves — Shipwright does not run a registry; it pins how products publish
to and consume from each one.

## [SWR-SEC-THREATS] Threat model

Each threat is grounded in a named, recent incident and closed by a control in the matrix below.

- **Build-system tampering shipped signed** — *SolarWinds/SUNBURST*, 2020 (CISA AA20-352A) → `SWR-SEC-PROVENANCE`.
- **Published artifact differs from reviewed source** — *xz-utils backdoor*, CVE-2024-3094, 2024 → `SWR-SEC-PROVENANCE` + `SWR-SEC-SBOM`.
- **Mutable action tag repointed to malware** — *tj-actions/changed-files* (CVE-2025-30066) via *reviewdog/action-setup* (CVE-2025-30154), 2025 → `SWR-SEC-ACTION-PINNING`.
- **Over-broad `GITHUB_TOKEN` exfiltrated** — *tj-actions* secret leakage, 2025 → `SWR-SEC-TOKEN-PRIVILEGE`.
- **In-place tamper of a downloaded build tool** — *Codecov Bash Uploader*, 2021 → `SWR-SEC-CHECKSUM`.
- **Stolen publish token poisons a registry/marketplace** — *event-stream*, 2018; *GlassWorm* on Open VSX, Oct 2025 / Jan 2026; *debug/chalk "Qix"*, 2025 → `SWR-SEC-OIDC-PUBLISH`.
- **Non-frozen install pulls a fresh malicious version / install-script runs** — *colors/faker* (2022), *ua-parser-js* (2021), *Shai-Hulud* worm (2025) → `SWR-SEC-FROZEN-INSTALL` + `SWR-SEC-VULN-GATE`.
- **Dependency confusion** — *Birsan*, 2021 → `SWR-SEC-FROZEN-INSTALL`.
- **Deep transitive vulnerability, slow to locate** — *Log4Shell*, CVE-2021-44228 → `SWR-SEC-SBOM` + `SWR-SEC-VULN-GATE`.
- **A VSIX (or any channel) ships a backing binary never verified against the signed release** — *GlassWorm*, 2025 → `SWR-SEC-CHECKSUM`.
- **Exploitable flaw in *first-party* source reaches a release** — command injection, path traversal, unsafe deserialization, etc. The gates above cover dependencies (`SWR-SEC-VULN-GATE`) and CI, **not the code we write**. This is the uncovered inbound surface → `SWR-SEC-CODE-SCANNING`.
- **A publish token or signing key committed to git and harvested** — *tj-actions* secret leakage (2025); *GlassWorm* rode leaked Open VSX tokens (2025). Shipwright's residual PATs/keys (Open VSX, JetBrains, Sonatype, GPG, Apple) only ever live in protected environments; the threat is one pasted into a file/commit → `SWR-SEC-SECRET-SCANNING`.

Two older threats are owned elsewhere: hidden binary substitution at runtime by a stale PATH binary
([ide-extension-deployment.md](ide-extension-deployment.md), `SWR-IDE-RESOLUTION`) and version drift
between package and binary ([binary-version-contract.md](binary-version-contract.md), `SWR-VERSION-MATCHING`).

## [SWR-SEC-CONTROLS] Controls matrix

| Threat | Named incident | Control | Spec ID | Authority |
|---|---|---|---|---|
| Build-time tampering, shipped signed | SolarWinds/SUNBURST (2020) | Signed SLSA L2 provenance; consumer verifies signer-workflow, fails closed | SWR-SEC-PROVENANCE | SLSA.dev; GitHub Docs; CISA AA20-352A |
| Published artifact ≠ source | xz-utils, CVE-2024-3094 (2024) | Provenance binds digest to source+workflow; SBOM enumerates contents; Rekor logs signatures | SWR-SEC-PROVENANCE / SWR-SEC-SBOM | SLSA.dev; GitHub attest-sbom |
| Mutable tag repointed to malware | tj-actions CVE-2025-30066 + reviewdog CVE-2025-30154 (2025) | SHA-pin every `uses:` and reusable-workflow ref; Dependabot refresh | SWR-SEC-ACTION-PINNING | CISA 2025-03-18; GitHub security-hardening |
| Over-broad token exfiltrated | tj-actions (2025) | Top-level `contents: read`; write/id-token/attestations job-scoped; `persist-credentials: false` | SWR-SEC-TOKEN-PRIVILEGE | GitHub Docs GITHUB_TOKEN permissions |
| In-place tamper of a build tool | Codecov Bash Uploader (2021) | Cosign-signed `SHA256SUMS` + non-bypassable verify at download | SWR-SEC-CHECKSUM | CISA 2021-04-30; Sigstore |
| Self-published checksum altered with artifact | Codecov (2021) | Integrity anchored to Sigstore/Rekor signature, not a vendor checksum | SWR-SEC-CHECKSUM | Sigstore; Kubernetes verify-signed-artifacts |
| Stolen publish token poisons registry | event-stream (2018); GlassWorm (2025); Qix (2025) | OIDC trusted publishing (no long-lived token) + protected publish environment + provenance | SWR-SEC-OIDC-PUBLISH | npm/crates/NuGet/pub.dev trusted-publishing docs |
| Deep transitive vuln, slow to locate | Log4Shell (2021) | Attested CycloneDX SBOM + `cargo-auditable` embedded dep tree | SWR-SEC-SBOM | CISA; CycloneDX/OWASP |
| Non-frozen install pulls malicious version | colors/faker; ua-parser-js; Shai-Hulud | `npm ci` / `pnpm --frozen-lockfile` / `cargo --locked` from committed lockfiles | SWR-SEC-FROZEN-INSTALL / SWR-SEC-VULN-GATE | npm/pnpm/Cargo docs; Unit 42 |
| Dependency confusion | Birsan (2021) | Frozen lockfile + scoped packages pinned to the private registry | SWR-SEC-FROZEN-INSTALL | GitHub avoiding-npm-substitution-attacks |
| Channel ships unverified backing binary | GlassWorm (2025) | Verify staged/downloaded binary SHA-256 vs signed release before use; host re-verifies at activation | SWR-SEC-CHECKSUM | Eclipse Foundation; Sigstore |
| Unsigned native binary blocked/tampered | (class) Gatekeeper/SmartScreen | Apple Developer ID + notarization AND cosign provenance — two complementary signatures | SWR-SIGN-* | Apple; Microsoft; Sigstore |
| Vulnerable first-party code ships | (class) CWE Top 25 — injection, path traversal, unsafe deserialization | CodeQL `security-extended` on every PR + weekly, **and a gated `workflow_call` the release `needs:` — High/Critical findings FAIL the release and block publishing**; separate from dep gating | SWR-SEC-CODE-SCANNING | GitHub code scanning / CodeQL docs |
| Publish token/key committed and harvested | tj-actions secret leakage (2025); GlassWorm leaked Open VSX tokens (2025) | Secret scanning + **push protection** — blocks a secret before it ever reaches the remote | SWR-SEC-SECRET-SCANNING | GitHub secret-scanning / push-protection docs |

## The shared controls

The first eight controls apply across every channel (the per-channel plan that follows says which ones
each door needs and what it adds). The last two — `SWR-SEC-CODE-SCANNING` and
`SWR-SEC-SECRET-SCANNING` — are **inbound, source-side** controls: repo-wide, not per-channel.

**[SWR-SEC-PROVENANCE] Build provenance (SLSA L2).** Every released artifact and published package
carries a signed provenance attestation from `actions/attest-build-provenance` on a hosted runner,
generated *after* the artifact is final (post-`vsce package`, post-`dotnet pack`, post-archive). The
job declares `id-token: write` + `attestations: write` + `contents: read` and nothing else. Consumers
verify and fail closed, pinning the producing workflow:

```bash
gh attestation verify ./<artifact> --repo Nimblesite/<repo> \
  --signer-workflow Nimblesite/<repo>/.github/workflows/release.yml
```

`--signer-workflow` defeats a token stolen in a *different* repo: it cannot produce an attestation
naming this exact release workflow.

**[SWR-SEC-SBOM] Software bill of materials.** Every artifact ships an attested CycloneDX JSON SBOM
(`npm sbom`, `cargo cyclonedx`, or Syft over the final binary), bound to the digest with
`actions/attest-sbom`. Rust binaries are additionally built with `cargo-auditable` so the dependency
manifest travels inside the binary. This turns "are we exposed to <CVE>, and where?" — the Log4Shell
question — into a one-line query.

**[SWR-SEC-CHECKSUM] Signed checksums.** A release publishes one `SHA256SUMS` over all assets,
keyless-signed with cosign (Fulcio cert from a GitHub OIDC identity, Rekor log, no long-lived key):

```bash
cosign sign-blob --yes --bundle SHA256SUMS.sigstore.json SHA256SUMS
```

Any consumer that downloads a binary — the host resolver, Homebrew, Scoop, the Neovim downloader, the
Zed `github-release` source — MUST, before executing it, recompute the SHA-256 against `SHA256SUMS`
**and** verify the signature with an identity pinned to the release workflow, never
`--insecure-ignore-tlog`. Both checks fail closed.

```bash
cosign verify-blob --bundle SHA256SUMS.sigstore.json \
  --certificate-identity-regexp '^https://github.com/Nimblesite/<repo>/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com SHA256SUMS
```

**[SWR-SEC-ACTION-PINNING] Action pinning.** Every `uses:` and every reusable-workflow ref — third-
party and first-party — is a full 40-character commit SHA with a `# vX.Y.Z` comment. Mutable tags and
branch refs are forbidden: a repointed tag is exactly how tj-actions and reviewdog were weaponized. A
committed `.github/dependabot.yml` (github-actions ecosystem, weekly) keeps pins fresh.

**[SWR-SEC-TOKEN-PRIVILEGE] Least-privilege `GITHUB_TOKEN`.** Every workflow declares top-level
`permissions: contents: read`. Write, `id-token`, and `attestations` are granted per job only.
`actions/checkout` sets `persist-credentials: false` off the push path, and no token sits in an
install step's `env:` without a documented need.

**[SWR-SEC-FROZEN-INSTALL] Deterministic installs.** CI and release installs are lockfile-frozen:
`npm ci`, `pnpm install --frozen-lockfile`, `cargo build|test --locked`. Lockfiles are committed for
every ecosystem; `dtolnay/rust-toolchain@stable` (a moving branch) is forbidden for release builds.
Where scripts are not needed, prefer `npm ci --ignore-scripts`.

**[SWR-SEC-OIDC-PUBLISH] OIDC trusted publishing.** Registry publishing uses short-lived OIDC tokens
with no stored secret wherever the registry supports it — crates.io, npm (also `--provenance`), NuGet
(`NuGet/login@v1` exchanges the OIDC token for a ~1h, single-use API key), pub.dev. Each such job
declares `permissions: id-token: write` + `contents: read`. The per-channel plan lists each. This now
includes the **VS Code Marketplace**, which publishes via GitHub→Microsoft Entra workload identity
federation (`azure/login` → `az account get-access-token` → `vsce`) with **no stored PAT** — this is
the preferred, default model ([SWR-VSIX-PUBLISH-OIDC]). The Entra app is authorized once as a
publisher member; a single flexible federated credential (`claims['sub'] matches
'repo:OWNER/*:environment:release'`) trusts every repo. The remaining channels with **no** OIDC path
— **Open VSX** and **JetBrains** — run their Personal Access Token inside a protected GitHub
Environment with required reviewers and a `v*.*.*` tag restriction.

**Environment-claim binding (load-bearing).** When a registry's trusted-publishing policy is scoped to
a named GitHub Environment, the publish job MUST declare that exact `environment:` — GitHub only injects
the `environment` claim into the OIDC token for a job bound to an environment, so a policy that names an
environment will reject a token from a job that declares none. Either bind the job to the environment
the policy names, or leave the policy's environment field empty; a mismatch is a silent publish failure.

**[SWR-SEC-VULN-GATE] Vulnerability gates.** Product CI runs `osv-scanner` (Rust + Node, PR-diff plus
a release full scan), `cargo-deny` (advisories/bans/licenses/sources from a committed `deny.toml`),
`cargo audit`, `npm audit --audit-level=high`, and `grype` against the SBOM, failing at the
`supplyChain.vulnGate` severity. Suppressions need a committed reason **and** expiry date.

**[SWR-SEC-CODE-SCANNING] Static code analysis (CodeQL).** `SWR-SEC-VULN-GATE` covers *dependencies*;
CodeQL covers the *code we write*. A separate `.github/workflows/codeql.yml` runs CodeQL with the
`security-extended` query suite on every PR to `main` and a weekly schedule (so newly-published
queries re-scan unchanged code), and exposes a `workflow_call` with a `gate` input. **It is a HARD
release gate, not advisory: `release.yml` MUST call it with `gate: true` and the publish jobs MUST
`needs:` that job, so a release can never ship code CodeQL flagged.** With `gate: true` the analyze
job parses its SARIF and FAILS on any finding whose `security-severity` is High or Critical (>= 7.0);
the gated call also scans the exact released SHA with the current query set, since the release commit
may have last been scanned weeks ago. A standalone `push: [tags]` CodeQL trigger is **forbidden** — it
runs concurrently with the release and can only file alerts *after* the artifact has shipped, which
gates nothing. It is its own workflow — not folded into `ci.yml` — because it needs
job-scoped `security-events: write` and feeds GitHub code-scanning alerts, while top-level permission
stays `contents: read` (`SWR-SEC-TOKEN-PRIVILEGE`). The language matrix is the **intersection of this
repo's languages with the set CodeQL supports at the time it is set up** — checked live, never copied
from a frozen list (the set grows; Rust is in, Dart/F# are not). For Shipwright that is `actions`,
`rust`, and `javascript-typescript` (Dart is excluded until CodeQL supports it). `actions` is always
included — it scans the workflow files themselves for the injection/pinning issues this spec guards
against. Every `uses:` is SHA-pinned (`SWR-SEC-ACTION-PINNING`) and refreshed by Dependabot. No
overlap: clippy/eslint = style, `SWR-SEC-VULN-GATE` = vulnerable deps, CodeQL = vulnerable code; never
add security-rule linter plugins that re-cover CodeQL.

**[SWR-SEC-SECRET-SCANNING] Secret scanning + push protection.** GitHub secret scanning is enabled
repo-wide, and **push protection** is on so a detected credential is blocked *before* the push reaches
the remote — the cheapest possible defense for a project whose release path touches many publish
tokens and signing keys. This is defense-in-depth behind `SWR-SEC-OIDC-PUBLISH`: the preferred model
stores no long-lived secret at all, but every residual PAT/key (Open VSX, JetBrains, Sonatype, GPG,
Apple) is one accidental paste away from a commit, and push protection catches exactly that. Free for
public repos; needs GitHub Secret Protection on private repos. Enable via repo settings:

```bash
gh api -X PATCH "repos/Nimblesite/Shipwright" --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
```

**[SWR-SEC-POLICY] Security policy + private vulnerability reporting.** A committed
`SECURITY.md` (root) states how to report a vulnerability and supported versions, and
**private vulnerability reporting** is enabled so researchers get a "Report a vulnerability"
button instead of a public issue. Free for public repos. Enable:

```bash
gh api -X PUT "repos/Nimblesite/Shipwright/private-vulnerability-reporting"
```

Docs: [add a security policy](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/add-security-policy) ·
[configure PVR](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## [SWR-SEC-CHANNELS] Per-channel security plan

We publish through four families of door. Every door inherits the shared controls above; each adds the
channel-specific requirement in the last column. **GitHub Releases is the root of trust** — most other
channels redistribute or point at the binaries it holds, so its provenance + signed `SHA256SUMS` are
what every downstream verification ultimately checks.

| Channel | What we publish | Channel-specific control beyond the shared eight |
|---|---|---|
| **GitHub Releases** | Per-platform archives + `SHA256SUMS` (+ SBOMs) | macOS archives notarized (`SWR-SIGN`); cosign-signed checksums are the root every other channel verifies against |
| **VS Code Marketplace** | One VSIX per `vsceTarget` | Marketplace auto-signs on upload; per-VSIX provenance; bundle-verify; **OIDC via Entra (no stored PAT)** — publisher-member service principal, `id-token: write`, in a protected env |
| **Open VSX** | Same VSIXs | `node-ovsx-sign` signature; a *separate* short-expiry PAT in a protected env (GlassWorm rode leaked Open VSX tokens) |
| **JetBrains / Android Studio** | Signed plugin `.zip` to JetBrains Marketplace | `signPlugin` certificate-chain signature; Marketplace verifies; publish token in a protected env |
| **Zed** | WASM extension (reviewed PR) + GitHub-release LSP download | No committed-WASM drift; the `github-release` download verifies checksum + signature; version via LSP `initialize` |
| **Homebrew tap** | Formula (`url`, `sha256`) | The `sha256` is taken from the cosign-verified `SHA256SUMS`; tap push uses a scoped `tap_token` in a protected env |
| **Scoop bucket** | Manifest (`url`, `hash`) | Hash from the verified release; manifest written via a real serializer with env-injected values (no `${{ }}` in shell) |
| **Neovim** | Nothing new — downloads the release binary | The downloader verifies `SHA256SUMS` + cosign before exec and pins the resolved tag (never `/latest`) |
| **crates.io** | Crate | OIDC trusted publishing (`rust-lang/crates-io-auth-action`, GA 2025) — retire `CARGO_REGISTRY_TOKEN` |
| **npm** | Package | OIDC trusted publishing + `npm publish --provenance` (Sigstore) — already live, do not regress |
| **NuGet** | `.nupkg` | Trusted Publishing on nuget.org (OIDC short-lived key) — retire `NUGET_API_KEY`; nuget.org applies a repository signature |
| **pub.dev** | Dart package | Automated publishing via GitHub Actions OIDC, tag-triggered, the dart-lang reusable workflow — retire `DART_PUB_TOKEN` |
| **Maven Central** | Jars to the Central Portal | GPG signature on every artifact (`.jar`/`-sources`/`-javadoc`/`.pom`) — mandatory; OSSRH was sunset 2025-06-30 |

### Binaries — GitHub Releases (the root of trust)

Native binaries are built per platform on hosted runners, archived, attested (provenance + SBOM), and
covered by one cosign-signed `SHA256SUMS`. macOS archives are Developer-ID-signed and notarized so
Gatekeeper allows them; Windows is currently Authenticode-unsigned (see signing section). Everything
downstream — brew, scoop, Neovim, Zed, and the IDE-bundled binaries — verifies against this release's
signature and provenance, so this is the one place that must never regress.

### IDE marketplaces — VS Code, Open VSX, JetBrains/Android Studio, Zed

The VS Code Marketplace signs every extension on upload and VS Code verifies that signature at install
(`@vscode/vsce-sign`, a PKCS#7 `.signature.p7s` plus a `.signature.manifest` of every file's size and
SHA-256). That protects only the marketplace→client hop, so we add per-VSIX provenance and
`SWR-VSIX-BUNDLE-VERIFY` (the bundled backing binary's digest is verified against the signed release
before packaging, and re-verified by the host at activation). **Publishing uses OIDC, not a stored
PAT**: the job exchanges its GitHub OIDC token (`id-token: write`) for a Microsoft Entra session via
workload identity federation, then mints a short-lived Marketplace token with `az account
get-access-token` and hands it to `vsce` — no harvestable standing credential exists
([SWR-VSIX-PUBLISH-OIDC]). Authorization is publisher-level: an Entra service principal is added once
as a Contributor member of the publisher. The job still runs in a protected environment — there the
environment is *load-bearing*, since Entra rejects wildcards in tag subjects and matches the federated
trust against `repo:OWNER/REPO:environment:<env>`. The Marketplace also secret-scans on publish and
`vsce` scans `.env` at package time, but those are backstops, not the primary control. A long-lived
`VSCE_PAT` in a protected env remains the legacy fallback only where federation cannot be set up
([SWR-VSIX-PUBLISH-PAT]).

**Open VSX** uses a different signing scheme (`node-ovsx-sign`, PKCS#8) and a separate token. The
GlassWorm campaign (Oct 2025, with a Jan 2026 escalation) rode Open VSX publisher tokens leaked into
public repos, so that token gets the same protected-environment, short-expiry treatment — and never
shares the VS Code PAT.

**JetBrains Marketplace** (which also serves Android Studio, an IntelliJ-platform IDE) requires the
plugin `.zip` to be signed with the `signPlugin` task — a certificate chain + private key supplied as
secrets — and the Marketplace verifies it; verify locally with `marketplace-zip-signer verify`. The
publish token runs in a protected environment.

**Zed** distributes a WASM extension through a human-reviewed PR to the Zed extensions registry and
then downloads the actual LSP from our GitHub Release at runtime. The WASM must be built reproducibly
in CI (never a committed, drift-prone `.wasm`), and the runtime download goes through the same
verify-checksum-and-signature-before-exec path as every other binary consumer, with the version
confirmed via LSP `initialize` since Zed cannot preflight `--version`.

### Package managers that redistribute the release binary — Homebrew, Scoop, Neovim

These do not build anything; they point users at the GitHub-Release archive. The integrity rule is the
same for all three: the artifact they reference is verified against the cosign-signed `SHA256SUMS`
before the formula/manifest is written (brew, scoop) or before the binary is executed (Neovim).
Homebrew and Scoop embed the `sha256` so the package manager re-checks it on install; the tap/bucket
push uses a dedicated, scoped token in a protected environment. The Neovim downloader MUST fetch and
verify `SHA256SUMS` and the cosign signature before executing the binary, and pin the resolved tag
rather than `/releases/latest`.

### Language registries — crates.io, npm, NuGet, pub.dev, Maven Central

All five move to short-lived, no-stored-secret publishing wherever the registry supports it, so a
leaked long-lived token cannot publish under our identity (the event-stream/GlassWorm class):

- **crates.io** — Trusted Publishing via GitHub OIDC (`rust-lang/crates-io-auth-action`, GA 2025);
  retire `CARGO_REGISTRY_TOKEN`. Crates are immutable and cargo verifies the index checksum.
- **npm** — OIDC Trusted Publishing with `npm publish --provenance` (Sigstore-backed); this is already
  live and must not regress. Consumers can run `npm audit signatures`.
- **NuGet** — Trusted Publishing on nuget.org exchanges a GitHub OIDC token for a ~1-hour API key;
  retire `NUGET_API_KEY`. nuget.org applies a repository signature the client validates.
- **pub.dev** — Automated publishing authenticates with a GitHub Actions OIDC token (`id-token: write`,
  tag-triggered, via the dart-lang reusable workflow); retire `DART_PUB_TOKEN`.
- **Maven Central** — Publishing moved to the Central Portal after OSSRH's 2025-06-30 sunset, and every
  artifact (`.jar`, `-sources.jar`, `-javadoc.jar`, `.pom`) MUST carry a detached GPG signature; the
  Portal rejects unsigned uploads. Keep the GPG key in a protected environment.

## OS code signing [SWR-SIGN]

Sigstore answers "who built this and is it unmodified"; OS code signing answers "will the OS run it
without blocking the user". They are complementary and both required where the platform demands them.
A macOS release binary therefore carries **two** signatures — Developer ID + notarization for
Gatekeeper, and cosign over `SHA256SUMS` for provenance — and neither substitutes for the other.
Unsigned/unnotarized binaries are blocked by Gatekeeper (macOS) and warned/blocked by SmartScreen
(Windows). This applies to every product that consumes Shipwright and to Shipwright's own
`shipwright-version-stamp` binary.

### [SWR-SIGN-APPLE-WORKFLOW] macOS — sign, notarize, staple

Every CI job that produces a macOS binary runs this four-step sequence before uploading, on a
`macos-*` runner (the tools ship with Xcode CLT). App Store Connect **API key** auth is required —
never Apple ID + password.

```bash
# 1) sign with Developer ID + Hardened Runtime (required, or notarization is rejected)
codesign --sign "Developer ID Application: Nimblesite Pty Ltd ($TEAM_ID)" \
  --options runtime --timestamp --force "$BINARY"
# 2) wrap a bare executable for submission
ditto -c -k --keepParent "$BINARY" submission.zip
# 3) submit and block on the verdict
xcrun notarytool submit submission.zip --key AuthKey.p8 \
  --key-id "$NOTARIZATION_KEY_ID" --issuer "$NOTARIZATION_ISSUER_ID" --wait
# 4) staple so Gatekeeper can verify offline
xcrun stapler staple submission.zip
```

A bare Mach-O cannot be stapled directly — staple the `.zip`/`.tar.gz`/`.dmg` wrapper that carries it.
Standard Rust/Go CLI tools need **no** entitlements beyond `--options runtime`; add the minimum from
Apple's entitlements reference only if the tool loads unsigned libraries, uses JIT, or attaches to
other processes. Apple docs that mention `altool` are stale — `notarytool` replaced it.

### [SWR-SIGN-APPLE-CI] CI integration

Decode the Developer ID cert into an ephemeral keychain on each signing job, then run the sequence
above:

```yaml
- name: Import Developer ID certificate
  run: |
    echo "$APPLE_DEVELOPER_ID_CERT_P12" | base64 --decode > cert.p12
    security create-keychain -p "" build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p "" build.keychain
    security import cert.p12 -k build.keychain -P "$APPLE_DEVELOPER_ID_CERT_PASSWORD" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
  env:
    APPLE_DEVELOPER_ID_CERT_P12: ${{ secrets.APPLE_DEVELOPER_ID_CERT_P12 }}
    APPLE_DEVELOPER_ID_CERT_PASSWORD: ${{ secrets.APPLE_DEVELOPER_ID_CERT_PASSWORD }}
```

| Secret | Content |
|---|---|
| `APPLE_DEVELOPER_ID_CERT_P12` | Base64 `.p12` of the Developer ID Application cert + key |
| `APPLE_DEVELOPER_ID_CERT_PASSWORD` | Password for the `.p12` export |
| `APPLE_TEAM_ID` | 10-char Apple team identifier |
| `NOTARIZATION_API_KEY_P8` | Base64 App Store Connect API key `.p8` |
| `NOTARIZATION_KEY_ID` / `NOTARIZATION_ISSUER_ID` | Key ID and issuer UUID |

### [SWR-SIGN-APPLE-INTEGRATION] Where signing fits

In `release.reusable.yml`, for any `darwin` leg, import the cert after checkout and run
sign→notarize→staple after the build and before archiving; the stapled archive is the distribution
artifact. In `publish-vsix-per-platform.yml`, darwin legs sign the binary *before* the staging copy —
the VSIX itself is not notarized (extensions are not subject to Gatekeeper), but the embedded binary
must be signed so Gatekeeper passes when VS Code first executes it.

### [SWR-SIGN-WINDOWS] Windows code signing — unsolved

Windows native code signing is **not solved yet, and we have not forgotten it** — we intend to do it,
but there is no good long-term answer today. A fresh Authenticode certificate carries zero SmartScreen
reputation (identical first-run UX to unsigned), reputation cannot be bought, the EV bypass was removed
in 2024, and the February 2026 one-year certificate-lifespan cap resets reputation annually. We are
evaluating **Azure Trusted Signing** (~$10/month, integrates with Actions) for when it becomes
worthwhile. **In the interim, Windows users should install via Scoop or Homebrew** — those channels
carry their own signing/trust — and every Windows binary still ships with cosign provenance for
authenticity. Getting all releases onto fully-trusted Scoop and Homebrew is the current priority.

### [SWR-SIGN-GAPS] Outstanding signing work

macOS signing is a solved problem and is being rolled out binary by binary, tracked per repo. The items
below are the remaining required work:

| ID | Required control | Location |
|---|---|---|
| SWR-SIGN-GAP-CERT-IMPORT | Import the Developer ID cert in the release workflow | `.github/workflows/release.reusable.yml` |
| SWR-SIGN-GAP-VSIX-SIGNING | Add the macOS sign step to the per-platform VSIX publish | `templates/gh-actions/publish-vsix-per-platform.yml` |
| SWR-SIGN-GAP-SECRETS | Create the Apple signing secrets in the GitHub org | GitHub org/repo settings |
| SWR-SIGN-GAP-VERIFY | Add a CI check that a darwin binary is signed before upload | `release.reusable.yml` build job |
| SWR-SIGN-GAP-COSIGN | Cosign-sign the release `SHA256SUMS` | `release.reusable.yml` release-assets job (`SWR-SEC-CHECKSUM`) |

## [SWR-SEC-MANIFEST] Manifest surface

`shipwright.json` encodes these requirements so products opt in declaratively and the host enforces them:

- Top-level **`supplyChain`** policy: `slsaBuildLevel` (only `2`), `provenance`, `sbom`,
  `signedChecksums`, `frozenInstall`, `pinnedActions`, `oidcPublish`, `vulnGate`. Absent = inherit the
  secure defaults above.
- Per-component **`githubRelease`** integrity: `checksum`, `signature` (`cosign`|`none`),
  `signerWorkflow`, `provenance`, `sbom`, `predicateType`. The host verifies these before exec.
- **`bundled.checksum`** — the host re-verifies a bundled binary's digest at activation
  (`SWR-VSIX-BUNDLE-VERIFY`). **`asset.requireHashes`** — pip/url assets install with `--require-hashes`.

See `schemas/shipwright.schema.json`; conformance is enforced by the gates in
[acceptance-gates.md](acceptance-gates.md).

## [SWR-SEC-REFERENCES] Authorities

- SLSA v1.0 levels — https://slsa.dev/spec/v1.0/levels
- GitHub artifact attestations & `gh attestation verify` — https://docs.github.com/en/actions/concepts/security/artifact-attestations
- Sigstore cosign (blobs) — https://docs.sigstore.dev/cosign/signing/signing_with_blobs/
- GitHub Actions security hardening & `GITHUB_TOKEN` permissions — https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- npm trusted publishing / provenance — https://docs.npmjs.com/trusted-publishers/
- crates.io trusted publishing — https://crates.io/docs/trusted-publishing
- NuGet trusted publishing — https://learn.microsoft.com/en-us/nuget/nuget-org/trusted-publishing
- pub.dev automated publishing — https://dart.dev/tools/pub/automated-publishing
- Maven Central: GPG requirement — https://central.sonatype.org/publish/requirements/gpg/ ; OSSRH sunset — https://central.sonatype.org/pages/ossrh-eol/
- JetBrains plugin signing — https://plugins.jetbrains.com/docs/intellij/plugin-signing.html
- CycloneDX — https://cyclonedx.org/ ; cargo-auditable — https://github.com/rust-secure-code/cargo-auditable
- OSV-Scanner — https://google.github.io/osv-scanner/ ; cargo-deny — https://embarkstudios.github.io/cargo-deny/
- Apple notarization — https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Microsoft SmartScreen / code signing — https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- Open VSX security update (Oct 2025) — https://blogs.eclipse.org/post/mika%C3%ABl-barbero/open-vsx-security-update-october-2025
- VS Code publishing & signed-extension verification — https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- CISA: SolarWinds AA20-352A; Codecov (2021-04-30); tj-actions/reviewdog (2025-03-18); Log4Shell
