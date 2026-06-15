---
name: upgrade-packages
description: Upgrade all dependencies/packages to their latest versions for the detected language(s). Use when the user says "upgrade packages", "update dependencies", "bump versions", "update packages", or "upgrade deps".
argument-hint: "[--check-only] [--major] [package-name]"
---
<!-- agent-pmo:b636503 -->

# Upgrade Packages

Upgrade Shipwright dependencies to the latest compatible versions, or latest major versions when `--major` is passed.

## Arguments

- `--check-only` — List outdated packages without upgrading.
- `--major` — Include breaking major version bumps.
- Any other argument is a specific package name to upgrade.

## Step 1 — Detect manifests

Process every ecosystem that applies:

| Manifest | Ecosystem | Manager |
|---|---|---|
| `Cargo.toml`, `crates/*/Cargo.toml`, `tools/shipwright-version-stamp/Cargo.toml` | Rust | cargo |
| root `package.json`, `pnpm-workspace.yaml`, `clients/ts/packages/*/package.json` | TypeScript workspace | pnpm |
| `tools/validate-manifest/package.json` | Node package | npm package lock exists |
| `extensions/shipwright-tools/package.json` | VS Code extension | npm package lock exists |
| `website/package.json` | Eleventy site | standalone pnpm lock; always use `--ignore-workspace` |
| `clients/dart/shipwright/pubspec.yaml` | Dart | dart pub |
| `clients/dotnet/**/*.csproj` | .NET | NuGet / dotnet |
| `clients/kotlin/shipwright-intellij/build.gradle.kts` | Kotlin/Gradle | checked-in Gradle wrapper |

## Step 2 — List outdated packages first

Run the relevant checks before upgrading:

```bash
cargo update --dry-run
pnpm outdated
cd tools/validate-manifest && npm outdated
cd extensions/shipwright-tools && npm outdated
cd website && pnpm outdated --ignore-workspace
cd clients/dart/shipwright && dart pub outdated
dotnet list clients/dotnet/Shipwright/Shipwright.csproj package --outdated
dotnet list clients/dotnet/Shipwright.Tests/Shipwright.Tests.csproj package --outdated
cd clients/kotlin/shipwright-intellij && ./gradlew dependencyUpdates
```

If `--check-only` was passed, stop here and report the outdated list.

## Step 3 — Read official docs

Before running upgrade commands, fetch and read the relevant official docs:

- Cargo update: https://doc.rust-lang.org/cargo/commands/cargo-update.html
- pnpm update: https://pnpm.io/cli/update
- npm update: https://docs.npmjs.com/cli/v10/commands/npm-update
- Dart pub upgrade: https://dart.dev/tools/pub/cmd/pub-upgrade
- dotnet package commands: https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-add-package
- Gradle dependency management: https://docs.gradle.org/current/userguide/dependency_management.html

## Step 4 — Upgrade

Use the package manager, never edit lockfiles manually.

### Rust

```bash
cargo update
```

For `--major`, edit `[workspace.dependencies]` version requirements when necessary, then run `cargo update`.

### pnpm workspace

```bash
pnpm update
```

For `--major`:

```bash
pnpm update --latest
```

### npm packages

```bash
cd tools/validate-manifest && npm update
cd extensions/shipwright-tools && npm update
```

### Website

```bash
cd website
pnpm update --ignore-workspace
```

The website must keep `@11ty/eleventy` and `eleventy-plugin-techdoc` current.

### Dart

```bash
cd clients/dart/shipwright
dart pub upgrade
```

For `--major`:

```bash
dart pub upgrade --major-versions
```

### .NET

There is no single upgrade-all command. For each outdated package:

```bash
dotnet add <project.csproj> package <PackageName>
```

### Kotlin / Gradle

Edit versions in `build.gradle.kts` or version catalogs, then verify:

```bash
cd clients/kotlin/shipwright-intellij
./gradlew dependencies
```

## Step 5 — Verify

Run:

```bash
make ci
```

If it fails, read the failure, check release notes for the upgraded package, fix the breaking change, and rerun. If stuck after three attempts on the same failure, report the package and exact error.

## Step 6 — Report

Include:

- Packages upgraded, old -> new.
- Packages skipped and why.
- Build/test result.
- Breaking changes fixed.
- Packages that could not be upgraded.

## Rules

- Always list outdated packages first.
- Always read the official docs for the package manager.
- Never remove packages unless explicitly deprecated and replaced.
- Never downgrade unless rolling back a broken upgrade.
- Never edit lockfiles manually.
- Commit nothing.

## Success criteria

- Dependencies are upgraded as requested.
- Build and tests pass.
- The user has a clear summary of changes.
