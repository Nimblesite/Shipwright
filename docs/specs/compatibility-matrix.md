# Deployment Toolkit Compatibility Matrix

Status: Draft

This spec describes which checks each host must perform for Nimblesite product manifests. Reusable host libraries stay generic, but these fixtures prove the current Nimblesite products can be represented by the contract.

## Host Requirements

| Host | Can spawn `--version` | Can bundle binaries | Required verification path |
| --- | --- | --- | --- |
| VS Code | Yes | Yes, under `bin/<platform>` for native binaries or `bin/all` for platform-agnostic tools. | Resolve user setting, env, bundled binary, package manager, and PATH; block activation on mismatches. |
| JetBrains | Yes | Generally no for per-platform marketplace artifacts; prefer external/package manager binaries. | Resolve user setting, env, package manager, dotnet tool, and PATH; block LSP startup on mismatches. |
| Zed | Not before extension startup. | No native binary bundling in the WASM extension. | Verify through LSP initialize metadata or cached download metadata before ready state. |
| CLI | Yes | Not applicable. | Verify `--version` and `--version --json` against release tag and manifest version. |
| Package manager | No runtime spawn during publishing. | Not applicable. | Verify formula/manifest version, asset URL, and sha256 against release artifacts. |

## Product Coverage

| Product | Fixture | Hosts covered |
| --- | --- | --- |
| Deslop | `fixtures/manifests/deslop.json` | VS Code, JetBrains, CLI |
| Basilisk | `fixtures/manifests/basilisk.json` | VS Code, Zed, CLI |
| Forge | `fixtures/manifests/forge.json` | VS Code, JetBrains, Zed |
| Too Many Cooks | `fixtures/manifests/too-many-cooks.json` | VS Code, package-manager path |
| dart_mutant | `fixtures/manifests/dart-mutant.json` | CLI |

## Platform Coverage

The platform fixture at `fixtures/platforms/platform-ids.json` must stay aligned with `schemas/platforms.json`. The first release gate covers `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`, and `all`.

## Tickets

- DTK-SPEC-COMPATIBILITY-BINDINGS: Generate language bindings from `schemas/compatibility-matrix.json` after the first host library lands.
