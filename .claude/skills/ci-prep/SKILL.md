---
name: ci-prep
description: Prepares the current branch for CI by running the exact same steps locally and fixing issues. If CI is already failing, fetches the GH Actions logs first to diagnose. Use before pushing, when CI is red, or when the user says "fix ci".
argument-hint: "[--failing] [optional job name to focus on]"
---
<!-- agent-pmo:b636503 -->

# CI Prep

Prepare the current state for CI. If CI is already failing, fetch and analyze the logs first.

## Arguments

- `--failing` — Indicates a GitHub Actions run is already failing. When present, you MUST execute Step 1 before doing anything else.
- Any other argument is treated as a job name to focus on, but all failures are still reported.

If `--failing` is NOT passed, skip directly to Step 2.

## Step 1 — Fetch failed CI logs

You MUST do this before any other work when `--failing` is passed.

```bash
BRANCH=$(git branch --show-current)
PR_JSON=$(gh pr list --head "$BRANCH" --state open --json number,title,url --limit 1)
```

If the JSON array is empty, stop immediately:

> No open PR found for branch `$BRANCH`. Create a PR first.

Otherwise fetch the logs:

```bash
PR_NUMBER=$(echo "$PR_JSON" | jq -r '.[0].number')
gh pr checks "$PR_NUMBER"
RUN_ID=$(gh run list --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId')
gh run view "$RUN_ID"
gh run view "$RUN_ID" --log-failed
```

Read every line of `--log-failed` output. Note the exact file, line, command, and error message.

## Step 2 — Analyze the CI workflow

1. Read `.github/workflows/ci.yml` completely.
2. Extract the actual commands from every job. Shipwright currently has the standard `ci` job plus a protected TypeScript matrix job.
3. Standard job order is `make lint -> deslop . -> make test -> make build`.
4. The TypeScript matrix builds/tests `@nimblesite/shipwright-core`, `@nimblesite/shipwright-vscode`, `@nimblesite/shipwright-mcp`, and fixture validation on Linux and Windows.
5. Note toolchain setup that affects local reproduction: Rust stable with clippy/rustfmt/llvm-tools, Node 20, pnpm, .NET 9, Dart, and `cargo-llvm-cov`.

Do NOT assume CI still matches the list above; always read the live workflow first.

### Release workflow blocker scan

If `.github/workflows/release.yml` exists, scan it before broad local CI. Fix these blockers first:

- Tag-triggered jobs checking out `main` instead of the tag SHA.
- Any `git commit`, `git push`, branch mutation, or tag mutation during release.
- Version bump commits after the tag already exists.
- Ad hoc text stamping of structured version files instead of `tools/shipwright-version-stamp`.
- Missing tests that exercise the same stamper used by release.
- Native VSIX releases without Node 22.x, target-suffixed VSIX artifacts, and package-content verification.
- VS Code activation that reads or mutates PATH, uses package-manager/global installs as normal startup sources, or copies bundled VSIX binaries after install.

## Step 3 — Run each CI step locally, in order

Work through failures in this priority order:

1. Formatting: run `make fmt` only when formatting noise is blocking review.
2. Compilation: Rust, TypeScript, .NET, Dart, and website builds must compile before lint/test fixes.
3. Lint violations: fix the code pattern, never suppress.
4. Runtime/test failures: fix source code to satisfy the test.

Run the commands CI actually runs:

```bash
make lint
deslop .
make test
make build
pnpm --filter @nimblesite/shipwright-core build
pnpm --filter @nimblesite/shipwright-core test
pnpm --filter @nimblesite/shipwright-vscode build
pnpm --filter @nimblesite/shipwright-vscode test
pnpm --filter @nimblesite/shipwright-mcp test
node --test tests/fixtures.test.mjs
```

For each command:

1. Run it exactly as CI would run it, adjusting only for local setup actions.
2. If it fails, stop and fix the issue before continuing.
3. Re-run the same command until it passes.
4. Move to the next command only after the current command succeeds.

## Step 4 — Report

- List every step that was run and its result.
- If any step could not be fixed, report what failed and why.
- Confirm whether the branch is ready to push.

## Step 5 — Remote CI follow-up

When `--failing` was passed and all local steps pass:

1. Report the local fixes and exact commands that now pass.
2. Do not commit or push. The user owns source-control writes.
3. If the user pushes, monitor the new run until completion or failure.
4. Upon failure, go back to Step 1.

## Rules

- Always read the CI workflow first.
- Do not commit or push from this skill.
- Never skip steps or suppress errors.
- Never modify tests to make CI pass; fix source code or build configuration.
- If the workflow has multiple jobs, run all meaningful jobs in dependency order.
- Skip CI-infrastructure-only steps such as checkout, setup actions, cache, and artifact upload.

## Success criteria

- Every command that CI runs has been executed locally and passed.
- All fixes are applied to the working tree.
- If correcting an existing failure, the next CI run passes.
