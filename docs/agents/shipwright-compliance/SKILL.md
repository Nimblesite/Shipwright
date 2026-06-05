---
name: shipwright-compliance
description: Audits any repository for Shipwright deployment-contract conformity AND implements the correct release pipeline — release.yml, GitHub Releases, Homebrew tap, Scoop bucket, per-platform VSIX bundling, the shipwright.json manifest, build-time version stamping, and the shipwright client libraries. Use when the user says "Shipwright compliance", "audit for Shipwright", "set up Shipwright", "make this repo Shipwright-compliant", "fix the release process", "add brew/scoop publishing", "bundle the VSIX", or mentions shipwright.json or the shipwright/@nimblesite libraries.
argument-hint: "[path-to-repo] [--audit-only]"
---

# Shipwright Compliance

Bring the repository at `$ARGUMENTS` (or the current working directory) into conformity with the
Shipwright deployment contract: audit what is missing, then **implement the correct release pipeline**
— GitHub Releases, Homebrew, Scoop, per-platform VSIX, the `shipwright.json` manifest, version
stamping, and the shipwright client libraries.

**You are a process wrapper around the published specs. Do not invent rules. Every finding and every
change MUST trace to a spec ID (e.g. `[SWR-VSIX-PACKAGE]`).** The specs are the single source of truth.

Spec source (cite these URLs, never local paths — this skill runs on repos that do not contain Shipwright):
`https://github.com/Nimblesite/Shipwright/tree/main/docs/specs/`

| Spec | URL |
| --- | --- |
| Binary version contract (incl. platform coverage / host compat) | `.../docs/specs/binary-version-contract.md` (`SWR-VERSION-*`, `SWR-COMPAT-*`) |
| IDE extension deployment | `.../docs/specs/ide-extension-deployment.md` (`SWR-IDE-*`) |
| VSIX platform bundling | `.../docs/specs/vsix-platform-bundling.md` (`SWR-VSIX-*`) |
| **Supply chain security** (threat model, per-channel plan, OS signing) | `.../docs/specs/supply-chain-security.md` (`SWR-SEC-*`, `SWR-SIGN-*`) |
| Acceptance gates | `.../docs/specs/acceptance-gates.md` (`SWR-GATE-*`) |
| Library architecture | `.../docs/specs/library-architecture.md` (`SWR-ARCH-*`) |
| Source projects & survey | `.../docs/specs/source-projects.md` (`SWR-SRC-*`) |
| Release pipeline plan | `.../docs/plans/release-pipeline.md` (`SWR-REL-*`) |

Reusable workflow templates (fetch the raw file and adapt — do not hand-roll from memory):
`https://raw.githubusercontent.com/Nimblesite/Shipwright/main/templates/gh-actions/<file>`
where `<file>` ∈ `release-binary-multiplatform.yml`, `publish-brew-tap.yml`,
`publish-scoop-bucket.yml`, `publish-vsix-per-platform.yml`.

## Workflow

Copy this checklist into your response and tick items as you go:

```
Shipwright Compliance Progress:
- [ ] Phase 0: Detect repo shape (languages, binaries, IDE extension, every distribution channel, existing CI)
- [ ] Phase A: Conformity audit — run reference/audit-checklist.md §1–11,13, record PASS/FAIL/N/A + spec ID
- [ ] Phase A: Supply-chain SECURITY audit — run reference/audit-checklist.md §12 against EVERY channel this repo ships to
- [ ] Phase A: Emit the audit report (conformity + security holes)
- [ ] Phase B: Implement — manifest, version stamping, libraries, release.yml (see reference/implement-release.md)
- [ ] Phase B: Wire GitHub Release + Homebrew + Scoop + per-platform VSIX + registries as applicable
- [ ] Phase B: Close the supply-chain holes — pinned actions, least-priv tokens, frozen installs, provenance, SBOM, signed checksums, OIDC publishing, per-channel verification
- [ ] Phase C: Verify locally (manifest validates, `--version` matches, CI gate green)
- [ ] Emit the change summary
```

The **security audit is not optional**. Treat the shared supply-chain controls as a required checklist —
pinned actions, least-privilege tokens, frozen installs, provenance, SBOM, signed checksums, OIDC
publishing, and download-time integrity verification — and report the posture per channel, not just
whether the release pipeline exists. A release pipeline can be complete and still have hardening items
outstanding; every audit MUST surface each remaining item per channel.

Default behavior is **audit then implement** the fixes. If the user passed `--audit-only`, stop after
the audit report. If the repo already conforms, say so and make no changes.

### Phase 0 — Detect repo shape

Before anything, classify the product so you skip N/A work and target the right templates:

- **Languages / build files:** `Cargo.toml`, `package.json`, `pubspec.yaml`, `*.csproj`, `build.gradle.kts`.
- **Binaries:** what does this repo ship? CLI, LSP server, MCP server, .NET sidecar, helper tools.
- **IDE extension:** `engines.vscode` in `package.json`, `vsce`, `.vsix`, a JetBrains/Zed manifest.
- **Every distribution channel this repo ships to** — each is a distinct trust boundary the security
  audit must cover: GitHub Releases, VS Code Marketplace, Open VSX, JetBrains/Android Studio, Zed,
  Homebrew tap, Scoop bucket, Neovim downloader, and the language registries (crates.io / npm / NuGet /
  pub.dev / Maven Central). List the ones in play; the rest are N/A.
- **Existing CI:** `.github/workflows/*` — is there a tag-triggered `release.yml` already? Are its
  actions SHA-pinned and its `permissions:` least-privilege?

State the detected shape in one line before proceeding.

### Phase A — Audit

Work through **[reference/audit-checklist.md](reference/audit-checklist.md)** section by section. For
each item: check → record `PASS` / `FAIL` / `N/A` → cite the spec ID. Collect everything, then emit the
audit report once (format in the checklist file). Do not fix mid-audit.

**§12 (Supply-chain security) is run for EVERY channel the repo ships to**, not just the VSIX. For each
shared control (pinned actions, least-priv token, frozen install, provenance, SBOM, signed checksums,
OIDC publishing, vuln gate) and each channel's specific control (macOS notarization, marketplace PAT in
a protected env, GPG for Maven, download-time verify for brew/scoop/Neovim/Zed), record PASS/FAIL with
the `SWR-SEC-*` / `SWR-SIGN-*` id. A repo can be release-pipeline-complete and still be full of
supply-chain holes — surface them.

### Phase B — Implement

Follow **[reference/implement-release.md](reference/implement-release.md)** to fix every FAIL in spec
order. The implementation playbook is the authoritative step list; the high-level order is:

1. **`shipwright.json` manifest** — declare every deployable component, its `platforms`, `sources`,
   and `expectedVersion`. The manifest is the single source of truth for what gets bundled and verified.
   See **[reference/manifest-and-platforms.md](reference/manifest-and-platforms.md)**.
2. **Version stamping** — set every source version field to `0.0.0-dev`; add `shipwright-version-stamp`
   as a first-class release/test input. Never hard-code release versions in source. `[SWR-VERSION-BUILD-STAMPING]`.
3. **Client libraries** — wire the shipwright library for each language so `--version` / `serverInfo`
   come from package metadata, not hard-coded strings. `[SWR-VERSION-BINDINGS]`, `[SWR-ARCH-LIBRARIES]`.
4. **`release.yml`** — tag-triggered (`v*`); stamp from the tag → CI gate → build matrix → publish.
   `[SWR-REL-WORKFLOW]`.
5. **GitHub Release** — build per platform, archive + `.sha256`, upload to the `v{version}` release.
   `[SWR-REL-GITHUB]`.
6. **Homebrew + Scoop** — publish the formula/manifest to the tap/bucket repo from the release assets.
7. **Per-platform VSIX** (only if an IDE extension is present) — one VSIX per `vsceTarget`, binaries
   staged under `bin/<vsceTarget>/`, verified package contents, Marketplace publish on tag. `[SWR-VSIX-*]`.
8. **Acceptance gates in CI** — validate the manifest, run `--version` / `--version --json`, and verify
   the produced package against the manifest. `[SWR-GATE-*]`.

Reuse the canonical templates (fetch the raw URLs above and adapt to this repo's binary/extension
names) instead of writing workflows from scratch. Make the **smallest diff that achieves conformity**.

### Phase C — Verify

Prove the changes locally before declaring done:

- Manifest validates: `npx @nimblesite/shipwright-validate-manifest shipwright.json` (or the repo's
  vendored validator). `[SWR-GATE-CI]`.
- Each declared binary builds and `<binaryName> --version` prints exactly `<binaryName> <version>`
  and exits `0`. `[SWR-VERSION-CLI-OUTPUT]`.
- The repo's CI gate (`make ci`, `npm test`, etc.) is green.
- A test stamp round-trips: `shipwright-version-stamp --tag vX.Y.Z --root <temp> --dry-run` lists every
  version carrier. `[SWR-VERSION-BUILD-STAMPING]`.

## Critical fail-fast rules (release blockers, not style)

- **No PATH / package-manager runtime fallback.** A normal startup that reads or mutates PATH, shells
  out to `which`/`where`, or launches a Homebrew/Scoop/npm-global/cargo/dotnet-tool binary is FAIL.
  Bundled or explicit-override sources only. `[SWR-IDE-RESOLUTION]`, `[SWR-SEC-CONTROLS]`.
- **One VSIX per target.** Native-binary extensions MUST package `npx vsce package --target <vsceTarget>`.
  A single all-platform native VSIX is FAIL. `[SWR-VSIX-PACKAGE]`.
- **Verify package contents.** The release MUST inspect each produced artifact: exact `bin/<target>/`
  binary present, no foreign-platform binaries, no unstamped placeholders, no `out/`/`src/`/unbundled
  `node_modules/`, no runtime caches. `[SWR-VSIX-VERIFY]`.
- **Source versions stay `0.0.0-dev`.** Tag-triggered releases stamp in the runner working tree and MUST
  NOT commit/push version bumps after the tag exists. `[SWR-VERSION-BUILD-STAMPING]`.
- **Version match is mandatory.** `shipwright.json` `expectedVersion`, the binary `--version`, and the
  protocol `serverInfo.version` MUST agree. A mismatch stops startup with a precise error. `[SWR-VERSION-MATCHING]`, `[SWR-IDE-ERROR]`.
- **.NET sidecars** acquire the runtime via the `.NET Install Tool` extension — never `dotnet tool
  install`, never crash on missing .NET, never hand-roll a download. `[SWR-IDE-DOTNET-RUNTIME]`.
- **Supply-chain integrity is non-negotiable.** Mutable action tags (`@v4`/`@stable`), a missing or
  over-broad top-level `permissions:`, `npm install` (vs `npm ci`) in a release/VSIX job, a release
  with no provenance/SBOM/cosign-signed `SHA256SUMS`, a downloader (Neovim/Zed/host) that executes a
  fetched binary without verifying its checksum AND signature, or a long-lived registry/marketplace
  token outside a protected environment are all FAIL. `[SWR-SEC-*]`, `[SWR-SIGN-*]`.

## Change summary format

After Phase B/C, emit one summary:

```
## Shipwright Compliance — <repo name>

Detected shape: <e.g. "Rust CLI + VS Code extension (darwin-arm64, linux-x64, win32-x64)">

### Implemented
- [SWR-XYZ] <file created/changed> — <what it now does>

### Verified
- <command run> → <result>

### Manual follow-ups (cannot be done from code)
- Configure GitHub secrets: <list> ([SWR-REL-WORKFLOW] table)
- Create tap/bucket repos, register Trusted Publishers, create the `release` environment

### Remaining FAILs (if any)
- [SWR-XYZ] <why not fixed, what is blocked>
```

Never fabricate a green result. If a build or validation cannot run here, say so and leave it as a
verified manual follow-up.
