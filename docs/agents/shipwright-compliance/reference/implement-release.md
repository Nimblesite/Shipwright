# Shipwright Release Implementation Playbook

How to make a repo ship correctly: the `shipwright.json` manifest, version stamping, libraries, and a
tag-triggered `release.yml` that builds per platform and deploys to **GitHub Releases, Homebrew, Scoop,
and the VS Code Marketplace**. Fix FAILs in this order. Make the smallest diff that achieves conformity.

**Reuse the canonical templates** — fetch the raw file and adapt the input values to this repo. Do not
reinvent the matrix or publish jobs from memory:

```
https://raw.githubusercontent.com/Nimblesite/Shipwright/main/templates/gh-actions/release-binary-multiplatform.yml
https://raw.githubusercontent.com/Nimblesite/Shipwright/main/templates/gh-actions/publish-brew-tap.yml
https://raw.githubusercontent.com/Nimblesite/Shipwright/main/templates/gh-actions/publish-scoop-bucket.yml
https://raw.githubusercontent.com/Nimblesite/Shipwright/main/templates/gh-actions/publish-vsix-per-platform.yml
```

Each is a `workflow_call` reusable workflow. The repo's own `release.yml` becomes a thin orchestrator
that stamps the version, runs the CI gate, then `uses:` these templates with the right inputs/secrets.

## Contents

1. Manifest (`shipwright.json`)
2. Version stamping (`0.0.0-dev` + stamper)
3. Client libraries per language
4. `release.yml` orchestrator
5. GitHub Release (binary archives + sha256)
6. Homebrew tap publish
7. Scoop bucket publish
8. Per-platform VSIX (IDE extensions)
9. Acceptance gates in CI
10. Secrets and one-time manual setup
11. Verify locally

---

## 1. Manifest (`shipwright.json`)

Create `shipwright.json` at the repo root (and at the extension root if there is a VSIX). Declare every
deployable component. See **manifest-and-platforms.md** for the schema, canonical platform ids, kinds,
and `sources` cascades. The manifest is what the release verifies and what the host bundles — if it is
not declared here, it must not ship; if it is declared, the release MUST produce it. `[SWR-VERSION-MANIFEST]`.

## 2. Version stamping (`0.0.0-dev` + stamper)

1. Set **every** source version field to `0.0.0-dev`: `Cargo.toml` `[workspace.package].version`, each
   `package.json` `version`, each `*.csproj` `<Version>`, each `pubspec.yaml` `version`, `shipwright.json`
   `product.version`, and every component `expectedVersion`. `[SWR-VERSION-BUILD-STAMPING]`.
2. Adopt `shipwright-version-stamp` (Rust binary / `cargo install shipwright-version-stamp`) as the
   release/test stamper. It rewrites all carriers from a tag using structured parsers:
   ```bash
   shipwright-version-stamp --tag v1.2.3 --root . --dry-run   # list carriers, change nothing
   shipwright-version-stamp --tag v1.2.3 --root .             # stamp the runner working tree
   ```
3. The release stamps in the runner working tree **before** build/verify/package and never commits or
   pushes the bump. The tagged SHA keeps `0.0.0-dev` in source.
4. Tests must be able to stamp an arbitrary version into a temp copy and assert every carrier updated. `[SWR-VERSION-TEST-REQ]`.

## 3. Client libraries per language

Replace bespoke `--version` parsers and resolver code with the shipwright library for each language so
the version always derives from package metadata. `[SWR-VERSION-BINDINGS]`, `[SWR-ARCH-LIBRARIES]`.

- **Rust binary:** add `shipwright`; route `--version` / `--version --json` through it (reads `CARGO_PKG_*`).
- **Rust host (Zed):** `shipwright-host` (pure resolver, injected probe) / `shipwright-zed`.
- **VS Code extension:** `@nimblesite/shipwright-vscode` (+ `@nimblesite/shipwright-core` for path/resolve).
  Resolve via the `sources` array in `shipwright.json` — never reimplement path joining or PATH lookup.
- **Node/MCP:** `@nimblesite/shipwright-mcp` to derive `serverInfo.version` from `package.json`.
- **.NET sidecar / tool:** `Shipwright` (version from assembly metadata).
- **Dart:** `shipwright`.

## 4. `release.yml` orchestrator

`.github/workflows/release.yml` — tag-triggered, stamp → gate → publish. `[SWR-REL-WORKFLOW]`.

```yaml
name: release
on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+'
      - 'v[0-9]+.[0-9]+.[0-9]+-*'

permissions:
  contents: write        # create GitHub Release
  id-token: write        # npm OIDC trusted publishing (only if publishing npm)

jobs:
  prepare:
    runs-on: ubuntu-latest
    environment: release
    outputs:
      version: ${{ steps.v.outputs.version }}
    steps:
      - uses: actions/checkout@v4
      - id: v
        shell: bash
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
      - name: Stamp version from tag
        run: shipwright-version-stamp --tag "${GITHUB_REF_NAME}" --root .
      - name: CI gate
        run: make ci          # lint + test + build; MUST pass before any publish

  release-binaries:
    needs: prepare
    uses: ./.github/workflows/release-binary-multiplatform.yml   # vendored from the template
    with:
      binary_name: <binary>
      version: ${{ needs.prepare.outputs.version }}
      build_command: cargo build --release --bin <binary>
    # adds the GitHub Release + per-platform archives (see §5)
```

Vendor each template into `.github/workflows/` (copy the raw file) and call it with `uses:`. Add the
brew/scoop/vsix jobs as `needs: release-binaries` so they consume the published assets.

## 5. GitHub Release (binary archives + sha256)

Use `release-binary-multiplatform.yml`. It already does the right thing per leg; confirm:

- Matrix `fail-fast: false` across `darwin-arm64` (macos-15), `darwin-x64` (macos-13), `linux-x64`,
  `win32-x64` (extend with `linux-arm64`, `win32-arm64` if the manifest lists them). `[SWR-VSIX-TARGETS]`.
- Validate the manifest, build, then **verify** `<binary> --version` equals `<binary> <version>`.
- Archive `<prefix>-<version>-<platform>.tar.gz` (+ `.zip` on Windows) **and a `.sha256` sidecar**.
- `publish` job: `permissions: contents: write`, `softprops/action-gh-release@v2`, `tag_name: v<version>`,
  `files: dist/*`. `[SWR-REL-GITHUB]`.

Record each asset URL + sha256 — the brew and scoop jobs need them as inputs.

## 6. Homebrew tap publish

Add a job that `uses:` `publish-brew-tap.yml` after the release assets exist. It writes
`Formula/<formula>.rb` (with `url`, `version`, `sha256`, and a `--version` `test do`) to the tap repo and
commits it. Inputs:

```yaml
  publish-brew:
    needs: release-binaries
    uses: ./.github/workflows/publish-brew-tap.yml
    with:
      tap_repo: <owner>/homebrew-<tap>
      formula_name: <formula>
      version: ${{ needs.prepare.outputs.version }}
      asset_url: https://github.com/<owner>/<repo>/releases/download/v<version>/<prefix>-<version>-darwin-arm64.tar.gz
      sha256: <sha256 from the .sha256 sidecar>
      binary_name: <binary>
      homepage: https://github.com/<owner>/<repo>
      description: <one line>
    secrets:
      tap_token: ${{ secrets.HOMEBREW_TAP_TOKEN }}
```

The `sha256` MUST be the value from the build's checksum sidecar, not recomputed by hand. Create the
`homebrew-<tap>` repo and a fine-grained PAT (`HOMEBREW_TAP_TOKEN`) with contents:write on it — these are
manual follow-ups; list them in the change summary.

## 7. Scoop bucket publish

Add a job that `uses:` `publish-scoop-bucket.yml`. It serializes a Scoop manifest
(`version`, `architecture.64bit.url`, `hash`, `bin`) with a real JSON serializer and commits it to the
bucket repo. Inputs:

```yaml
  publish-scoop:
    needs: release-binaries
    uses: ./.github/workflows/publish-scoop-bucket.yml
    with:
      bucket_repo: <owner>/scoop-<bucket>
      manifest_name: <app>
      version: ${{ needs.prepare.outputs.version }}
      url: https://github.com/<owner>/<repo>/releases/download/v<version>/<prefix>-<version>-win32-x64.zip
      sha256: <sha256 of the win32-x64 archive>
      bin: <binary>.exe
      homepage: https://github.com/<owner>/<repo>
      description: <one line>
    secrets:
      bucket_token: ${{ secrets.SCOOP_BUCKET_TOKEN }}
```

Scoop consumes the Windows `.zip` asset. Create the `scoop-<bucket>` repo and `SCOOP_BUCKET_TOKEN`.

## 8. Per-platform VSIX (IDE extensions)

Only if a VS Code extension is present. Use `publish-vsix-per-platform.yml`. It enforces the Microsoft
platform-specific sample exactly. Confirm/produce:

- One VSIX per `vsceTarget` via `npx vsce package --target <target>` — never a fat native VSIX. `[SWR-VSIX-PACKAGE]`.
- Matrix Node `22.x`, `fail-fast: false`, `npm_config_arch` per leg, all 6 targets. `[SWR-VSIX-CI-MATRIX]`.
- Binary staged to `bin/<target>/<binary><exe>`; `.vscodeignore` excludes other platform dirs. `[SWR-VSIX-LAYOUT]`.
- **Verify contents**: `unzip -l *.vsix | grep -F "bin/<target>/<binary><exe>"` and fail on foreign
  platform bins, placeholders, `out/`, `src/`, unbundled `node_modules/`, or caches. `[SWR-VSIX-VERIFY]`.
- `publish` job: `if: success() && startsWith(github.ref, 'refs/tags/')`, single `vsce publish`, `VSCE_PAT`. `[SWR-VSIX-PUBLISH]`.
- darwin legs sign the embedded binary before staging (Gatekeeper). `[SWR-SIGN-APPLE-INTEGRATION]`.
- per-VSIX `actions/attest-build-provenance`; the staged binary is verified vs the signed release before packaging. `[SWR-VSIX-PROVENANCE]`, `[SWR-VSIX-BUNDLE-VERIFY]`.
- `engines.vscode` `^1.99.0`+. .NET sidecars wire `ms-dotnettools.vscode-dotnet-runtime`. `[SWR-IDE-DOTNET-RUNTIME]`.

## 8b. Supply-chain hardening — apply to every channel `[SWR-SEC-*]`

Fix every §12 FAIL from the audit. These land in the shipped templates already; when adapting a repo's
own workflows, apply the same:

1. **Pin every action** to a 40-char SHA (`# vX.Y.Z` comment); add `.github/dependabot.yml` (copy
   `templates/gh-actions/dependabot.yml`). `[SWR-SEC-ACTION-PINNING]`.
2. **Top-level `permissions: contents: read`**; grant write/`id-token`/`attestations` per job only;
   `persist-credentials: false`. `[SWR-SEC-TOKEN-PRIVILEGE]`.
3. **Frozen installs** — replace `npm install` with `npm ci`, add `--frozen-lockfile`/`--locked`. `[SWR-SEC-FROZEN-INSTALL]`.
4. **Provenance + SBOM** — `actions/attest-build-provenance` + a CycloneDX SBOM (`anchore/sbom-action` /
   `cargo cyclonedx`) attested per artifact; `cargo-auditable` for Rust. `[SWR-SEC-PROVENANCE]`, `[SWR-SEC-SBOM]`.
5. **Signed checksums** — one `SHA256SUMS`, cosign keyless-signed; replace per-asset `.sha256`. The
   host / brew / scoop / Neovim / Zed download path verifies digest **and** signature before exec. `[SWR-SEC-CHECKSUM]`.
6. **OIDC publishing** — move crates.io / NuGet / pub.dev off long-lived tokens; npm keeps
   `--provenance`; marketplace/Open VSX/JetBrains PATs run in a protected `environment:`. `[SWR-SEC-OIDC-PUBLISH]`.
7. **Vuln gate + supply-chain lint** — add `osv-scanner` + `cargo-deny`/`grype`, and call the shipped
   `lint-supply-chain.yml` (zizmor). `[SWR-SEC-VULN-GATE]`.
8. **Manifest** — set `supplyChain` and per-component `githubRelease` `signature`/`provenance`/`sbom`/
   `signerWorkflow` so the host enforces it. `[SWR-SEC-MANIFEST]`.
9. **License** — declare a single SPDX license (default `MIT`, real copyright holder) that matches a
   LICENSE file shipped in every published package; never declare an expression (e.g. `MIT OR Apache-2.0`)
   whose second license text is absent. `[SWR-REL-LICENSE]`.
10. **macOS signing + Windows position** — sign and notarize darwin binaries (`[SWR-SIGN-APPLE-WORKFLOW]`).
    Windows native signing is unsolved: distribute Windows via Scoop/Homebrew + cosign provenance and
    record the position in a short note + tracked issue — do not block the release on it. `[SWR-SIGN-WINDOWS]`.

## 9. Acceptance gates in CI

Add to the normal CI workflow (not just release) so drift is caught on every PR. `[SWR-GATE-CI]`:

```bash
npx @nimblesite/shipwright-validate-manifest shipwright.json
<binary> --version
<binary> --version --json
```

For IDE extensions, add a `verify-extension-package` step that asserts the built artifact contains the
manifest-declared binary at `bin/<platform>/`. `[SWR-GATE-VERIFY-EXT-PKG]`.

## 10. Secrets and one-time manual setup

These cannot be done from code — list them as manual follow-ups in the change summary. `[SWR-REL-WORKFLOW]`.

Prefer OIDC trusted publishing (no stored token) wherever the registry supports it — see §8b.6.

| Need | Secret / setup |
| --- | --- |
| GitHub Release | none (built-in `GITHUB_TOKEN`, `contents: write` on the release job only) |
| Homebrew | `HOMEBREW_TAP_TOKEN`; create `homebrew-<tap>` repo |
| Scoop | `SCOOP_BUCKET_TOKEN`; create `scoop-<bucket>` repo |
| VS Code Marketplace | `VSCE_PAT` (`Marketplace → Manage`), in a protected `release` env |
| Open VSX | a **separate** Open VSX PAT, short-expiry, in a protected env |
| JetBrains / Android Studio | `signPlugin` cert chain + key + publish token, in a protected env |
| crates.io | none — register a Trusted Publisher (OIDC); retire `CARGO_REGISTRY_TOKEN` |
| npm | none — register each pkg as a Trusted Publisher (OIDC) |
| NuGet | none — register a Trusted Publisher (OIDC); retire `NUGET_API_KEY` |
| pub.dev | none — enable automated publishing (OIDC); retire `DART_PUB_TOKEN` |
| Maven Central | Central Portal token + `GPG_SIGNING_KEY/PASSWORD` (GPG mandatory) |
| Apple signing | `APPLE_DEVELOPER_ID_CERT_P12(+PASSWORD)`, `APPLE_TEAM_ID`, `NOTARIZATION_API_KEY_P8`, `NOTARIZATION_KEY_ID`, `NOTARIZATION_ISSUER_ID` |
| Release env | create a `release` GitHub environment with reviewer + tag restriction `v*.*.*` |

## 11. Verify locally

Before declaring done, run what you can and report real output. `[SWR-GATE-CI]`:

1. `npx @nimblesite/shipwright-validate-manifest shipwright.json` → exits 0.
2. Build each binary; `<binary> --version` prints `<binary> 0.0.0-dev` (source state) and exits 0.
3. `shipwright-version-stamp --tag v0.0.1 --root <temp-copy> --dry-run` → lists every carrier.
4. The repo CI gate (`make ci` / `npm test`) is green.
5. `actionlint .github/workflows/*.yml` if available — workflows parse.

Never claim a step passed if it did not run here. Leave un-runnable steps as verified manual follow-ups.
