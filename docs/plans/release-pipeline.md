# Release Pipeline Plan

```
Spec prefix: DTK-REL-*
Status: Draft
Date: 2026-04-27
```

## Context

`deployment_toolkit` is a generic, portfolio-shared library consumed by downstream products across five language ecosystems. To be useful, every library package must be available from the canonical registry for its language — `crates.io`, `npm`, `NuGet`, `pub.dev`, and `Maven Central`. This plan defines the end-to-end release process: version coordination, per-registry preparation and publication, the GitHub Actions workflow that orchestrates everything, rollback procedures, and a complete TODO checklist. This is not a Nimblesite-specific plan; it applies to any consumer of `deployment_toolkit`.

---

## Packages Being Released

| Registry | Packages |
|---|---|
| crates.io | `deploy-toolkit-manifest`, `deploy-toolkit-cli`, `deploy-toolkit-host`, `deploy-toolkit-zed`, `deploy-stamp` |
| npm (scoped public) | `@deploy-toolkit/core`, `@deploy-toolkit/vscode`, `@deploy-toolkit/node`, `@deploy-toolkit/validate-manifest`, `deploy-toolkit` |
| NuGet | `DeployToolkit`, `DeployToolkit.Tool` |
| pub.dev | `deploy_toolkit` |
| Maven Central | `dev.deploytoolkit:deploy-toolkit-intellij` |
| GitHub Release | Binary archives + sha256 for `deploy-stamp` (5 platforms) |

---

## 1. Version Coordination — DTK-REL-VERSION

### 1.1 Single Source of Truth

The canonical version lives in `/Cargo.toml` under `[workspace.package] version`. No version field in any other file is edited by hand — every bump goes through `deploy-stamp`.

### 1.2 deploy-stamp Invocation

`tools/deploy-stamp/` already handles `Cargo.toml`, every `package.json`, every `*.csproj`, and `pubspec.yaml`.

```bash
# Dry-run first, then write
deploy-stamp --tag v1.2.3 --root . --dry-run
deploy-stamp --tag v1.2.3 --root .
```

`build.gradle.kts` is not yet handled — see gap DTK-REL-GAP-GRADLE-STAMP.

### 1.3 Version Consistency Verification — DTK-REL-VERSION-VERIFY

A script `scripts/verify-versions.sh` (to be created) must assert every manifest agrees with the release tag before any publish job runs. It checks:

1. `version` in root `Cargo.toml` `[workspace.package]`
2. `version` in every `package.json` (excluding `node_modules/`, `target/`)
3. `<Version>` in every `*.csproj`
4. `version:` in every `pubspec.yaml`
5. `version = "…"` in `clients/kotlin/deploy-toolkit-intellij/build.gradle.kts`

The script is called from the `stamp` job in `release.yml` immediately after `deploy-stamp` runs.

---

## 2. Pre-Release Checklist — DTK-REL-PRERELEASE

All items must pass before the release tag is pushed. Items 1–2 are human gates; items 3–6 are enforced by `release.yml`.

1. **DTK-REL-PRERELEASE-CHANGELOG** — `CHANGELOG.md` at repo root has an entry for the new version (Keep a Changelog format: `## [1.2.3] - YYYY-MM-DD`).
2. **DTK-REL-PRERELEASE-PR** — A PR titled `chore: release v{version}` is merged to `main`. It contains only: version bumps from `deploy-stamp`, `build-info.json`, and the CHANGELOG entry. No code changes.
3. **DTK-REL-PRERELEASE-CI** — `make ci` passes on the release commit.
4. **DTK-REL-PRERELEASE-MANIFEST** — Fixture validation passes (`make lint` already includes this).
5. **DTK-REL-PRERELEASE-COVERAGE** — `make test` satisfies the threshold in `coverage-thresholds.json`.
6. **DTK-REL-PRERELEASE-DRY-RUN** — All registry dry-run jobs in `release.yml` pass before any publish job is allowed to start.

---

## 3. crates.io Publishing — DTK-REL-CRATES

### 3.1 Publish Order (dependency-driven)

```
1. deploy-toolkit-manifest   (no internal deps)
2. deploy-toolkit-cli        (depends on deploy-toolkit-manifest)
3. deploy-toolkit-host       (no internal deps — parallel with step 2)
4. deploy-toolkit-zed        (depends on deploy-toolkit-host)
5. deploy-stamp              (no internal library deps)
```

Steps 2 and 3 can run in parallel; step 4 must wait for step 3.

### 3.2 Required Cargo.toml Metadata — DTK-REL-CRATES-METADATA

Fields missing from `[workspace.package]` (add here for all crates):

```toml
homepage     = "https://github.com/nimblesite/deployment_toolkit"
keywords     = ["deployment", "versioning", "ide-extension", "binary", "tooling"]
categories   = ["development-tools", "development-tools::build-utils"]
readme       = "README.md"   # each crate needs its own README.md
```

`documentation` must be set per-crate in each `Cargo.toml` because the docs.rs URL includes the crate name (e.g. `https://docs.rs/deploy-toolkit-manifest`).

`crates/deploy-toolkit-manifest/Cargo.toml` is also missing `[lints] workspace = true`.

### 3.3 Commands

```bash
# Dry-run (all five)
cargo publish --dry-run -p deploy-toolkit-manifest
cargo publish --dry-run -p deploy-toolkit-cli
cargo publish --dry-run -p deploy-toolkit-host
cargo publish --dry-run -p deploy-toolkit-zed
cargo publish --dry-run -p deploy-stamp

# Publish (with 30s pause between dependents for index propagation)
cargo publish -p deploy-toolkit-manifest
sleep 30
cargo publish -p deploy-toolkit-cli && cargo publish -p deploy-toolkit-host
sleep 30
cargo publish -p deploy-toolkit-zed
cargo publish -p deploy-stamp
```

### 3.4 Secret

`CARGO_REGISTRY_TOKEN` — crates.io API token with publish rights.

---

## 4. npm Publishing — DTK-REL-NPM

### 4.1 Publish Order

```
1. @deploy-toolkit/core              (no internal workspace deps)
2. @deploy-toolkit/validate-manifest (no internal workspace deps — parallel with step 1)
3. @deploy-toolkit/node              (no internal workspace deps — parallel with step 1)
4. @deploy-toolkit/vscode            (depends on @deploy-toolkit/core)
5. deploy-toolkit                    (no internal workspace deps — parallel with step 4)
```

### 4.2 Package Readiness Gaps — DTK-REL-NPM-READY

Every `package.json` is missing fields required for public publish:

- `"license": "MIT OR Apache-2.0"`
- `"repository": { "type": "git", "url": "https://github.com/nimblesite/deployment_toolkit.git" }`
- `"homepage"`, `"keywords"`
- `"publishConfig": { "access": "public" }` (required for scoped packages)
- `"files": ["dist/", "README.md", "LICENSE"]`

TypeScript packages export `src/index.ts` directly — they need a `tsc` build step writing to `dist/` and updated `exports`/`main`/`types` fields pointing to `dist/` before they are publishable.

### 4.3 .npmrc — DTK-REL-NPM-NPMRC

Create `.npmrc` at repo root:

```
@deploy-toolkit:registry=https://registry.npmjs.org/
provenance=true
```

### 4.4 Commands

```bash
pnpm --filter @deploy-toolkit/core build
pnpm --filter @deploy-toolkit/core publish --access public --no-git-checks

pnpm --filter @deploy-toolkit/validate-manifest publish --access public --no-git-checks
pnpm --filter @deploy-toolkit/node publish --access public --no-git-checks

pnpm --filter @deploy-toolkit/vscode build
pnpm --filter @deploy-toolkit/vscode publish --access public --no-git-checks

pnpm --filter deploy-toolkit publish --access public --no-git-checks
```

### 4.5 Secret

`NPM_TOKEN` — granular npm access token with publish rights to the `@deploy-toolkit` scope.

---

## 5. NuGet Publishing — DTK-REL-NUGET

### 5.1 Publish Order

`DeployToolkit.Tool` has a `ProjectReference` to `DeployToolkit` — library publishes first.

### 5.2 Required Metadata Additions — DTK-REL-NUGET-METADATA

Both `*.csproj` files need:

- `<PackageReadmeFile>README.md</PackageReadmeFile>`
- `<PackageTags>deployment versioning ide-extension binary tooling</PackageTags>`
- `<PackageProjectUrl>https://github.com/nimblesite/deployment_toolkit</PackageProjectUrl>`
- `<IncludeSymbols>true</IncludeSymbols>` + `<SymbolPackageFormat>snupkg</SymbolPackageFormat>`
- `<EmbedUntrackedSources>true</EmbedUntrackedSources>` + `<ContinuousIntegrationBuild>true</ContinuousIntegrationBuild>`
- `<PackageReference Include="Microsoft.SourceLink.GitHub" .../>` for Source Link

### 5.3 Commands

```bash
dotnet pack clients/dotnet/DeployToolkit/DeployToolkit.csproj -c Release -o ./nupkg --include-symbols
dotnet nuget push ./nupkg/DeployToolkit.{version}.nupkg \
  --api-key $NUGET_API_KEY --source https://api.nuget.org/v3/index.json --skip-duplicate

dotnet pack clients/dotnet/DeployToolkit.Tool/DeployToolkit.Tool.csproj -c Release -o ./nupkg --include-symbols
dotnet nuget push ./nupkg/DeployToolkit.Tool.{version}.nupkg \
  --api-key $NUGET_API_KEY --source https://api.nuget.org/v3/index.json --skip-duplicate
```

### 5.4 Secret

`NUGET_API_KEY` — NuGet.org API key scoped to the `DeployToolkit` package glob.

---

## 6. pub.dev Publishing — DTK-REL-DART

### 6.1 Scoring Prerequisites — DTK-REL-DART-SCORE

pub.dev deducts points for missing items. Currently absent from `clients/dart/deploy_toolkit/`:

- `README.md`
- `CHANGELOG.md`
- `example/` directory with at least one `.dart` file
- `platforms:` key in `pubspec.yaml`

All four must be created before the first publish.

### 6.2 Commands

```bash
cd clients/dart/deploy_toolkit
dart pub publish --dry-run

# CI (non-interactive)
dart pub token add https://pub.dev --token $DART_PUB_TOKEN
dart pub publish --force
```

### 6.3 Secret

`DART_PUB_TOKEN` — pub.dev OAuth access token, obtained via `dart pub token add` interactively and stored as a GitHub secret.

---

## 7. Maven Central Publishing — DTK-REL-MAVEN

### 7.1 Target Registry

`deploy-toolkit-intellij` is a pure Kotlin/JVM library (not an IntelliJ plugin artifact). The correct target is **Maven Central** (`dev.deploytoolkit:deploy-toolkit-intellij`), not JetBrains Marketplace.

### 7.2 Required build.gradle.kts Additions — DTK-REL-MAVEN-CENTRAL

Current `build.gradle.kts` applies `maven-publish` but has no `publications {}` block. The following must be added:

- `signing` plugin + `useInMemoryPgpKeys(signingKey, signingPassword)`
- `id("org.jetbrains.dokka")` plugin for KDoc JAR
- `java { withSourcesJar(); withJavadocJar() }`
- Complete `publications { create<MavenPublication>("mavenJava") { ... } }` with POM: name, description, URL, license, developer (id/name/email), SCM (connection/url)
- Sonatype staging repository in `repositories {}`
- `nexus-publish` Gradle plugin for automated staging close and release

### 7.3 Gradle Version Stamping — DTK-REL-GAP-GRADLE-STAMP

`deploy-stamp` does not yet handle `build.gradle.kts`. Short-term: add a targeted rewrite step in the `stamp` CI job for `version = "…"` in that file. Long-term: add `stamp_gradle` to `tools/deploy-stamp/src/main.rs` following the same pattern as `stamp_pubspec`.

### 7.4 Commands

```bash
cd clients/kotlin/deploy-toolkit-intellij
./gradlew publishMavenJavaPublicationToSonatypeStagingRepository
./gradlew closeAndReleaseSonatypeStagingRepository
```

### 7.5 Secrets

- `SONATYPE_USERNAME`, `SONATYPE_PASSWORD` — OSSRH account credentials
- `GPG_SIGNING_KEY` — ASCII-armored GPG private key
- `GPG_SIGNING_PASSWORD` — GPG key passphrase

---

## 8. GitHub Release — DTK-REL-GITHUB

### 8.1 Tag Strategy

Single annotated tag `v{version}` pushed to `main` after the release PR merges. `release.yml` triggers on `push: tags: ['v*.*.*']`. The tag must only be pushed after `make ci` passes on the release commit.

```bash
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin v0.2.0
```

### 8.2 Binary Artifacts

`deploy-stamp` is the only binary in this repo. The existing `templates/gh-actions/release-binary-multiplatform.yml` handles cross-platform builds. Archives per platform:

- `deploy-stamp-{version}-{platform}.tar.gz` + `.sha256` (Unix)
- `deploy-stamp-{version}-win32-x64.zip` + `.sha256` (Windows)

### 8.3 Release Notes

Extract the current version's section from `CHANGELOG.md`:

```bash
awk "/^## \[$version\]/{found=1; next} /^## \[/{if(found) exit} found{print}" CHANGELOG.md > release-notes.txt
```

Pass via `body_path: release-notes.txt` to `softprops/action-gh-release@v2`.

---

## 9. GitHub Actions Workflow Structure — DTK-REL-WORKFLOW

### 9.1 Workflow File

Create `.github/workflows/release.yml`. This is the orchestrating release workflow for registry publishing. The existing `templates/gh-actions/release-binary-multiplatform.yml` is called by downstream product repos, not by this file.

### 9.2 Trigger

```yaml
on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+'
      - 'v[0-9]+.[0-9]+.[0-9]+-*'
```

### 9.3 Job DAG

```
stamp
  └── verify-versions
        └── ci-gate (make ci)
              ├── dry-run-crates
              ├── dry-run-npm
              ├── dry-run-nuget
              ├── dry-run-dart
              │
              ├── [after all dry-runs pass]
              │     ├── publish-manifest → publish-cli + publish-host → publish-zed
              │     │                                                  └── publish-stamp
              │     ├── publish-npm-core → publish-npm-vscode
              │     │                    └── publish-npm-node / publish-npm-validate-manifest / publish-npm-cli
              │     ├── publish-nuget-library → publish-nuget-tool
              │     ├── publish-dart
              │     └── publish-maven
              │
              ├── build-binaries (matrix: 5 platforms)
              │     └── release-assets (GitHub Release)
              │           └── smoke
              │                 ├── publish-brew (optional)
              │                 └── publish-scoop (optional)
              │
              └── post-release-summary
```

### 9.4 Permissions and Concurrency

```yaml
permissions:
  contents: write
  id-token: write    # npm provenance

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

### 9.5 Environment Protection — DTK-REL-WORKFLOW-ENV

Create a GitHub environment named `release` with required reviewer and deployment branch rule matching `v*.*.*`. All `publish-*` jobs specify `environment: release`.

### 9.6 Required Secrets Summary

| Secret | Used By |
|---|---|
| `CARGO_REGISTRY_TOKEN` | crates.io jobs |
| `NPM_TOKEN` | npm jobs |
| `NUGET_API_KEY` | NuGet jobs |
| `DART_PUB_TOKEN` | pub.dev job |
| `SONATYPE_USERNAME` | Maven job |
| `SONATYPE_PASSWORD` | Maven job |
| `GPG_SIGNING_KEY` | Maven job |
| `GPG_SIGNING_PASSWORD` | Maven job |
| `publish_token` | Brew/Scoop jobs (optional) |

---

## 10. Rollback and Yanking — DTK-REL-ROLLBACK

| Registry | Command |
|---|---|
| crates.io | `cargo yank --version {v} {crate}` / `--undo` to reverse |
| npm | `npm deprecate @deploy-toolkit/core@{v} "yanked"` (unpublish only within 72 h) |
| NuGet | `dotnet nuget delete DeployToolkit {v} --api-key ... --non-interactive` (unlists only) |
| pub.dev | No yank — publish a patch release immediately; file dart.dev issue if security-critical |
| Maven Central | No deletion — publish patch release; request POM description update via Sonatype support |
| GitHub Release | `gh release delete v{v} --yes` + `git push origin --delete v{v}` |

---

## 11. Post-Release — DTK-REL-POSTRELEASE

After a stable release:

1. Verify `build-info.json` at repo root reflects the released version.
2. Open a follow-up PR bumping the workspace version to the next pre-release (e.g., `0.2.0-dev`) to prevent accidental re-releases.
3. Ratchet `coverage-thresholds.json` to the measured value (never lower).
4. Notify downstream consumers to update their dependency versions (see section on downstream checklist below).

### Downstream Consumer Update Checklist

| Ecosystem | Action |
|---|---|
| Rust | `cargo update -p deploy-toolkit-manifest` and update pinned versions in `Cargo.toml` |
| VS Code extensions | `pnpm update @deploy-toolkit/core @deploy-toolkit/vscode` |
| Node/MCP | `pnpm update @deploy-toolkit/node` |
| .NET | Update `<PackageReference Version="…">` in consuming `.csproj` |
| Dart | `dart pub upgrade deploy_toolkit` in consuming `pubspec.yaml` |
| IntelliJ plugins | Update `build.gradle.kts` dependency version, run `./gradlew dependencies` |

---

## 12. Gaps — DTK-REL-GAPS

| ID | Gap | Location |
|---|---|---|
| DTK-REL-GAP-CHANGELOG | `CHANGELOG.md` missing at repo root and in Dart/Kotlin packages | repo root, `clients/dart/deploy_toolkit/`, `clients/kotlin/deploy-toolkit-intellij/` |
| DTK-REL-GAP-RELEASE-WORKFLOW | `.github/workflows/release.yml` does not exist | `.github/workflows/` |
| DTK-REL-GAP-NPMRC | `.npmrc` missing at repo root | repo root |
| DTK-REL-GAP-NPM-BUILD | TS packages publish raw `src/` — no `tsc` build, no `dist/`, missing `files` array | `clients/ts/packages/*/package.json` |
| DTK-REL-GAP-NPM-PACKAGE-JSON-FIELDS | `license`, `repository`, `homepage`, `keywords`, `publishConfig` missing from all 5 npm packages | all npm `package.json` files |
| DTK-REL-GAP-CRATE-METADATA | `documentation`, `readme`, `keywords`, `categories` missing from all crates; `[lints] workspace = true` missing from `deploy-toolkit-manifest` | `Cargo.toml` files |
| DTK-REL-GAP-CRATE-READMES | No per-crate `README.md` (docs.rs requires these) | `crates/*/`, `tools/deploy-stamp/` |
| DTK-REL-GAP-NUGET-METADATA | `PackageReadmeFile`, `PackageTags`, `IncludeSymbols`, `SymbolPackageFormat`, Source Link missing | `clients/dotnet/**/*.csproj` |
| DTK-REL-GAP-NUGET-READMES | No `README.md` in dotnet project directories | `clients/dotnet/DeployToolkit/`, `clients/dotnet/DeployToolkit.Tool/` |
| DTK-REL-GAP-DART-SCORE | Missing `README.md`, `CHANGELOG.md`, `example/`, `platforms:` in `pubspec.yaml` | `clients/dart/deploy_toolkit/` |
| DTK-REL-GAP-MAVEN-PUBLISH | `publications {}` block empty, no signing, no KDoc, no Sonatype config | `clients/kotlin/deploy-toolkit-intellij/build.gradle.kts` |
| DTK-REL-GAP-GRADLE-STAMP | `deploy-stamp` does not stamp `build.gradle.kts` | `tools/deploy-stamp/src/main.rs` |
| DTK-REL-GAP-VERSION-VERIFY-SCRIPT | `scripts/verify-versions.sh` does not exist | `scripts/` |

---

## TODO Checklist

### Phase 0 — Foundation Files (no release blocker, but required for registry acceptance)

- [ ] **DTK-REL-GAP-CHANGELOG** Create `CHANGELOG.md` at repo root (Keep a Changelog format, with `## [Unreleased]` and `## [0.1.0] - 2026-04-27`)
- [ ] **DTK-REL-GAP-CHANGELOG** Create `clients/dart/deploy_toolkit/CHANGELOG.md`
- [ ] **DTK-REL-GAP-CHANGELOG** Create `clients/kotlin/deploy-toolkit-intellij/CHANGELOG.md`
- [ ] **DTK-REL-GAP-CRATE-READMES** Create `crates/deploy-toolkit-manifest/README.md`
- [ ] **DTK-REL-GAP-CRATE-READMES** Create `crates/deploy-toolkit-cli/README.md`
- [ ] **DTK-REL-GAP-CRATE-READMES** Create `crates/deploy-toolkit-host/README.md`
- [ ] **DTK-REL-GAP-CRATE-READMES** Create `crates/deploy-toolkit-zed/README.md`
- [ ] **DTK-REL-GAP-CRATE-READMES** Create `tools/deploy-stamp/README.md`
- [ ] **DTK-REL-GAP-DART-SCORE** Create `clients/dart/deploy_toolkit/README.md`
- [ ] **DTK-REL-GAP-DART-SCORE** Create `clients/dart/deploy_toolkit/example/main.dart` (minimal usage example)
- [ ] **DTK-REL-GAP-NUGET-READMES** Create `clients/dotnet/DeployToolkit/README.md`
- [ ] **DTK-REL-GAP-NUGET-READMES** Create `clients/dotnet/DeployToolkit.Tool/README.md`

### Phase 1 — Manifest Metadata Fixes

- [ ] **DTK-REL-CRATES-METADATA** Add `[lints] workspace = true` to `crates/deploy-toolkit-manifest/Cargo.toml`
- [ ] **DTK-REL-CRATES-METADATA** Add `homepage`, `keywords`, `categories`, `readme` to `[workspace.package]` in root `Cargo.toml`
- [ ] **DTK-REL-CRATES-METADATA** Add per-crate `documentation = "https://docs.rs/{crate-name}"` to each of the five `Cargo.toml` files
- [ ] **DTK-REL-NPM-PACKAGE-JSON-FIELDS** Add `license`, `repository`, `homepage`, `keywords`, `publishConfig: { "access": "public" }` to `clients/ts/packages/deploy-toolkit-core/package.json`
- [ ] **DTK-REL-NPM-PACKAGE-JSON-FIELDS** Same additions to `clients/ts/packages/deploy-toolkit-vscode/package.json`
- [ ] **DTK-REL-NPM-PACKAGE-JSON-FIELDS** Same additions to `clients/ts/packages/deploy-toolkit-node/package.json`
- [ ] **DTK-REL-NPM-PACKAGE-JSON-FIELDS** Same additions to `tools/validate-manifest/package.json`
- [ ] **DTK-REL-NPM-PACKAGE-JSON-FIELDS** Same additions to `tools/deploy-toolkit/package.json`
- [ ] **DTK-REL-NUGET-METADATA** Add `PackageReadmeFile`, `PackageTags`, `PackageProjectUrl`, `IncludeSymbols`, `SymbolPackageFormat`, `EmbedUntrackedSources`, `ContinuousIntegrationBuild`, and Microsoft.SourceLink.GitHub `PackageReference` to `clients/dotnet/DeployToolkit/DeployToolkit.csproj`
- [ ] **DTK-REL-NUGET-METADATA** Same additions to `clients/dotnet/DeployToolkit.Tool/DeployToolkit.Tool.csproj`
- [ ] **DTK-REL-DART-SCORE** Add `platforms:` key to `clients/dart/deploy_toolkit/pubspec.yaml`

### Phase 2 — npm Build Pipeline

- [ ] **DTK-REL-GAP-NPM-BUILD** Add `tsconfig.json` to each TypeScript package: `"outDir": "dist"`, `"declaration": true`, `"module": "ESNext"`, `"declarationMap": true`
- [ ] **DTK-REL-GAP-NPM-BUILD** Add `"build": "tsc -p tsconfig.json"` script to each TypeScript `package.json`
- [ ] **DTK-REL-GAP-NPM-BUILD** Update `"exports"` in each `package.json` to `"./dist/index.js"` (default) and `"./dist/index.d.ts"` (types)
- [ ] **DTK-REL-GAP-NPM-BUILD** Add `"files": ["dist/", "README.md", "LICENSE"]` to each `package.json`
- [ ] **DTK-REL-GAP-NPMRC** Create `.npmrc` at repo root with `@deploy-toolkit:registry=https://registry.npmjs.org/` and `provenance=true`

### Phase 3 — Maven/Gradle Publish Setup

- [ ] **DTK-REL-MAVEN-CENTRAL** Add `id("org.jetbrains.dokka") version "1.9.20"` plugin to `build.gradle.kts`
- [ ] **DTK-REL-MAVEN-CENTRAL** Add `signing` plugin and `useInMemoryPgpKeys(signingKey, signingPassword)` block
- [ ] **DTK-REL-MAVEN-CENTRAL** Add `java { withSourcesJar(); withJavadocJar() }`
- [ ] **DTK-REL-MAVEN-CENTRAL** Add complete `publications { create<MavenPublication>("mavenJava") { ... } }` block with POM metadata (name, description, URL, license, developer, SCM)
- [ ] **DTK-REL-MAVEN-CENTRAL** Add Sonatype staging repository in `repositories {}` using `SONATYPE_USERNAME`/`SONATYPE_PASSWORD` env vars
- [ ] **DTK-REL-MAVEN-CENTRAL** Add `io.github.gradle-nexus.publish-plugin` for automated staging close and release
- [ ] **DTK-REL-GAP-GRADLE-STAMP** Add `stamp_gradle` to `tools/deploy-stamp/src/main.rs` to handle `version = "…"` in `build.gradle.kts` (short-term: CI sed workaround targeting only that known-safe pattern)

### Phase 4 — Scripts and Verification

- [ ] **DTK-REL-GAP-VERSION-VERIFY-SCRIPT** Create `scripts/verify-versions.sh` that accepts a version argument and asserts all five manifest types agree
- [ ] Run `deploy-stamp --tag v9.9.9 --root . --dry-run` manually and confirm output covers all file types
- [ ] Run dry-run publishes for all five registries locally and resolve any errors

### Phase 5 — GitHub Secrets and Environment (one-time manual setup)

- [ ] Create `CARGO_REGISTRY_TOKEN` in GitHub repository secrets
- [ ] Create `NPM_TOKEN` in GitHub repository secrets
- [ ] Create `NUGET_API_KEY` in GitHub repository secrets
- [ ] Create `DART_PUB_TOKEN` in GitHub repository secrets
- [ ] Create `SONATYPE_USERNAME` in GitHub repository secrets
- [ ] Create `SONATYPE_PASSWORD` in GitHub repository secrets
- [ ] Create `GPG_SIGNING_KEY` (ASCII-armored) in GitHub repository secrets
- [ ] Create `GPG_SIGNING_PASSWORD` in GitHub repository secrets
- [ ] Create `publish_token` (GitHub PAT with `contents:write` on tap/bucket repos) if Homebrew/Scoop publishing is needed
- [ ] **DTK-REL-WORKFLOW-ENV** Create `release` GitHub environment with required reviewer and tag branch restriction matching `v*.*.*`

### Phase 6 — Release Workflow

- [ ] **DTK-REL-GAP-RELEASE-WORKFLOW** Create `.github/workflows/release.yml` with trigger on `push: tags: ['v*.*.*', 'v*.*.*-*']`
- [ ] Add `stamp` job: checkout, run `deploy-stamp --tag $TAG --root .`, run `scripts/verify-versions.sh $VERSION`
- [ ] Add `ci-gate` job: `make ci`
- [ ] Add `dry-run-crates` job: all five `cargo publish --dry-run` calls sequentially in dependency order
- [ ] Add `dry-run-npm` job: all five `pnpm publish --dry-run` calls
- [ ] Add `dry-run-nuget` job: `dotnet pack` for both projects (pack is the NuGet dry-run equivalent)
- [ ] Add `dry-run-dart` job: `dart pub publish --dry-run`
- [ ] Add `dry-run-maven` job: `./gradlew publishToMavenLocal` (validates publication config without uploading)
- [ ] Add `publish-manifest` → `publish-cli` + `publish-host` → `publish-zed` + `publish-stamp` crates jobs with `sleep 30` between dependent publishes
- [ ] Add `publish-npm-core` → `publish-npm-vscode` + `publish-npm-node` + `publish-npm-validate-manifest` + `publish-npm-cli` jobs
- [ ] Add `publish-nuget-library` → `publish-nuget-tool` jobs
- [ ] Add `publish-dart` job
- [ ] Add `publish-maven` job
- [ ] Add `build-binaries` matrix job (5 platforms) for `deploy-stamp` binary using `release-binary-multiplatform.yml` pattern
- [ ] Add `release-assets` job: extract CHANGELOG section, create GitHub Release with `softprops/action-gh-release@v2`, attach binary archives
- [ ] Add `post-release-summary` job that prints all registry URLs for the published version
- [ ] Set `environment: release` on all `publish-*` jobs
- [ ] Set `concurrency: cancel-in-progress: false` at workflow level

### Phase 7 — First Release (v0.1.0)

- [ ] Confirm `coverage-thresholds.json` threshold is appropriate
- [ ] Confirm `make ci` passes on `main`
- [ ] Write `## [0.1.0] - YYYY-MM-DD` entry in `CHANGELOG.md`
- [ ] Run `deploy-stamp --tag v0.1.0 --root . --dry-run` and verify all files shown
- [ ] Run `deploy-stamp --tag v0.1.0 --root .` and confirm all stamped
- [ ] Run `scripts/verify-versions.sh 0.1.0` — must exit 0
- [ ] Run all dry-run publishes locally
- [ ] Commit stamped files and CHANGELOG on branch `chore/release-v0.1.0`
- [ ] Open PR, get review, merge to `main`
- [ ] Push annotated tag: `git tag -a v0.1.0 -m "Release v0.1.0" && git push origin v0.1.0`
- [ ] Monitor `release.yml` workflow run
- [ ] Verify packages visible on crates.io, npm, NuGet, pub.dev, Maven Central
- [ ] Verify GitHub Release has binary artifacts and correct CHANGELOG notes
- [ ] Ratchet `coverage-thresholds.json` to the measured coverage value
- [ ] Open follow-up PR bumping workspace version to `0.2.0-dev`
