# VSIX Platform-Specific Bundling Spec

```
Spec prefix: SWR-VSIX-*
Status: Draft
```

## [SWR-VSIX-PURPOSE] Purpose

A VS Code extension that ships a native binary cannot be one fat package — VS Code installs a
*platform-specific* VSIX per OS/arch, and each must carry exactly the right binary and nothing from
another platform. Getting that wrong means a user on Apple Silicon downloads an x64 binary, or a
package leaks every platform's binaries and balloons in size. This spec is the canonical pipeline that
makes per-platform VSIX bundling correct and repeatable, pinned to the official Microsoft sample.

It owns the build/stage/package/publish mechanics; it complements
[ide-extension-deployment.md](ide-extension-deployment.md) (the runtime resolution algorithm and
bundling layout rule), [acceptance-gates.md](acceptance-gates.md) (the `verify-extension-package`
gate), and [supply-chain-security.md](supply-chain-security.md) (provenance, bundle-verify, and the
Marketplace/Open VSX trust chain).

## [SWR-VSIX-REFS] External References

Agents working on VSIX bundling or the `publish-vsix-per-platform.yml` template MUST read these before writing any code or CI config. Every normative rule in this spec cites one of these sources.

- **AUTHORITATIVE** — Microsoft official platform-specific sample (CI workflow, `.vscodeignore`, runtime binary resolution): https://github.com/microsoft/vscode-platform-specific-sample/tree/main
  - CI workflow (exact source for matrix, Node version, publish job): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.github/workflows/ci.yml
  - `.vscodeignore` (exact source for node_modules whitelist pattern): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/.vscodeignore
  - `extension.js` (exact source for runtime binary path resolution): https://github.com/microsoft/vscode-platform-specific-sample/blob/main/extension.js
- **REFERENCE** — VS Code bundling guide: https://code.visualstudio.com/api/working-with-extensions/bundling-extension
- **Inspiration** — Rust Analyzer release workflow: https://github.com/rust-lang/rust-analyzer/blob/2024-06-11/.github/workflows/release.yaml#L105
- **RELATED** — OS code signing (mandatory for darwin-* binaries staged into VSIX) lives in [supply-chain-security.md](supply-chain-security.md) (`SWR-SIGN-*`)

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

Key rules derived directly from that file (with the mandatory Shipwright supply-chain
hardening from [supply-chain-security.md](supply-chain-security.md) layered on top):

- **Node version: `22.x`** — the sample uses `node-version: 22.x`. This is the required version. Do not use 20 or 24.
- **`platform` and `arch` are separate matrix fields** — the vsce target is constructed at runtime as `${{ matrix.platform }}-${{ matrix.arch }}` via a `pwsh` step writing to `$GITHUB_ENV`.
- **`npm_config_arch`** is set as an env var on the install step (not globally), matching the sample exactly.
- **`fail-fast: false`** is required. A single-platform failure must not cancel other platforms.
- **Frozen install (`SWR-SEC-FROZEN-INSTALL`)** — Shipwright requires `npm ci`, not the sample's
  `npm install`. The build feeds a Marketplace-published VSIX; it MUST come strictly from the
  committed lockfile.
- **SHA-pinned actions (`SWR-SEC-ACTION-PINNING`)** — every `uses:` is a full 40-char commit SHA.
- **Least-privilege token (`SWR-SEC-TOKEN-PRIVILEGE`)** — top-level `permissions: contents: read`;
  the provenance attest step (below) is the only place granted `id-token`/`attestations`.
- **`GITHUB_TOKEN` on install is Pattern-A only.** It is required when a platform npm package
  downloads its binary from GitHub during install (the MS sample). For Pattern B (manually staged
  Rust binaries — Shipwright's usual case), the install needs **no** token; do not pass one into
  a step that runs dependency lifecycle scripts.

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

permissions:
  contents: read                  # SWR-SEC-TOKEN-PRIVILEGE: top-level default

jobs:
  build:
    runs-on: ${{ matrix.os }}
    permissions:
      contents: read
      id-token: write             # SWR-VSIX-PROVENANCE: attest the packaged VSIX
      attestations: write
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22.x      # Official MS sample: node-version: 22.x
      - run: npm ci               # SWR-SEC-FROZEN-INSTALL (sample uses npm install)
        env:
          npm_config_arch: ${{ matrix.npm_config_arch }}
          # GITHUB_TOKEN: only for Pattern A (npm-delivered binary download); omit for Pattern B.
      - shell: pwsh
        run: echo "target=${{ matrix.platform }}-${{ matrix.arch }}" >> $env:GITHUB_ENV
      - run: npx vsce package --target ${{ env.target }}
      - uses: actions/attest-build-provenance@96b4a1ef7235a096b17240c259729fdd70c83d45 # v2
        with:
          subject-path: "*.vsix"  # SWR-VSIX-PROVENANCE: attest AFTER package
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: ${{ env.target }} # Artifact named darwin-arm64, win32-x64, etc — no vsix- prefix
          path: "*.vsix"
```

For Rust-binary extensions, add a binary build and staging step between `npm ci` and `npx vsce package` — see [SWR-VSIX-STAGING].

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
  [supply-chain-security.md](supply-chain-security.md). VS Code extensions are not subject to Gatekeeper, but the
  embedded binary is — Gatekeeper quarantines it on first execution. An unsigned embedded binary
  will be blocked by macOS.

## [SWR-VSIX-BUNDLE-VERIFY] Verify the Bundled Binary Before Packaging

A platform VSIX ships a backing binary (LSP/MCP/sidecar) to every user. Between building/
downloading that binary and `vsce package`, an attacker who can write the release or poison the
download can swap it — the GlassWorm VS Code extension supply-chain class
(see [supply-chain-security.md](supply-chain-security.md) [SWR-SEC-CHECKSUM]). A `--version`
check does **not** catch this: a malicious binary self-reports any version it likes.

Rules:

- Before copying a binary into `bin/<target>/`, the staging step MUST verify its **SHA-256**
  against the signed release `SHA256SUMS` (or the binary's provenance attestation) — not just run
  `--version`. Build-once-then-reuse-the-attested-artifact is preferred over rebuilding per job.
- When a component declares `"bundled": { "checksum": true }` in `shipwright.json`, the host MUST
  re-verify the bundled binary's digest at activation, before launching it.
- A digest mismatch MUST fail the build (in CI) or block activation (at runtime). Fail closed.

```bash
# SWR-VSIX-BUNDLE-VERIFY — verify before staging into bin/<target>/
grep -F "$(shasum -a 256 "target/release/${BIN}" | awk '{print $1}')" SHA256SUMS \
  || { echo "bundled binary digest not in signed SHA256SUMS"; exit 1; }
```

## [SWR-VSIX-PROVENANCE] VSIX Attestation

After `vsce package` (the `.vsix` is now final), each **per-platform** VSIX MUST be attested with
`actions/attest-build-provenance` (subject = the `.vsix`). Each platform VSIX is a distinct
subject. The job holds `id-token: write` + `attestations: write` and nothing more; the top-level
token stays `contents: read` ([SWR-SEC-TOKEN-PRIVILEGE]).

```yaml
- uses: actions/attest-build-provenance@96b4a1ef7235a096b17240c259729fdd70c83d45 # v2
  with:
    subject-path: "*.vsix"
```

Note the Marketplace also signs every extension on upload and VS Code verifies that signature at
install (`@vscode/vsce-sign`); that covers the Marketplace→client hop only. Provenance here covers
*who built this VSIX and from what source*, and [SWR-VSIX-BUNDLE-VERIFY] covers the binary inside.
See [supply-chain-security.md](supply-chain-security.md) [SWR-SEC-VSIX-MARKETPLACE].

## [SWR-VSIX-PUBLISH] Marketplace Publish Job

The VS Code Marketplace publishes via **Microsoft Entra OIDC (workload identity
federation)** — **no long-lived PAT**. This is the preferred and default model
([SWR-VSIX-PUBLISH-OIDC]). A stored `VSCE_PAT` is the legacy fallback only, and only
inside a protected environment ([SWR-VSIX-PUBLISH-PAT]). The reference implementation
is `templates/gh-actions/publish-vsix-per-platform.yml`.

Both forms share these rules:

- `if: success() && startsWith( github.ref, 'refs/tags/')` — publish only on version
  tags AND only if all build jobs succeeded.
- The job binds to a protected GitHub `environment:` (required reviewers + tag
  restriction `v*.*.*`). For OIDC this environment is also **load-bearing**, not just a
  gate (see below).
- Publish **one `vsce publish` per platform VSIX** inside the single job — a glob of
  several VSIXs into one `vsce publish` silently publishes only the first. Splitting
  into separate *jobs* still races the Marketplace; loop within the one job.
- Pre-release builds (hyphenated SemVer tag) append `--pre-release`.
- `vsce` is **version-pinned** (`npx --yes @vscode/vsce@<pinned>`): a floating `npx
  vsce` would download and run the latest release inside the job that holds a live
  publish token — a supply-chain risk.

### [SWR-VSIX-PUBLISH-OIDC] OIDC publish (preferred, default)

GitHub Actions exchanges its OIDC token for a short-lived Entra session via federation;
that session mints a Marketplace-scoped token at publish time. No secret is ever
stored. See [supply-chain-security.md](supply-chain-security.md) [SWR-SEC-OIDC-PUBLISH]
for the full per-channel rationale, and the org's private deployment runbook for the
one-time Entra app + publisher-membership setup.

```yaml
publish:
  runs-on: ubuntu-latest
  needs: build
  # The environment makes the OIDC subject deterministic
  # (repo:OWNER/REPO:environment:<name>) — Entra rejects wildcards in tag subjects,
  # so the environment is what the federated trust matches against.
  environment: ${{ inputs.marketplace_environment }}
  permissions:
    contents: read
    id-token: write            # REQUIRED — without it GitHub won't issue the OIDC token
  if: success() && startsWith( github.ref, 'refs/tags/')
  steps:
    - uses: actions/download-artifact@v4
    # Exchange the GitHub OIDC token for an Entra session — no client secret. The
    # publisher app has no Azure subscription role (its only authz is Marketplace
    # publisher membership) → allow-no-subscriptions.
    - uses: azure/login@<pinned-sha>   # v2
      with:
        client-id: ${{ secrets.AZURE_CLIENT_ID }}
        tenant-id: ${{ secrets.AZURE_TENANT_ID }}
        allow-no-subscriptions: true
    - name: Publish each platform VSIX (Entra OIDC, no PAT)
      shell: bash
      run: |
        set -euo pipefail
        shopt -s globstar nullglob
        flag=""
        [[ "${GITHUB_REF_NAME}" == *-* ]] && flag="--pre-release"
        # 499b84ac-... is Azure DevOps' fixed first-party app id vsce authenticates
        # against. We mint the token explicitly and pass it via VSCE_PAT rather than
        # `vsce publish --azure-credential`, which has a bug (vscode-vsce#1023).
        VSCE_PAT="$(az account get-access-token \
          --resource 499b84ac-1321-427f-aa17-267ca6975798 \
          --query accessToken -o tsv)"
        echo "::add-mask::${VSCE_PAT}"
        export VSCE_PAT
        for vsix in **/*.vsix; do
          npx --yes @vscode/vsce@<pinned> publish ${flag} --packagePath "${vsix}"
        done
```

Authorization is **publisher-level**: the Entra app is added once as a **Contributor
member of the publisher**, then it can publish every extension under that publisher —
no per-extension Azure object. One **flexible** federated credential
(`claimsMatchingExpression`, e.g. `claims['sub'] matches
'repo:OWNER/*:environment:release'`) trusts every repo at once, lifting the
20-credentials-per-app cap.

Required prerequisites (one-time, outside CI — list in the change summary):

- An Entra app + service principal, with a federated credential trusting
  `repo:OWNER/REPO:environment:<env>` (or the wildcard flexible form).
- The app added as a **Contributor** member of the Marketplace publisher. The
  "Add member → User Id" box requires the SP's **Azure DevOps profile Identity GUID**
  (the app name, client id, and SP object id are all rejected). It can only be read
  while authenticated *as* the SP (`az rest .../profile/profiles/me`).
- Repo `release` environment with `AZURE_CLIENT_ID` + `AZURE_TENANT_ID` (directory
  identifiers, not secrets — environment-scoped for tidiness).

The error `InvalidAccessException: The requested operation is not allowed.` at
`vsce`'s `Publishing '...'` line means OIDC succeeded but the app is **not** an
authorized publisher member — fix the membership, not the workflow.

### [SWR-VSIX-PUBLISH-PAT] PAT publish (legacy fallback)

Only where OIDC federation cannot be set up. `VSCE_PAT` is a **long-lived standing
secret**: store it **environment-scoped** in a protected `environment:` (required
reviewers + tag restriction `v*.*.*`), scoped to **Marketplace → Manage** only, short
expiry, rotated. This is the credential class the GlassWorm campaign harvested — OIDC
exists specifically to retire it.

```yaml
    - run: npx --yes @vscode/vsce@<pinned> publish --packagePath "${vsix}"
      env:
        VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

**Open VSX** has no OIDC / trusted-publishing path (as of 2026) and still uses a
*separate* short-expiry PAT under the same protected-environment rule — never the VS
Code identity. See [supply-chain-security.md](supply-chain-security.md)
[SWR-SEC-OIDC-PUBLISH].

## [SWR-VSIX-FAT] Fat VSIX Strategy

For extensions with only platform-agnostic components (pure-Node/TypeScript, `"platforms": ["all"]` in `shipwright.json`):

- Bundle binaries under `bin/all/<binaryName>` only (no `.exe` suffix on any platform).
- Build once on any runner — no matrix required.
- Package without `--target` OR package once for each target with identical content (latter avoids Marketplace routing ambiguity).
- Fat VSIX is acceptable only when the extension contains zero native (compiled) binaries.

`too-many-cooks` uses the fat strategy (`tmc-server` is pure Node); `deslop` and `sharplsp` use the per-platform strategy.

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
6. Secret or VCS material: `.env`/`.env.*`, `.git/`, `*.pem`, `*.key`, `*.secret`. The
   `.vscodeignore` SHOULD be an allowlist (the MS-sample `**/*` then un-ignore pattern) so these
   never ship even when an unexpected file lands in the package root.
