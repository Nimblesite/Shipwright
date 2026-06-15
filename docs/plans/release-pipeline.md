# Release Pipeline Plan

```
Spec prefix: SWR-REL-*
Status: Draft
Date: 2026-04-27
```

## Context

Shipwright is a generic, portfolio-shareable toolkit consumed by downstream products across multiple language ecosystems. To be useful, every library package must be available from the canonical registry for its language — `crates.io`, `npm`, `NuGet`, `pub.dev`, and `Maven Central`. This plan defines the end-to-end release process: version coordination, per-registry preparation and publication, the GitHub Actions workflow that orchestrates everything, rollback procedures, and a complete TODO checklist.

---

## Packages Being Released

| Registry | Packages |
|---|---|
| crates.io | `shipwright-manifest`, `shipwright`, `shipwright-host`, `shipwright-zed`, `shipwright-version-stamp` |
| npm (scoped public) | `@nimblesite/shipwright-core`, `@nimblesite/shipwright-vscode`, `@nimblesite/shipwright-mcp`, `@nimblesite/shipwright-validate-manifest` |
| NuGet | `Shipwright` |
| pub.dev | `shipwright` |
| Maven Central | `dev.shipwright:shipwright-intellij` |
| GitHub Release | Binary archives + sha256 for `shipwright-version-stamp` (5 platforms) |

---

## 1. Version Coordination — SWR-REL-VERSION

### 1.1 Single Source of Truth

Source-controlled deployable versions stay at the valid semantic placeholder `0.0.0-dev`. The
release version is an explicit build input derived from the `v*` tag, and every deployed version
field is stamped in the runner working tree before build, verification, packaging, or publish.

No release workflow may commit, push, or move refs after the tag exists.

### 1.2 shipwright-version-stamp Invocation

```bash
# Dry-run first, then stamp the local/runner working tree only
shipwright-version-stamp --tag v1.2.3 --root . --dry-run
shipwright-version-stamp --tag v1.2.3 --root .
```

Tests must be able to pass an arbitrary semantic version into the same stamper. The stamper must
use structured parsers for structured files; no ad hoc `sed` version rewrites.

`build.gradle.kts` is not yet handled — see gap SWR-REL-GAP-GRADLE-STAMP.

### 1.3 Version Consistency Verification — SWR-REL-VERSION-VERIFY

`scripts/verify-versions.sh` asserts every stamped manifest agrees with the release tag before any
publish job runs. It checks the runner working tree after `shipwright-version-stamp` has executed:

1. `version` in root `Cargo.toml` `[workspace.package]`
2. `version` in every `package.json` (excluding `node_modules/`, `target/`)
3. `<Version>` in every `*.csproj`
4. `version:` in every `pubspec.yaml`
5. `version = "…"` in `clients/kotlin/shipwright-intellij/build.gradle.kts`

---

## 2. Pre-Release Checklist — SWR-REL-PRERELEASE

All items must pass before the release tag is pushed.

1. **SWR-REL-PRERELEASE-CHANGELOG** — `CHANGELOG.md` at repo root has an entry for the new version.
2. **SWR-REL-PRERELEASE-PR** — A PR titled `chore: prepare release v{version}` is merged to
   `main`. It contains the changelog/release metadata only. It MUST NOT contain source version
   bumps.
3. **SWR-REL-PRERELEASE-CI** — `make ci` passes on the release commit.
4. **SWR-REL-PRERELEASE-MANIFEST** — Fixture validation passes (`make lint` already includes this).
5. **SWR-REL-PRERELEASE-COVERAGE** — `make test` satisfies the threshold in `coverage-thresholds.json`.
6. **SWR-REL-PRERELEASE-DRY-RUN** — All registry dry-run jobs in `release.yml` pass before any publish job is allowed to start.

---

## 3. crates.io Publishing — SWR-REL-CRATES

### 3.1 Publish Order

```
1. shipwright-manifest    (no internal deps)
2. shipwright             (depends on shipwright-manifest)
3. shipwright-host        (no internal deps — parallel with step 2)
4. shipwright-zed         (depends on shipwright-host)
5. shipwright-version-stamp (no internal library deps)
```

Steps 2 and 3 can run in parallel; step 4 must wait for step 3.

### 3.2 Commands

```bash
cargo publish -p shipwright-manifest
sleep 30
cargo publish -p shipwright && cargo publish -p shipwright-host
sleep 30
cargo publish -p shipwright-zed
cargo publish -p shipwright-version-stamp
```

### 3.3 Secret

`CARGO_REGISTRY_TOKEN` — crates.io API token with publish rights.

---

## 4. npm Publishing — SWR-REL-NPM

### 4.1 Publish Order

```
1. @nimblesite/shipwright-core              (no internal workspace deps)
2. @nimblesite/shipwright-validate-manifest (parallel with step 1)
3. @nimblesite/shipwright-mcp               (parallel with step 1)
4. @nimblesite/shipwright-vscode            (depends on @nimblesite/shipwright-core)
```

### 4.2 Commands

```bash
pnpm --filter @nimblesite/shipwright-core build
pnpm --filter @nimblesite/shipwright-core publish --access public --no-git-checks

pnpm --filter @nimblesite/shipwright-validate-manifest publish --access public --no-git-checks
pnpm --filter @nimblesite/shipwright-mcp publish --access public --no-git-checks

pnpm --filter @nimblesite/shipwright-vscode build
pnpm --filter @nimblesite/shipwright-vscode publish --access public --no-git-checks
```

### 4.3 Authentication — OIDC Trusted Publishing

No `NPM_TOKEN` secret is used. `release.yml` publishes via npm OIDC trusted publishing
(`npm publish --provenance`, npm CLI ≥ 11.5.1, `id-token: write` permission). Each package
must be registered as a Trusted Publisher on npmjs.com pointing at
`repo=Nimblesite/Shipwright`, `workflow=.github/workflows/release.yml`, `environment=release`.
The GitHub-issued OIDC token is exchanged for a short-lived publish token at publish time.

---

## 5. NuGet Publishing — SWR-REL-NUGET

### 5.1 Commands

```bash
dotnet pack clients/dotnet/Shipwright/Shipwright.csproj -c Release -o ./nupkg --include-symbols
dotnet nuget push ./nupkg/Shipwright.*.nupkg \
  --api-key $NUGET_API_KEY --source https://api.nuget.org/v3/index.json --skip-duplicate
```

### 5.2 Secret

`NUGET_API_KEY` — NuGet.org API key scoped to the `Shipwright` package.

---

## 6. pub.dev Publishing — SWR-REL-DART

### 6.1 Commands

```bash
cd clients/dart/shipwright
dart pub publish --dry-run

# CI (non-interactive)
dart pub token add https://pub.dev --token $DART_PUB_TOKEN
dart pub publish --force
```

### 6.2 Secret

`DART_PUB_TOKEN` — pub.dev OAuth access token.

---

## 7. Maven Central Publishing — SWR-REL-MAVEN

### 7.1 Commands

```bash
cd clients/kotlin/shipwright-intellij
./gradlew publishMavenJavaPublicationToSonatypeStagingRepository
./gradlew closeAndReleaseSonatypeStagingRepository
```

### 7.2 Secrets

- `SONATYPE_USERNAME`, `SONATYPE_PASSWORD`
- `GPG_SIGNING_KEY`, `GPG_SIGNING_PASSWORD`

---

## 8. GitHub Release — SWR-REL-GITHUB

### 8.1 Tag Strategy

Single annotated tag `v{version}` pushed to the prepared `main` commit after the release PR merges.
That tagged commit still carries source placeholders; release jobs stamp the tag version in their
runner working trees and build the exact tagged SHA.

```bash
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

### 8.2 Binary Artifacts — SWR-REL-PROVENANCE / SWR-REL-SBOM

`shipwright-version-stamp` is the only binary in this repo. Archives per platform:

- `shipwright-version-stamp-{version}-{platform}.tar.gz` (Unix)
- `shipwright-version-stamp-{version}-win32-x64.zip` (Windows)

Each archive additionally ships, per the supply-chain contract
([supply-chain-security.md](../specs/supply-chain-security.md)):

- A **CycloneDX SBOM** (`cargo cyclonedx` / Syft), attested with `actions/attest-sbom`
  (`SWR-SEC-SBOM`). Rust binaries are built with `cargo-auditable`.
- A signed **SLSA build provenance** attestation from `actions/attest-build-provenance`
  (`SWR-SEC-PROVENANCE`).
- A single **`SHA256SUMS`** over all assets, **cosign keyless-signed** — replacing the prior
  per-asset `.sha256` model — published as `SHA256SUMS` + `SHA256SUMS.sigstore.json`
  (`SWR-SEC-CHECKSUM`).

---

## 9. GitHub Actions Workflow Structure — SWR-REL-WORKFLOW

### 9.1 Trigger

```yaml
on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+'
      - 'v[0-9]+.[0-9]+.[0-9]+-*'
```

### 9.2 Job Structure

Current `release.yml` is a single `release` job (stamp → `make ci` gate → publish), followed
by a `pages` job that deploys the website to GitHub Pages. The publish steps run in order:

```
release (ubuntu-latest, environment: release)
  ├── stamp version from tag (shipwright-version-stamp)
  ├── make ci  (CI gate)
  ├── npm:    core, mcp, vscode (workspace:* repacked), validate-manifest  (OIDC, idempotent skip-if-published)
  ├── crates: shipwright-manifest → [host, shipwright] → [zed, version-stamp]  (batched, index-wait sleeps)
  └── nuget:  pack + push --skip-duplicate

pages (needs: release)
  └── build website + deploy-pages
```

Not yet wired into `release.yml` (see TODO Phases 3–4 and §13 Gaps): pub.dev publish,
Maven Central publish, per-platform binary build/release-assets, and the dedicated dry-run
gate jobs. The DAG above is the current implemented shape, not the eventual target.

Per the supply-chain contract, the eventual binary-release DAG adds, after build/pack and before
the release-assets upload:

```
build/pack
  ├── cargo-auditable build + cargo cyclonedx (SBOM)              SWR-REL-SBOM
  ├── attest-build-provenance (per artifact, job: id-token:write) SWR-REL-PROVENANCE
  └── attest-sbom (per artifact)
sign-checksums (job: id-token:write)
  └── cosign sign-blob over SHA256SUMS                            SWR-SEC-CHECKSUM
release-assets
  └── upload archives + SHA256SUMS + SHA256SUMS.sigstore.json + SBOMs
```

All jobs run with job-scoped `permissions` and SHA-pinned actions (`SWR-SEC-ACTION-PINNING` /
`SWR-SEC-TOKEN-PRIVILEGE`). The npm side already uses OIDC + `--provenance`; the native-binary
side is raised to the same authenticity bar.

### 9.3 Required Secrets

| Secret | Used By |
|---|---|
| `CARGO_REGISTRY_TOKEN` | crates.io jobs |
| _(none)_ | npm jobs — OIDC trusted publishing, no secret (see [SWR-REL-NPM]) |
| `NUGET_API_KEY` | NuGet job |
| `DART_PUB_TOKEN` | pub.dev job |
| `SONATYPE_USERNAME` | Maven job |
| `SONATYPE_PASSWORD` | Maven job |
| `GPG_SIGNING_KEY` | Maven job |
| `GPG_SIGNING_PASSWORD` | Maven job |
| `APPLE_DEVELOPER_ID_CERT_P12` | macOS binary signing (all darwin-* build legs) |
| `APPLE_DEVELOPER_ID_CERT_PASSWORD` | macOS binary signing |
| `APPLE_TEAM_ID` | macOS binary signing |
| `NOTARIZATION_API_KEY_P8` | macOS notarization (all darwin-* build legs) |
| `NOTARIZATION_KEY_ID` | macOS notarization |
| `NOTARIZATION_ISSUER_ID` | macOS notarization |

---

## 10. Rollback and Yanking — SWR-REL-ROLLBACK

| Registry | Command |
|---|---|
| crates.io | `cargo yank --version {v} {crate}` / `--undo` to reverse |
| npm | `npm deprecate @nimblesite/shipwright-core@{v} "yanked"` (unpublish only within 72 h) |
| NuGet | `dotnet nuget delete Shipwright {v} --api-key ... --non-interactive` (unlists only) |
| pub.dev | No yank — publish a patch release immediately |
| Maven Central | No deletion — publish patch release |
| GitHub Release | `gh release delete v{v} --yes` + `git push origin --delete v{v}` |

---

## 11. Post-Release — SWR-REL-POSTRELEASE

1. Verify `build-info.json` at repo root reflects the released version.
2. Verify source-controlled project versions remain at the placeholder.
3. Ratchet `coverage-thresholds.json` to the measured value (never lower).
4. Notify downstream consumers to update their dependency versions.

### Downstream Consumer Update Checklist

| Ecosystem | Action |
|---|---|
| Rust | `cargo update -p shipwright-manifest` and update pinned versions in `Cargo.toml` |
| VS Code extensions | `pnpm update @nimblesite/shipwright-core @nimblesite/shipwright-vscode` |
| Node/MCP | `pnpm update @nimblesite/shipwright-mcp` |
| .NET | Update `<PackageReference Version="…">` in consuming `.csproj` |
| Dart | `dart pub upgrade shipwright` in consuming `pubspec.yaml` |
| IntelliJ plugins | Update `build.gradle.kts` dependency version, run `./gradlew dependencies` |

---

## 12. macOS Binary Signing — SWR-REL-SIGN

All macOS binaries MUST be signed with a Developer ID Application certificate and notarized
before upload. The full signing spec is in `docs/specs/supply-chain-security.md` (OS Code Signing, `SWR-SIGN-*`).

Summary of what changes in the release pipeline:

- **`release.reusable.yml`** — add certificate import and sign/notarize/staple steps on all
  `darwin-*` matrix legs, between the binary build step and the archive step.
  See [SWR-SIGN-APPLE-CI] and [SWR-SIGN-APPLE-INTEGRATION].
- **`publish-vsix-per-platform.yml`** — add a sign step on `darwin-*` legs between binary
  build and the `SWR-VSIX-STAGING` copy step. VSIX binaries must be signed so Gatekeeper
  passes when VS Code executes them; the VSIX package itself does not require notarization.

### Additional Secrets for Apple Signing

| Secret | Content |
|---|---|
| `APPLE_DEVELOPER_ID_CERT_P12` | Base64-encoded `.p12` Developer ID Application cert + private key |
| `APPLE_DEVELOPER_ID_CERT_PASSWORD` | Password for the `.p12` export |
| `APPLE_TEAM_ID` | 10-character Apple team identifier |
| `NOTARIZATION_API_KEY_P8` | Base64-encoded App Store Connect API key `.p8` |
| `NOTARIZATION_KEY_ID` | App Store Connect Key ID |
| `NOTARIZATION_ISSUER_ID` | App Store Connect Issuer UUID |

These join the existing secrets table in [SWR-REL-WORKFLOW].

---

## 13. Gaps — SWR-REL-GAPS

| ID | Gap | Location |
|---|---|---|
| SWR-REL-GAP-GRADLE-STAMP | `shipwright-version-stamp` does not stamp `build.gradle.kts` | `tools/shipwright-version-stamp/src/main.rs` |
| SWR-REL-GAP-MAVEN-PUBLISH | `publications {}` block empty, no signing, no KDoc, no Sonatype config | `clients/kotlin/shipwright-intellij/build.gradle.kts` |
| SWR-REL-GAP-APPLE-SIGNING | Sign/notarize/staple steps not yet in `release.reusable.yml` or `publish-vsix-per-platform.yml` | See `docs/specs/supply-chain-security.md` [SWR-SIGN-GAPS] |
| SWR-REL-GAP-PROVENANCE | No `actions/attest-build-provenance` in `release.reusable.yml` or binary templates | `release.reusable.yml`; `templates/gh-actions/*` — see [SWR-SEC-PROVENANCE] |
| SWR-REL-GAP-SBOM | No SBOM generation/attestation (`cargo cyclonedx`/Syft + `attest-sbom`) | `release.reusable.yml` build job — see [SWR-SEC-SBOM] |
| SWR-REL-GAP-COSIGN | `SHA256SUMS` not cosign-signed; per-asset `.sha256` still used | `release.reusable.yml` release-assets job — see [SWR-SEC-CHECKSUM] |
| SWR-REL-GAP-ACTION-PINNING | `uses:` refs on mutable tags in `release.reusable.yml`/`release.yml`/`ci.yml` | All `.github/workflows/*.yml` — see [SWR-SEC-ACTION-PINNING] |
| SWR-REL-GAP-TOKEN-PRIVILEGE | `release.reusable.yml` top-level `contents: write` inherited by build/matrix jobs | `release.reusable.yml` — see [SWR-SEC-TOKEN-PRIVILEGE] |
| SWR-REL-GAP-CODE-SCANNING | No `codeql.yml` code scanning workflow (matrix: actions, rust, javascript-typescript) | `.github/workflows/` — see [SWR-SEC-CODE-SCANNING] |
| SWR-REL-GAP-SECRET-SCANNING | Secret scanning + push protection not enabled in repo settings | GitHub repo settings — see [SWR-SEC-SECRET-SCANNING] |
| SWR-REL-GAP-SECURITY-POLICY | No `SECURITY.md` / private vulnerability reporting not enabled | repo root or `.github/` — see [SWR-SEC-POLICY] |

---

## TODO Checklist

### Phase 1 — npm + NuGet (current priority)

- [x] Build pipeline (`tsc` to `dist/`) for all three TypeScript packages
- [x] `publishConfig`, `files`, `license`, `repository` in all `package.json` files
- [x] `.npmrc` with `@nimblesite` scope
- [x] NuGet metadata (SourceLink, symbols, README) in both `.csproj` files
- [x] `release.yml` with CI gate, dry-run, and publish jobs for npm + NuGet

### Phase 2 — crates.io

- [x] Publish `shipwright-manifest` first, then `shipwright` + `shipwright-host` in parallel, then `shipwright-zed`, then `shipwright-version-stamp`
- [x] Add crates publish jobs to `release.yml` (implemented via `scripts/cargo-publish-or-skip.sh`, batched with index-wait sleeps)

### Phase 3 — pub.dev

- [ ] Dart dry-run passes with 0 warnings (currently done — verify still passing)
- [ ] Add `publish-dart` job to `release.yml`

### Phase 4 — Maven Central

- [ ] Add `signing` plugin, Dokka, `publications {}` block, Sonatype config to `build.gradle.kts`
- [ ] Add `stamp_gradle` to `shipwright-version-stamp` for `build.gradle.kts`
- [ ] Add `publish-maven` job to `release.yml`

### Phase 5 — GitHub Secrets (one-time manual setup)

- [ ] `CARGO_REGISTRY_TOKEN`
- [x] npm — no secret; register each package as a Trusted Publisher on npmjs.com (OIDC, see [SWR-REL-NPM])
- [ ] `NUGET_API_KEY`
- [ ] `DART_PUB_TOKEN`
- [ ] `SONATYPE_USERNAME` / `SONATYPE_PASSWORD`
- [ ] `GPG_SIGNING_KEY` / `GPG_SIGNING_PASSWORD`
- [ ] `APPLE_DEVELOPER_ID_CERT_P12` (base64 `.p12` export of Developer ID Application cert)
- [ ] `APPLE_DEVELOPER_ID_CERT_PASSWORD`
- [ ] `APPLE_TEAM_ID`
- [ ] `NOTARIZATION_API_KEY_P8` (base64 App Store Connect `.p8` key — download once from appstoreconnect.apple.com/access/api)
- [ ] `NOTARIZATION_KEY_ID`
- [ ] `NOTARIZATION_ISSUER_ID`
- [ ] Create `release` GitHub environment with required reviewer and tag branch restriction `v*.*.*`

### Phase 5b — Apple Signing CI Integration

- [ ] Add Developer ID certificate import step to `release.reusable.yml` for `darwin-*` legs
- [ ] Add sign/notarize/staple steps to `release.reusable.yml` after binary build, before archive
- [ ] Add sign step to `publish-vsix-per-platform.yml` for `darwin-*` legs after binary build
- [ ] Add `SWR-SIGN-GAP-VERIFY` check: assert `codesign --verify` exits 0 before upload
- [ ] Smoke test: download a released darwin binary, run `spctl --assess --verbose` — must pass

### Phase 6 — First Release (v0.1.0)

- [ ] Write `## [0.1.0] - YYYY-MM-DD` entry in `CHANGELOG.md`
- [ ] Run `shipwright-version-stamp --tag v0.1.0 --root . --dry-run` and verify all files shown
- [ ] Run `shipwright-version-stamp --tag v0.1.0 --root <temp-copy>` and verify tests can stamp a non-source working tree
- [ ] Run `scripts/verify-versions.sh 0.1.0` against the stamped tree — must exit 0
- [ ] Confirm `make ci` passes on `main`
- [ ] Commit release notes/metadata on branch `chore/release-v0.1.0`, open PR, merge to `main`
- [ ] Push annotated tag: `git tag -a v0.1.0 -m "Release v0.1.0" && git push origin v0.1.0`
- [ ] Monitor `release.yml` workflow run
- [ ] Ratchet `coverage-thresholds.json` to measured coverage value
- [ ] Confirm source-controlled versions are still `0.0.0-dev`
