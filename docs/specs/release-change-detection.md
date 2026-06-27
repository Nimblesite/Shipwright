# Release Change Detection

```
Spec prefix: SWR-REL-CHANGES-*
Status: Draft
Date: 2026-06-26
```

## Context

A full Shipwright release rebuilds and republishes **everything** on every `v*`
tag: native binaries on a macOS/Windows/Linux matrix, one VSIX per platform on a
second matrix, the JetBrains/Neovim/Homebrew/Scoop artifacts, and the website.
macOS and Windows runners bill at several times the Linux rate, so a release that
only fixes a typo in the docs still pays for the entire binary matrix. Across the
reference adopters (Basilisk, Deslop, SharpLsp) this is the dominant CI cost.

This spec formalises the change-sensitive release first proposed and implemented in
Deslop (`Deslop/docs/proposals/shipwright-change-sensitive-release.md`, by the
`deslop-release` agent). It defines a cheap gate that runs first on a Linux runner,
compares the pushed tag against the previous release tag, and publishes only the
surfaces whose inputs changed — without weakening any release gate.

## [SWR-REL-CHANGES-CONTRACT] What bounds a partial release

`SWR-REL-VERSION` stamps **one version per tag**, and every host
`activation-verify` is `onMismatch: error` (the VSIX bundles the lsp+mcp binaries;
the JetBrains plugin bundles the lsp). So a shipped artifact MUST bundle binaries
built **at the tag version** — you cannot ship a new VSIX without binaries stamped
at that version. This is the hard constraint that bounds what may ship alone:

- **binary changed → full release.** Every downstream artifact bundles a binary.
- **vsix / jetbrains changed (binary unchanged) → the binary matrix still runs**
  (the artifact needs binaries at the new version) and that artifact publishes, but
  the *other* channels (the standalone binary release, Homebrew, Scoop, the other
  extension, the website) are skipped.
- **website changed → the only fully decoupled surface.** Skip the whole matrix.

Reusing a prior release's already-built binary for a vsix-only release would bundle
a binary whose `--version` is the *old* tag, which `activation-verify` rejects. That
is a contract change (per-component effective version) and is intentionally **out of
scope** — the gate never reuses binaries across versions.

## [SWR-REL-CHANGES-OVERVIEW]

| Piece | Where | Role |
| --- | --- | --- |
| `shipwright-release-scope` | `tools/shipwright-release-scope/` | **Pure** classifier: `(changed paths, ruleset) → decision`. No git, no network. |
| `release-change-detection.yml` | `templates/gh-actions/` | Reusable workflow: resolves the previous tag, runs `git diff`, calls the tool, exposes the decision as job outputs. |
| `release-scope.json` | each product repo (`.github/`) | Per-repo ruleset mapping path globs to surfaces (`schemas/release-scope.schema.json`). |

The split keeps the decision logic pure and unit-testable (the injected-I/O pattern
used by `crates/shipwright-host`): git and the GitHub API live only in the workflow.
Native `git diff` is used — never `tj-actions/changed-files` or any third-party
diff action (`SWR-SEC-ACTION-PINNING`).

## [SWR-REL-CHANGES-RULES]

The ruleset is a JSON object of gitignore-style glob lists, validated by
`schemas/release-scope.schema.json`:

```json
{
  "binary":    ["crates/**", "Cargo.toml", "Cargo.lock", "build.rs"],
  "vsix":      ["vscode-extension/**", "extensions/**"],
  "jetbrains": ["clients/jetbrains/**", "clients/kotlin/**"],
  "website":   ["website/**", "docs/specs/**"],
  "ignore":    ["**/*.md", "README*", ".github/**"]
}
```

`*` and `?` match within a single path segment; `**` spans directories. All keys
are optional; an empty ruleset classifies every change as *unmatched* and so always
forces a full release (see FAILSAFE).

> **Future direction.** The Deslop proposal envisions migrating this mapping into
> `shipwright.json` as a per-component `sourcePaths` glob list, so the product
> manifest becomes the single source of truth and the tool stays product-agnostic.
> The standalone `release-scope.json` is the interim until the manifest schema
> carries `sourcePaths`.

## [SWR-REL-CHANGES-PRIORITY]

Each changed path is classified into exactly one surface by testing the categories
in fixed priority order — **binary → vsix → jetbrains → website → ignore** — and
taking the first match. This makes overlapping globs deterministic: `docs/specs/foo.md`
matches both `website` (`docs/specs/**`) and `ignore` (`**/*.md`), and resolves to
`website` because `website` is checked first.

## [SWR-REL-CHANGES-CASCADE]

If **any** changed path is classified `binary`, the decision is the full release:
`full = build_matrix = vsix = jetbrains = website = true`. The binary is the
foundational artifact — every other artifact bundles or documents it — so a binary
change invalidates every channel.

## [SWR-REL-CHANGES-MATRIX]

When no binary path changed, the surfaces are independent, with one rule from the
CONTRACT: a binary-bundling surface forces the matrix.

- `vsix = true` iff a `vsix` path changed; `jetbrains = true` iff a `jetbrains`
  path changed; `website = true` iff a `website` path changed.
- `build_matrix = vsix || jetbrains` — because those artifacts must bundle binaries
  rebuilt at the new tag version. A website-only change leaves `build_matrix = false`,
  which is where the large saving comes from.

## [SWR-REL-CHANGES-FAILSAFE]

A changed path that matches **no** category (not even `ignore`) forces a full
release, exactly as a binary change does. Rationale: shipping too much costs money
once; shipping too little ships a stale or broken artifact. New, unforeseen paths
fail *open*. Paths known to affect no release artifact (READMEs, CI config, test
fixtures) must be listed under `ignore` so they stay cheap.

## [SWR-REL-CHANGES-FIRSTRELEASE]

When the current tag has no predecessor (`git describe` finds no older tag), there
is nothing to diff against and the workflow publishes everything. The classifier is
not invoked in this case.

## [SWR-REL-CHANGES-OUTPUTS]

`release-change-detection.yml` exposes these `workflow_call` outputs:

| Output | Meaning |
| --- | --- |
| `full` | publish everything (standalone binary + Homebrew + Scoop + all extensions + website). |
| `build_matrix` | the native binary matrix must run (the expensive gate). |
| `vsix` | build & publish the VS Code extension. |
| `jetbrains` | build & publish the JetBrains plugin. |
| `website` | deploy the website. |
| `previous_tag` | the tag diffed against (`""` on first release). |

The tool also prints a full JSON decision (with the per-surface path lists) to
stdout for auditing, and writes a Markdown summary to `$GITHUB_STEP_SUMMARY`.

## [SWR-REL-CHANGES-WIRING]

Downstream `release.yml` calls the gate as the first job and conditions every other
job on its outputs. Sketch (Basilisk shape):

```yaml
jobs:
  scope:
    uses: ./.github/workflows/release-change-detection.yml
    with:
      shipwright_rev: <pinned Shipwright commit SHA>

  build:                                  # native binary matrix (the costly one)
    needs: scope
    if: needs.scope.outputs.build_matrix == 'true'
  release:                                # standalone binary GitHub Release
    needs: [scope, build]
    if: needs.scope.outputs.full == 'true'
  vsix:
    needs: [scope, build]
    if: needs.scope.outputs.vsix == 'true'
  publish-homebrew:
    needs: [scope, release]
    if: needs.scope.outputs.full == 'true'
  deploy-pages:
    needs: scope
    if: needs.scope.outputs.website == 'true'
```

A job that depends on a job that may be skipped must guard with `!cancelled()` and an
explicit `needs.<job>.result` check so a *skipped* (not failed) upstream never wrongly
skips a downstream publish.

## [SWR-REL-CHANGES-TOOL]

`shipwright-release-scope` is pure and side-effect-free except for writing the
decision to stdout and the GitHub Actions files. It exits non-zero only on a usage
error, an unreadable/invalid ruleset, or an unreadable changed-list. It never reads
git, the network, or the filesystem beyond the two paths it is handed.

## Implementation Map

| Spec ID | Code | Tests |
| --- | --- | --- |
| CASCADE / MATRIX / FAILSAFE / PRIORITY | `tools/shipwright-release-scope/src/main.rs` (`decide`, `classify`) | `tools/shipwright-release-scope/tests/scope.rs` |
| CONTRACT | enforced by the decision (no binary reuse) | `scope.rs` (`vsix_only_still_builds_the_matrix_*`) |
| RULES | `schemas/release-scope.schema.json`, `fixtures/release-scope/basilisk.json` | `scope.rs` (`invalid_*`) |
| FIRSTRELEASE / OUTPUTS / WIRING | `templates/gh-actions/release-change-detection.yml` | exercised in downstream repos |
