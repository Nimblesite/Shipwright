# shipwright-release-scope

Decide which release surfaces a `v*` tag must actually publish, so the expensive
multi-platform build matrix only runs when the thing it builds has changed since
the previous release. Cuts CI cost on website-only releases (the macOS/Windows
matrix is skipped entirely) and trims the unrelated channels on extension-only
releases.

Implements [`docs/specs/release-change-detection.md`](../../docs/specs/release-change-detection.md)
(`SWR-REL-CHANGES-*`) — the Shipwright realisation of the Deslop `SWR-REL-CHANGES`
proposal. The tool is **pure**: it classifies a list of changed paths against a
JSON ruleset and prints a decision. Resolving the previous tag and running
`git diff` is the caller's job (see
[`templates/gh-actions/release-change-detection.yml`](../../templates/gh-actions/release-change-detection.yml)).

## Usage

```bash
# From a file
shipwright-release-scope --config .github/release-scope.json --changed changed.txt

# From a pipe (what the reusable workflow does)
git diff --name-only "$PREV..$CURRENT" \
  | shipwright-release-scope --config .github/release-scope.json --changed -
```

Prints a JSON decision to stdout. Under GitHub Actions it also appends
`full`, `build_matrix`, `vsix`, `jetbrains`, and `website` to `$GITHUB_OUTPUT`
and a summary to `$GITHUB_STEP_SUMMARY`.

## Ruleset

A JSON object of gitignore-style glob lists, validated by
[`schemas/release-scope.schema.json`](../../schemas/release-scope.schema.json):

```json
{
  "binary":    ["crates/**", "Cargo.toml", "Cargo.lock", "build.rs"],
  "vsix":      ["vscode-extension/**", "extensions/**"],
  "jetbrains": ["clients/jetbrains/**", "clients/kotlin/**"],
  "website":   ["website/**", "docs/specs/**"],
  "ignore":    ["**/*.md", "README*", ".github/**"]
}
```

`*` and `?` stay within a path segment; `**` spans directories.

## Decision rule

Shipwright stamps one version per tag and host `activation-verify` is
`onMismatch: error`, so any artifact that bundles a binary must bundle one built
at the tag version — you cannot ship a new VSIX/JetBrains plugin without
rebuilding its binaries. That bounds what can ship alone:

| Changed since last tag | full | build_matrix | vsix | jetbrains | website |
| --- | --- | --- | --- | --- | --- |
| any `binary` path (cascade) | ✅ | ✅ | ✅ | ✅ | ✅ |
| any **unmatched** path (fail-safe) | ✅ | ✅ | ✅ | ✅ | ✅ |
| only `vsix` | — | ✅ | ✅ | — | — |
| only `jetbrains` | — | ✅ | — | ✅ | — |
| only `website` | — | — | — | — | ✅ |
| only `ignore` / nothing | — | — | — | — | — |

- `full` → publish everything (standalone binary release + Homebrew + Scoop + all
  extensions + website).
- `build_matrix` → the expensive native binary matrix must run.
- `vsix` / `jetbrains` / `website` → publish that surface.

Paths are matched in fixed priority order — `binary` → `vsix` → `jetbrains` →
`website` → `ignore` — and the first surface a path matches wins. A changed path
that matches **no** rule forces a full release (fail-safe): shipping too much
costs money once; shipping too little ships a stale or broken artifact.
