# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-04-27

### Added
- Initial release of all `Shipwright` packages across crates.io, npm, NuGet, pub.dev, and Maven Central.
- `shipwright-manifest`: Rust data types for the version-output contract and deployment manifest schema.
- `shipwright-cli`: Rust CLI for validating and inspecting manifests.
- `shipwright-host`: Pure binary-resolution algorithm (no I/O; probe injected by caller).
- `shipwright-zed`: Zed editor extension host integration.
- `deploy-stamp`: Cross-platform version-stamping CLI (Cargo.toml, package.json, csproj, pubspec.yaml).
- `@shipwright/core`: TypeScript core resolver and manifest helpers.
- `@shipwright/vscode`: VS Code glue for reading `shipwright.json` and resolving components.
- `@shipwright/node`: Node/MCP helpers for the shipwright version contract.
- `@shipwright/validate-manifest`: AJV-backed manifest validator CLI.
- `shipwright`: Generic Shipwright CLI.
- `Shipwright`: .NET library for binary resolution and manifest helpers.
- `Shipwright.Tool`: .NET global tool wrapping the Shipwright library.
- `shipwright` (Dart): Binary resolver and `--version` contract helpers.

[Unreleased]: https://github.com/nimblesite/Shipwright/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nimblesite/Shipwright/releases/tag/v0.1.0
