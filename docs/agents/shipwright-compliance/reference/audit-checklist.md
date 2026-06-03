# Shipwright Audit Checklist

The full conformity audit. Work top to bottom. For each item: check → record `PASS` / `FAIL` / `N/A` /
`UNVERIFIABLE` → cite the spec ID. Skip sections that are N/A for the detected shape and say why.
Collect everything, then emit the report once (format at the bottom).

## Contents

1. Manifest conformity — `[SWR-VERSION-MANIFEST]`
2. Binary version contract — `[SWR-VERSION-*]`
3. Version stamping — `[SWR-VERSION-BUILD-STAMPING]`
4. Client library adoption — `[SWR-VERSION-BINDINGS]`, `[SWR-ARCH-LIBRARIES]`
5. Release workflow — `[SWR-REL-WORKFLOW]`
6. GitHub Release — `[SWR-REL-GITHUB]`
7. Homebrew tap — `[SWR-REL]` + brew template
8. Scoop bucket — `[SWR-REL]` + scoop template
9. Language-registry publishing — `[SWR-REL-CRATES/NPM/NUGET/DART/MAVEN]`
10. IDE extension deployment — `[SWR-IDE-*]`
11. VSIX build pipeline — `[SWR-VSIX-*]`
12. Binary signing / notarization — `[SWR-SIGN-*]`
13. Acceptance gates in CI — `[SWR-GATE-*]`

---

## 1. Manifest conformity — `[SWR-VERSION-MANIFEST]`

1. Does `shipwright.json` exist at the repo/package root (and at the extension root for IDE packages)?
2. Does it validate against the schema? Run `npx @nimblesite/shipwright-validate-manifest shipwright.json`
   (or the repo's vendored `tools/validate-manifest`). If no validator is reachable, mark UNVERIFIABLE.
3. Does every component have `id`, `kind`, `language`, `binaryName`, `expectedVersion`, `platforms`,
   `sources`, and `required`?
4. Are platform ids from the canonical set only: `darwin-arm64`, `darwin-x64`, `linux-x64`,
   `linux-arm64`, `win32-x64`, `win32-arm64`, `all`? `[SWR-VSIX-TARGETS]`.
5. Is the manifest the single source of truth — does everything that gets bundled/released appear as a
   component, and does nothing get bundled that is not declared? `[SWR-VERSION-MANIFEST]`.

## 2. Binary version contract — `[SWR-VERSION-*]`

For every executable component declared (or inferred from build files):

1. `<binaryName> --version` exits `0`, completes < 1500 ms, does not start the real runtime or touch
   the network, and prints exactly `<binaryName> <version>` as the first stdout line. `[SWR-VERSION-CLI-OUTPUT]`.
2. `<binaryName> --version --json` emits JSON conforming to `version-manifest.schema.json`
   (`manifestVersion`, `name`, `version`, `kind`, `language`). `[SWR-VERSION-JSON-OUTPUT]`.
3. LSP servers set `InitializeResult.serverInfo` `{name, version}` to the same version. `[SWR-VERSION-HANDSHAKE]`.
4. MCP servers set `serverInfo.version` from `package.json`, not a hard-coded string. `[SWR-VERSION-HANDSHAKE]`.
5. Tests exist for `--version` exit/format, protocol handshake, mismatch error, and bundled-start. `[SWR-VERSION-TEST-REQ]`.

## 3. Version stamping — `[SWR-VERSION-BUILD-STAMPING]`

1. Are ALL source version fields the placeholder `0.0.0-dev` — `Cargo.toml`, `package.json`, `*.csproj`,
   `pubspec.yaml`, `shipwright.json` product + every `expectedVersion`? A hard-coded release version is FAIL.
2. Is stamping a first-class script/build target that accepts an arbitrary version (so tests can stamp)?
3. Does it use structured parsers (not `sed`) for JSON/TOML/YAML/XML?
4. Does the tag-triggered release stamp in the runner working tree only, and NOT commit/push refs after the tag?
5. Does stamping update *every* deployed version carrier (manifests, lockfiles, `shipwright.json`, each `expectedVersion`)?

## 4. Client library adoption — `[SWR-VERSION-BINDINGS]`, `[SWR-ARCH-LIBRARIES]`

For each language present, is the shipwright library wired (not a bespoke per-product parser)?

| Language | Library | Provides |
| --- | --- | --- |
| Rust | `shipwright` | `--version` text/JSON from `CARGO_PKG_*` |
| Rust (host) | `shipwright-host` / `shipwright-zed` | pure resolver, injected probe |
| TS (VS Code) | `@nimblesite/shipwright-vscode` + `@nimblesite/shipwright-core` | manifest load + resolve cascade |
| Node/MCP | `@nimblesite/shipwright-mcp` | `serverInfo.version` from `package.json` |
| .NET | `Shipwright` | `--version` from assembly metadata |
| Dart | `shipwright` | resolver + `--version` helpers |

FAIL any binary that hand-rolls `--version` or any host that reimplements path joining / PATH lookup
instead of using `@nimblesite/shipwright-core` path helpers. `[SWR-ARCH-LIBRARIES]`.

## 5. Release workflow — `[SWR-REL-WORKFLOW]`

1. Is there a `.github/workflows/release.yml` triggered on `v[0-9]+.[0-9]+.[0-9]+` tags (and `-*` prereleases)?
2. Does it stamp the version from the tag **before** build/verify/package? `[SWR-VERSION-BUILD-STAMPING]`.
3. Does a CI gate (lint+test+build) run before any publish step?
4. Does it run on a protected `release` environment / use least-privilege `permissions:`?
5. Are publish steps idempotent (skip-if-already-published) so a re-run is safe?

## 6. GitHub Release — `[SWR-REL-GITHUB]`

1. Does the build run per platform (matrix with `fail-fast: false`)?
2. Is each binary verified (`<binaryName> --version` equals the stamped version) before packaging?
3. Is each platform archived (`.tar.gz` on Unix, `.zip` on Windows) **with a `.sha256` sidecar**?
4. Are all archives + checksums uploaded to the `v{version}` GitHub Release
   (e.g. `softprops/action-gh-release@v2`, `permissions: contents: write`)?

## 7. Homebrew tap — brew template

1. Is there a job that publishes a formula to the tap repo on release?
2. Does the formula carry `url` (the GitHub Release asset), `version`, `sha256`, and a `--version` test?
3. Does the `sha256` come from the build's checksum sidecar (not recomputed ad hoc)?
4. Is the tap push authenticated with a dedicated `tap_token` secret (never `GITHUB_TOKEN` across repos)?

## 8. Scoop bucket — scoop template

1. Is there a job that writes a Scoop manifest (`version`, `architecture.64bit.url`, `hash`, `bin`) to the bucket repo?
2. Is the manifest written with a real JSON serializer (no string-concatenated JSON)?
3. Is the bucket push authenticated with a dedicated `bucket_token` secret?

## 9. Language-registry publishing — `[SWR-REL-*]`

Only for repos that publish libraries. Check each ecosystem present:

- crates.io: correct publish order (deps first), `CARGO_REGISTRY_TOKEN`, index-wait between dependents. `[SWR-REL-CRATES]`.
- npm: OIDC trusted publishing (`--provenance`, `id-token: write`) — no `NPM_TOKEN`. `[SWR-REL-NPM]`.
- NuGet: `dotnet nuget push --skip-duplicate`, `NUGET_API_KEY`. `[SWR-REL-NUGET]`.
- pub.dev: `dart pub publish --force` with `DART_PUB_TOKEN`. `[SWR-REL-DART]`.
- Maven Central: Sonatype + GPG signing. `[SWR-REL-MAVEN]`.

## 10. IDE extension deployment — `[SWR-IDE-*]` (skip if no extension)

1. Does the extension load `shipwright.json` and validate every required component before reporting ready? `[SWR-IDE-STARTUP]`.
2. Resolution order: per-component path → binary dir → documented env override → **bundled**. No PATH /
   package-manager startup fallback. `[SWR-IDE-RESOLUTION]`.
3. Does it use `@nimblesite/shipwright-vscode` (VS Code) / `shipwright-zed` (Zed) — not custom resolver code?
4. Startup errors include product+ext version, component id, expected vs found version, source path, next action. `[SWR-IDE-ERROR]`.
5. Extension tests are isolated: binaries staged in the bundle, override env cleared, product binaries
   removed from PATH, resolver source asserted `bundled`. Never point at `target/release`/Homebrew/Scoop. `[SWR-IDE-TEST-ISOLATION]`.
6. .NET sidecars: `ms-dotnettools.vscode-dotnet-runtime` in `extensionDependencies`; activation calls
   `dotnet.findPath` → `dotnet.acquire`; `DOTNET_ROOT` set; no crash on missing .NET. `[SWR-IDE-DOTNET-RUNTIME]`.

## 11. VSIX build pipeline — `[SWR-VSIX-*]` (skip if no VS Code extension)

1. `engines.vscode` is `^1.99.0` or later. `[SWR-VSIX-PACKAGE]`.
2. Binaries staged under `bin/<vsceTarget>/<binaryName><exe>`; platform-agnostic under `bin/all/`. `[SWR-VSIX-LAYOUT]`.
3. `.vscodeignore` excludes every other platform dir (Pattern A npm-whitelist or Pattern B manual). `[SWR-VSIX-LAYOUT]`.
4. Built `npx vsce package --target <vsceTarget>` — one VSIX per target, never a fat native VSIX. `[SWR-VSIX-PACKAGE]`.
5. CI matrix: Node `22.x`, `fail-fast: false`, `npm_config_arch` per leg, all 6 targets. `[SWR-VSIX-CI-MATRIX]`.
6. Package contents verified after `vsce package` — correct binary present, no foreign bins, no
   placeholders, no `out/`/`src/`/unbundled `node_modules/`, no caches. `[SWR-VSIX-VERIFY]`.
7. Publish job runs on tag only, after all builds, single atomic `vsce publish`, `VSCE_PAT` secret. `[SWR-VSIX-PUBLISH]`.

## 12. Binary signing / notarization — `[SWR-SIGN-*]` (skip if no darwin binaries)

1. darwin build legs sign with `codesign --options runtime --timestamp` before upload/staging. `[SWR-SIGN-APPLE-WORKFLOW]`.
2. Signed binary submitted via `xcrun notarytool submit --wait` and stapled (`xcrun stapler staple`).
3. App Store Connect API key secrets used (not Apple ID + password).
4. darwin VSIX legs sign the embedded binary **before** the `SWR-VSIX-STAGING` copy. `[SWR-SIGN-APPLE-INTEGRATION]`.

## 13. Acceptance gates in CI — `[SWR-GATE-*]`

1. CI runs manifest validation on `shipwright.json`. `[SWR-GATE-CI]`.
2. CI runs `<binary> --version` and `<binary> --version --json` for every component. `[SWR-GATE-VERIFY-BINARIES]`.
3. For IDE extensions, CI verifies the produced package contains the expected manifest-declared binary. `[SWR-GATE-VERIFY-EXT-PKG]`.
4. CI fails on manifest / binary / protocol / package drift.

---

## Report format

Emit once, after the whole audit:

```
## Shipwright Conformity Audit — <repo name>

Detected shape: <one line>

### PASS
- [SWR-XYZ] <what passes>

### FAIL
- [SWR-XYZ] <what fails> — <found vs required>

### N/A
- [SWR-XYZ] <reason skipped>

### UNVERIFIABLE
- [SWR-XYZ] <what could not be checked and why>

### Summary
- Pass: N  Fail: N  N/A: N  Unverifiable: N
- Conformity: FULL (0 FAIL) / PARTIAL (FAILs outside §1–4,10–11) / NON-CONFORMANT (FAIL in §1–4, 10, or 11)

### Highest-priority fixes
1. [SWR-XYZ] <action> — spec URL
```
