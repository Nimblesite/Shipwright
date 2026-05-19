# shipwright-version-stamp

Cross-platform version-stamping CLI for Shipwright monorepos.

Accepts a single version tag and rewrites every manifest file in the repository — `Cargo.toml`, `package.json`, `*.csproj`, and `pubspec.yaml` — so all packages stay in sync with a single command.

## Usage

```bash
# Dry run — shows what would change, writes nothing
shipwright-version-stamp --tag v1.2.3 --root . --dry-run

# Apply the stamp
shipwright-version-stamp --tag v1.2.3 --root .
```

## Installation

```bash
cargo install shipwright-version-stamp
```

## Supported manifest types

| File | Field updated |
|---|---|
| `Cargo.toml` (`[workspace.package]`) | `version` |
| `package.json` | `version` |
| `*.csproj` | `<Version>` |
| `pubspec.yaml` | `version` |

`build.gradle.kts` support is planned.

## License

Licensed under either of [MIT](../../LICENSE) or [Apache-2.0](../../LICENSE) at your option.

Copyright (c) 2026 NIMBLESITE PTY LTD
