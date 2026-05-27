# VSIX Platform-Specific Bundling Spec

```
Spec prefix: SWR-VSIX-*
Status: Draft
```

## [SWR-VSIX-PURPOSE] Purpose

This spec defines the canonical pipeline for building, staging, and publishing platform-specific VS Code VSIX packages that bundle native binaries. It complements [ide-extension-deployment.md](ide-extension-deployment.md) (which owns the runtime resolution algorithm and bundling layout rule) and [acceptance-gates.md](acceptance-gates.md) (which owns the `verify-extension-package` gate).

## [SWR-VSIX-REFS] External References

Agents working on VSIX bundling or the `publish-vsix-per-platform.yml` template MUST read these before writing any code or CI config. Every normative rule in this spec cites one of these sources.

- **AUTHORITATIVE** — Microsoft official platform-specific sample (CI workflow, `.vscodeignore`, runtime binary resolution): https://github.com/microsoft/vscode-platform-specific-sample/tree/main
  - CI workflow (exact source for matrix, Node version, publish job): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.github/workflows/ci.yml
  - `.vscodeignore` (exact source for node_modules whitelist pattern): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.vscodeignore
  - `extension.js` (exact source for runtime binary path resolution): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/extension.js
- **REFERENCE** — VS Code bundling guide: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- **Inspiration** — Rust Analyzer release workflow: https://github.com/rust-lang/rust-analyzer/blob/2024-06-11/.github/workflows/release.yaml#L105
- **RELATED** — Binary signing and notarization spec (mandatory for darwin-* binaries staged into VSIX): [binary-signing-notarization.md](binary-signing-notarization.md)

## [SWR-VSIX-TARGETS] Supported Platform Targets

The canonical Shipwright platform set maps directly to VS Code `vsceTarget` values defined in `schemas/platforms.json`.

| Shipwright platform id | vsceTarget | GitHub Actions runner | npm_config_arch |
|---|---|---|---|
| darwin-arm64 | darwin-arm64 | macos-15 | arm64 |
| darwin-x64 | darwin-x64 | macos-13 | x64 |
| linux-x64 | linux-x64 | ubuntu-latest | x64 |
| linux-arm64 | linux-arm64 | ubuntu-latest | arm64 |
| win32-x64 | win32-x64 | windows-latest | x64 |
| win32-arm64 | win32-arm64 | windows-latest | arm |

The `vsceTarget` field in `schemas/platforms.json` is the authoritative source. Additional vsce targets (`alpine-x64`, `alpine-arm64`, `linux-armhf`, `web`) are outside Shipwright's canonical set and MAY be added by downstream products when needed; they require a corresponding entry in `schemas/platforms.json`.

Platform-agnostic extensions (pure-Node components, `"platforms": ["all"]`) do not use a `vsceTarget` — see [SWR-VSIX-FAT].

## [SWR-VSIX-LAYOUT] VSIX Directory Layout

The VSIX package layout extends the rule in `SWR-IDE-*` with exact path requirements:

```text
extension-root/
  shipwright.json
  package.json
  extension.js              ← compiled extension entry point
  bin/
    darwin-arm64/
      product-lsp           ← vsceTarget as directory name
      product-mcp
    darwin-x64/
      product-lsp
    linux-x64/
      product-lsp
    linux-arm64/
      product-lsp
    win32-x64/
      product-lsp.exe       ← .exe suffix from platforms.json `exe` field
    win32-arm64/
      product-lsp.exe
    all/
      tmc-server            ← platform-agnostic binary (no .exe)
```

Rules:

- Directory names under `bin/` are the `vsceTarget` values from `schemas/platforms.json`, not Rust target triples.
- Windows binaries carry the `.exe` suffix. The `exe` field in `schemas/platforms.json` is authoritative.
- A platform-specific VSIX MUST contain binaries for its own target platform only; other platform directories MUST be excluded via `.vscodeignore`.
- `shipwright.json` MUST be at the extension root (not nested).

### `.vscodeignore` requirements

**Pattern A — npm-delivered binary** (the official Microsoft sample pattern):

Source: https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.vscodeignore

```
.vscode/**
.vscode-test/**
.gitignore
.yarnrc
vsc-extension-quickstart.md
**/jsconfig.json
**/*.map
**/.eslintrc.json
.github
build/**
node_modules
!node_modules/<your-platform-package>
```

The critical line is `!node_modules/<your-platform-package>` — this whitelists the specific npm package that carries the platform binary, while excluding all other `node_modules`. `npm install` with `npm_config_arch` downloads the correct platform binary into that package automatically.

**Pattern B — manually staged Rust binary**:

For Rust binaries built in CI and staged into `bin/<platform>/`:

```
.git/
.github/
src/
node_modules/
*.ts
tsconfig.json
bin/darwin-x64/
bin/linux-x64/
bin/linux-arm64/
bin/win32-x64/
bin/win32-arm64/
```

Exclude every platform directory except the one being packaged. The current platform directory is left out of `.vscodeignore` so it is included in the VSIX.

### Runtime binary resolution

**Pattern A** — resolve via the npm package's exported path (from the official sample's `extension.js`):

Source: https://github.com/microsoft/vscode-platform-specific-sample/blob/main/extension.js

```js
const { rgPath } = require('vscode-ripgrep');
const cp = require('child_process');
// rgPath is the absolute path to the platform-correct binary
const { stdout } = await execFile(rgPath, ['--version'], { encoding: 'utf8' });
```

The npm package resolves the correct platform binary path. The extension does not hardcode `bin/` paths.

**Pattern B** — resolve via `context.extensionPath` for manually staged binaries:

```ts
import * as path from 'path';
import * as os from 'os';
const platform = `${process.platform}-${os.arch()}`;  // e.g. darwin-arm64
const exe = process.platform === 'win32' ? '.exe' : '';
const binaryPath = path.join(context.extensionPath, 'bin', platform, `my-lsp${exe}`);
```

Shipwright's `activateShipwright()` abstracts this — it reads `shipwright.json` and resolves via the configured `bundlePath` template.

## [SWR-VSIX-PACKAGE] vsce Package Requirements

- Each VSIX MUST be built with: `npx vsce package --target <vsceTarget>`
- `package.json` `engines.vscode` MUST be `^1.99.0` or later. Platform-specific VSIX support was introduced in VS Code 1.61 / vsce 1.99.0; the minimum enforces correct Marketplace routing.
- The `npm_config_arch` environment variable MUST be set during `npm install` to match the target architecture. This ensures native npm modules compile for the correct arch.
- Output filename convention: `<extensionName>-<version>-<vsceTarget>.vsix` (e.g. `deslop-1.2.3-darwin-arm64.vsix`). The target suffix is mandatory when the artifact is renamed.
- Pre-release builds: append `--pre-release` to the `vsce package` command.
- Do NOT publish from a developer machine. The publish step is CI-only (see [SWR-VSIX-PUBLISH]).
- Native-binary extensions MUST NOT produce a single all-platform VSIX. One target-specific VSIX
  per `vsceTarget` is required.
- The release or test version MUST be stamped into the runner working tree before `vsce package`
  runs. See [SWR-VERSION-BUILD-STAMPING](binary-version-contract.md#swr-version-build-stamping).

## [SWR-VSIX-CI-MATRIX] GitHub Actions Matrix Strategy

The matrix shape follows the official Microsoft sample exactly. Source: https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.github/workflows/ci.yml

Key rules derived directly from that file:

- **Node version: `22.x`** — the sample uses `node-version: 22.x`. This is the required version. Do not use 20 or 24.
- **`platform` and `arch` are separate matrix fields** — the vsce target is constructed at runtime as `${{ matrix.platform }}-${{ matrix.arch }}` via a `pwsh` step writing to `$GITHUB_ENV`.
- **`npm_config_arch`** is set as an env var on the `npm install` step (not globally), matching the sample exactly.
- **`fail-fast: false`** is required. A single-platform failure must not cancel other platforms.

```yaml
# Derived from: https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.github/workflows/ci.yml
strategy:
  fail-fast: false
  matrix:
    include:
      - os: macos-latest
        platform: darwin
        arch: arm64
        npm_config_arch: arm64
      - os: macos-latest
        platform: darwin
        arch: x64
        npm_config_arch: x64
      - os: ubuntu-latest
        platform: linux
        arch: x64
        npm_config_arch: x64
      - os: ubuntu-latest
        platform: linux
        arch: arm64
        npm_config_arch: arm64
      - os: windows-latest
        platform: win32
        arch: x64
        npm_config_arch: x64
      - os: windows-latest
        platform: win32
        arch: arm64
        npm_config_arch: arm

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22.x          # Official MS sample: node-version: 22.x
  - run: npm install
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      npm_config_arch: ${{ matrix.npm_config_arch }}
  - shell: pwsh
    run: echo "target=${{ matrix.platform }}-${{ matrix.arch }}" >> $env:GITHUB_ENV
  - run: npx vsce package --target ${{ env.target }}
  - uses: actions/upload-artifact@v4
    with:
      name: ${{ env.target }}     # Artifact named darwin-arm64, win32-x64, etc — no vsix- prefix
      path: "*.vsix"
```

For Rust-binary extensions, add a binary build and staging step between `npm install` and `npx vsce package` — see [SWR-VSIX-STAGING].

## [SWR-VSIX-STAGING] Binary Staging Before Packaging

The CI step between building the binary and running `vsce package`:

```bash
# SWR-VSIX-STAGING
set -euo pipefail
exe=""
if [ "${{ runner.os }}" = "Windows" ]; then exe=".exe"; fi
mkdir -p "bin/${{ matrix.platform }}"
cp "target/release/${{ inputs.binary_name }}${exe}" "bin/${{ matrix.platform }}/"
```

Rules:

- The staging directory name is `${{ matrix.platform }}` (the Shipwright platform id / vsceTarget).
- The `exe` suffix is derived from `runner.os`, matching the `exe` field in `schemas/platforms.json`.
- For extensions with multiple binary components, repeat the `cp` step for each component.
- Staged binaries MUST appear in `package.json` `files` or be present in a directory that `.vscodeignore` does not exclude.
- The staging step MUST run after the binary build and before `npx vsce package`.
- **darwin-\* legs MUST sign the binary before staging.** See [SWR-SIGN-APPLE-INTEGRATION] in
  `binary-signing-notarization.md`. VS Code extensions are not subject to Gatekeeper, but the
  embedded binary is — Gatekeeper quarantines it on first execution. An unsigned embedded binary
  will be blocked by macOS.

## [SWR-VSIX-PUBLISH] Marketplace Publish Job

Copied verbatim from the official sample: https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.github/workflows/ci.yml

```yaml
publish:
  runs-on: ubuntu-latest
  needs: build
  if: success() && startsWith( github.ref, 'refs/tags/')
  steps:
    - uses: actions/download-artifact@v4
    - run: npx vsce publish --packagePath $(find . -iname *.vsix)
      env:
        VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

Rules:

- `if: success() && startsWith( github.ref, 'refs/tags/')` — exact condition from the sample. Only runs on version tags AND only if all build jobs succeeded.
- `actions/download-artifact@v4` with **no name** downloads all artifacts from the build matrix.
- `find . -iname *.vsix` — no quotes around the glob, exactly as in the sample.
- `VSCE_PAT` secret is required. Never log it.
- All platform packages are published in a single job. Split publishing creates race conditions on the Marketplace.
- Pre-release builds: append `--pre-release` to `npx vsce publish`.

## [SWR-VSIX-FAT] Fat VSIX Strategy

For extensions with only platform-agnostic components (pure-Node/TypeScript, `"platforms": ["all"]` in `shipwright.json`):

- Bundle binaries under `bin/all/<binaryName>` only (no `.exe` suffix on any platform).
- Build once on any runner — no matrix required.
- Package without `--target` OR package once for each target with identical content (latter avoids Marketplace routing ambiguity).
- Fat VSIX is acceptable only when the extension contains zero native (compiled) binaries.

`too-many-cooks` uses the fat strategy (`tmc-server` is pure Node); `deslop` and `forge` use the per-platform strategy.

## [SWR-VSIX-DOTNET] .NET Sidecar Runtime Requirements

Extensions that bundle framework-dependent .NET sidecars (components with `"language": "dotnet"`) MUST acquire the .NET runtime via the `.NET Install Tool` extension — never require the user to pre-install it.

**This is mandatory for every Shipwright product with .NET components.** The full specification, mandatory wiring code, and forbidden patterns are in `docs/specs/ide-extension-deployment.md` [SWR-IDE-DOTNET-RUNTIME].

Summary:
- `"extensionDependencies": ["ms-dotnettools.vscode-dotnet-runtime"]` in `package.json`
- Call `dotnet.findPath` → `dotnet.acquire` on activation with a non-interactive progress toast
- Set `DOTNET_ROOT` in the env before spawning the Rust LSP host
- Never crash activation when .NET is missing — acquire it and enter degraded state on failure
- Never use `dotnet tool install` for sidecar distribution — sidecars ship in the VSIX at `bin/all/`

## [SWR-VSIX-VERIFY] Package Content Verification

This section implements [SWR-GATE-VERIFY-EXT-PKG] for VS Code artifacts.

After `vsce package`, the CI job MUST verify the produced VSIX contents. Presence-only `grep` checks
are not enough for native-binary extensions.

```bash
# SWR-VSIX-VERIFY
exe=""
if [ "${{ runner.os }}" = "Windows" ]; then exe=".exe"; fi
unzip -l *.vsix | grep -F "bin/${{ matrix.platform }}/${{ inputs.binary_name }}${exe}"
```

A zero exit code confirms the binary is present at the correct path. This check MUST fail the job if the binary is missing.

For extensions with multiple components, verify each component binary.

The verifier MUST also fail when any of these are present:

1. A foreign platform directory under `bin/`.
2. A native binary under `bin/all/`.
3. A deployed manifest or package manifest still carrying the source placeholder instead of the
   stamped version.
4. Compiled test output such as `out/`, source trees such as `src/`, or unbundled `node_modules/`
   except the exact Microsoft-style platform package whitelist.
5. Runtime caches, post-install binary copies, or protocol runtime directories such as `--stdio/`,
   `.shipwright-cache/`, or product-specific cache folders.
