---
name: shipwright-audit
description: Audit any codebase for Shipwright conformity. Use when asked to "check Shipwright compliance", "audit for Shipwright", "verify Shipwright conformity", or "does this repo conform to Shipwright specs".
argument-hint: [path-to-repo]
disable-model-invocation: true
allowed-tools: Read Bash Grep Glob
---

# Shipwright Conformity Audit

Audit the repository at `$ARGUMENTS` (or the current working directory if no argument given) for conformity with the Shipwright deployment contract.

**You are a process wrapper around the specs. Do not invent rules. Every finding MUST cite a spec ID from the Shipwright repo.**

Shipwright specs live at:
`https://github.com/MelbourneDeveloper/deployment_toolkit/tree/main/docs/specs/`

Individual spec files (reference these URLs, not file paths):
- Binary version contract: `https://github.com/MelbourneDeveloper/deployment_toolkit/blob/main/docs/specs/binary-version-contract.md`
- IDE extension deployment: `https://github.com/MelbourneDeveloper/deployment_toolkit/blob/main/docs/specs/ide-extension-deployment.md`
- VSIX platform bundling: `https://github.com/MelbourneDeveloper/deployment_toolkit/blob/main/docs/specs/vsix-platform-bundling.md`
- Binary signing and notarization: `https://github.com/MelbourneDeveloper/deployment_toolkit/blob/main/docs/specs/binary-signing-notarization.md`
- Compatibility matrix: `https://github.com/MelbourneDeveloper/deployment_toolkit/blob/main/docs/specs/compatibility-matrix.md`
- Acceptance gates: `https://github.com/MelbourneDeveloper/deployment_toolkit/blob/main/docs/specs/acceptance-gates.md`
- Library architecture: `https://github.com/MelbourneDeveloper/deployment_toolkit/blob/main/docs/specs/library-architecture.md`

**Never cite a local file path. Always cite the GitHub URL above plus the spec ID (e.g. `[SWR-VSIX-PACKAGE]`).**

---

## Audit Process

Work through each section below in order. For each item: check → record finding (PASS / FAIL / N/A) → cite the spec ID. At the end, emit the structured report.

### 1. Detect Repo Shape

Before auditing anything, determine what kind of product this is:

- Does it have `shipwright.json`? If yes, read it — it declares `components[]`, `platforms`, and `language` per `[SWR-VERSION-CONTRACT]`.
- Languages present: look for `Cargo.toml`, `package.json`, `pubspec.yaml`, `*.csproj`, `build.gradle.kts`.
- IDE extensions: look for `.vsix`, `vsce`, `package.json` with `engines.vscode`.
- CI: look for `.github/workflows/`.

Skip sections that are N/A for the detected shape. State why.

### 2. Manifest Conformity — `[SWR-VERSION-CONTRACT]`

1. Does `shipwright.json` exist at the repo or package root?
2. Does it validate against the Shipwright schema? Run:
   ```bash
   node /path/to/shipwright/tools/validate-manifest/index.mjs shipwright.json
   ```
   If the Shipwright repo path is unknown, note it as unverifiable and flag it.
3. Does every executable component in `components[]` have a `binaryName`, `expectedVersion`, `language`, and `platforms`?
4. Are platform IDs from the canonical set (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `win32-x64`, `win32-arm64`, `all`)? See `[SWR-VSIX-TARGETS]`.

### 3. Binary Version Contract — `[SWR-VERSION-CONTRACT]`

For every binary component declared in `shipwright.json` (or inferred from build files):

1. Does the binary support `--version`? Output must be exactly `<binaryName> <version>` with no trailing content. See `[SWR-VERSION-PLAIN]`.
2. Does it support `--version --json`? Output must be valid JSON conforming to `schemas/version-manifest.schema.json`. See `[SWR-VERSION-JSON]`.
3. For LSP servers: does `InitializeResult.serverInfo.version` match the binary version? See `[SWR-VERSION-LSP]`.
4. For MCP servers: does `serverInfo.version` match `package.json` version? See `[SWR-VERSION-MCP]`.
5. Are there tests for all of the above? Flag any missing test.

### 4. IDE Extension Deployment — `[SWR-IDE-*]`

Skip entirely if no IDE extension is present.

#### VS Code

1. Does `package.json` have `engines.vscode: "^1.99.0"` or later? See `[SWR-VSIX-PACKAGE]`.
2. Are native binaries staged under `bin/<vsceTarget>/<binaryName><exe>`? See `[SWR-VSIX-LAYOUT]`.
3. Are platform-agnostic binaries under `bin/all/<binaryName>`? See `[SWR-VSIX-LAYOUT]`.
4. Does `.vscodeignore` exclude all other platform directories and follow the correct pattern (Pattern A or B)? See `[SWR-VSIX-LAYOUT]`.
5. Does the extension use `@nimblesite/shipwright-vscode` for binary resolution? See `[SWR-IDE-RESOLUTION]`.
6. Does resolution order follow: user setting → env → bundled → package manager → PATH? See `[SWR-IDE-RESOLUTION-ORDER]`.
7. Does the extension surface mismatch errors with expected version, found version, and selected path? See `[SWR-IDE-ERROR]`.
8. For `.NET` sidecar components:
   - Is `ms-dotnettools.vscode-dotnet-runtime` in `extensionDependencies`? See `[SWR-IDE-DOTNET-RUNTIME]`.
   - Does activation call `dotnet.findPath` then `dotnet.acquire`? See `[SWR-IDE-DOTNET-RUNTIME]`.
   - Is `DOTNET_ROOT` set in the env passed to the host? See `[SWR-IDE-DOTNET-RUNTIME]`.
   - Does activation fail gracefully (no crash) when .NET is missing? See `[SWR-IDE-DOTNET-RUNTIME]`.
9. Are extension tests isolated (bundled binaries, no PATH, no `target/release`)? See `[SWR-IDE-TEST-ISOLATION]`.

#### JetBrains

1. Does the plugin load `shipwright.json` from plugin root?
2. Does resolution check user setting → env → package manager → PATH before LSP startup?
3. Are failures reported through notifications/Event Log with expected and found versions? See `[SWR-IDE-ERROR]`.

#### Zed

1. Is `shipwright-zed` used?
2. If subprocess preflight is unavailable, is `lsp-initialize` declared?
3. Is the server version verified from initialize metadata? See `[SWR-VERSION-LSP]`.

### 5. VSIX Build Pipeline — `[SWR-VSIX-*]`

Skip if no VS Code extension.

1. Is VSIX built with `npx vsce package --target <vsceTarget>`? See `[SWR-VSIX-PACKAGE]`.
2. Does CI use a matrix with `fail-fast: false` covering all 6 platform targets? See `[SWR-VSIX-CI-MATRIX]`.
3. Is Node version `22.x` in CI? See `[SWR-VSIX-CI-MATRIX]`.
4. Is `npm_config_arch` set per matrix leg during `npm install`? See `[SWR-VSIX-CI-MATRIX]`.
5. Does the publish job run on tag only, after all build jobs succeed, in a single atomic step? See `[SWR-VSIX-PUBLISH]`.
6. Does CI verify binary presence with `unzip -l` after packaging? See `[SWR-VSIX-VERIFY]`.
7. Is the reusable workflow `publish-vsix-per-platform.yml` from `templates/gh-actions/` used (or a faithful equivalent)? See `[SWR-VSIX-CI-MATRIX]`.

### 6. Binary Signing and Notarization — `[SWR-SIGN-*]`

1. For `darwin-*` build legs: is the binary signed with `codesign --options runtime --timestamp` before upload? See `[SWR-SIGN-APPLE-WORKFLOW]`.
2. Is the signed binary submitted to Apple's notary service with `xcrun notarytool submit --wait`? See `[SWR-SIGN-APPLE-WORKFLOW]`.
3. Is the notarization ticket stapled with `xcrun stapler staple`? See `[SWR-SIGN-APPLE-WORKFLOW]`.
4. Are App Store Connect API key secrets used (not Apple ID + password)? See `[SWR-SIGN-APPLE-CI]`.
5. Are the required secrets present in CI config: `APPLE_DEVELOPER_ID_CERT_P12`, `NOTARIZATION_API_KEY_P8`, `NOTARIZATION_KEY_ID`, `NOTARIZATION_ISSUER_ID`? See `[SWR-SIGN-APPLE-CI]`.
6. For darwin VSIX build legs: is the embedded binary signed before the `SWR-VSIX-STAGING` copy step? See `[SWR-SIGN-APPLE-INTEGRATION]`.

### 7. Acceptance Gates — `[SWR-GATE-*]`

1. Does CI run manifest validation (`node validate-manifest/index.mjs shipwright.json`)? See `[SWR-GATE-verify-binaries]`.
2. Does CI run `<binary> --version` and `<binary> --version --json` for every component? See `[SWR-GATE-verify-binaries]`.
3. For IDE extensions: does CI verify the produced package artifact contains the expected binary? See `[SWR-GATE-verify-extension-package]`.
4. Does CI fail on manifest, binary, protocol, or package drift? See `[SWR-GATE-*]`.

### 8. Fixture Sync — `[SWR-VERSION-CONTRACT]`

1. Does the Shipwright repo have a matching fixture at `fixtures/manifests/<product>.json`?
2. Are version output fixtures at `fixtures/version-outputs/<language>/<binary>.txt` and `.json`?
   (Note these as "unverifiable without Shipwright repo access" if the repo is not present.)

---

## Report Format

Emit the report in this exact structure. Do not summarise findings mid-audit — collect everything first, then emit once.

```
## Shipwright Conformity Audit — <repo name>

Detected shape: <e.g. "Rust CLI + VS Code extension (darwin-arm64, linux-x64, win32-x64)">

### PASS
- [SWR-XYZ] <one-line description of what passes>
...

### FAIL
- [SWR-XYZ] <one-line description of what fails> — <what was found vs what is required>
...

### N/A
- [SWR-XYZ] <reason skipped>
...

### UNVERIFIABLE
- [SWR-XYZ] <what could not be checked and why>
...

### Summary
- Total checks: N
- Pass: N  Fail: N  N/A: N  Unverifiable: N
- Conformity: <FULL / PARTIAL / NON-CONFORMANT>

### Recommended Actions
1. (highest priority FAIL) — cite spec ID and URL
2. ...
```

Conformity levels:
- **FULL** — zero FAILs (UNVERIFIABLEs do not count against conformity).
- **PARTIAL** — one or more FAILs, none in sections 2–4 (manifest, version contract, IDE deployment).
- **NON-CONFORMANT** — one or more FAILs in sections 2, 3, or 4.
