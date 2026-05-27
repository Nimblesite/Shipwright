# Shipwright Compatibility Matrix

```
Spec prefix: SWR-COMPAT-*
Status: Draft
```

This spec describes which checks each host must perform and what the platform coverage requirements are.

## [SWR-COMPAT-HOST-REQ] Host Requirements

| Host | Can spawn `--version` | Can bundle binaries | Required verification path |
| --- | --- | --- | --- |
| VS Code | Yes | Yes, under `bin/<platform>` for native binaries or `bin/all` for platform-agnostic tools. | Resolve user setting, env, bundled binary, package manager, and PATH; block activation on mismatches. |
| JetBrains | Yes | Generally no for per-platform marketplace artifacts; prefer external/package manager binaries. | Resolve user setting, env, package manager, dotnet tool, and PATH; block LSP startup on mismatches. |
| Zed | Not before extension startup. | No native binary bundling in the WASM extension. | Verify through LSP initialize metadata or cached download metadata before ready state. |
| CLI | Yes | Not applicable. | Verify `--version` and `--version --json` against release tag and manifest version. |
| Package manager | No runtime spawn during publishing. | Not applicable. | Verify formula/manifest version, asset URL, and sha256 against release artifacts. |

## [SWR-COMPAT-PLATFORMS] Platform Coverage

The first release gate covers these platform ids (defined in `schemas/platforms.json`):

- `darwin-arm64`
- `darwin-x64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`
- `win32-arm64`
- `all` (platform-agnostic)

The platform fixture at `fixtures/platforms/platform-ids.json` must stay aligned with `schemas/platforms.json`.

## [SWR-COMPAT-MANIFEST-VERSION] Manifest Versioning

1. The manifest schema is versioned via `manifestVersion`.
2. Host libraries must reject incompatible newer manifest schemas.
3. Host libraries may warn on older compatible schemas.
4. Component kinds must be extensible so future products can add new host types without changing existing fields.
