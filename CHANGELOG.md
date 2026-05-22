# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-05-23

### Added
- Initial published release of all `Shipwright` packages across crates.io, npm, NuGet, and pub.dev.
- `shipwright-manifest` (crates.io): Rust data types for the version-output contract and deployment manifest schema.
- `shipwright` (crates.io): Rust CLI + library for validating and inspecting manifests.
- `shipwright-host` (crates.io): Pure binary-resolution algorithm (no I/O; probe injected by caller).
- `shipwright-zed` (crates.io): Zed editor extension host integration.
- `shipwright-version-stamp` (crates.io): Cross-platform version-stamping CLI for `Cargo.toml`, `package.json`, `*.csproj`, and `pubspec.yaml`.
- `@nimblesite/shipwright-core` (npm): TypeScript core resolver and manifest helpers.
- `@nimblesite/shipwright-vscode` (npm): VS Code glue for reading `shipwright.json` and resolving components.
- `@nimblesite/shipwright-mcp` (npm): Node/MCP helpers for the Shipwright version contract.
- `@nimblesite/shipwright-validate-manifest` (npm): AJV-backed manifest validator CLI.
- `Shipwright` (NuGet): .NET library for binary resolution and manifest helpers.
- `shipwright` (pub.dev): Dart binary resolver and `--version` contract helpers.

### Notes
- No `v0.1.0` tag was pushed; the `0.1.0` prep landed in PR #6 but the first actually-published version is `v0.2.0`.

[Unreleased]: https://github.com/Nimblesite/Shipwright/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Nimblesite/Shipwright/releases/tag/v0.2.0
