---
name: code-dedup
description: Searches for duplicate code, duplicate tests, and dead code, then safely merges or removes them. Use when the user says "deduplicate", "find duplicates", "remove dead code", "DRY up", or "code dedup". Requires test coverage — refuses to touch untested code.
---
<!-- agent-pmo:b636503 -->

# Code Dedup

Find duplicate code, duplicate tests, and dead code across Shipwright. Merge duplicates and delete dead code only when tests and coverage prove the change is safe.

## Prerequisites — hard gate

Stop and report if any of these fail:

1. Run `make test`. It is fail-fast and enforces `coverage-thresholds.json`.
2. Confirm static typing is active for the files you will touch: Rust/C#/Dart/Kotlin are typed by default; TypeScript must pass strict `tsc`.
3. Confirm Deslop MCP or CLI is available for Rust, C#, and Dart. TypeScript/Kotlin findings are fallback-only and must be labelled `(no-deslop fallback)`.

## Required tooling — Deslop

Use Deslop for supported languages: Rust, C#, Dart. Do not substitute grep for structural duplicate detection in those languages.

Preferred MCP tools:

- `mcp__deslop__top-offenders`
- `mcp__deslop__report-query`
- `mcp__deslop__cluster-by-id`
- `mcp__deslop__report-for-file` / `report-for-range`
- `mcp__deslop__find-similar`
- `mcp__deslop__rescan`

CLI fallback:

```bash
deslop .
deslop . --no-fail-over
```

Parse only `deslop-report.json`. Cite every acted-on cluster by ID, bucket, score/fused value, and occurrence list.

## Steps

```
Dedup Progress:
- [ ] Step 1: Prerequisites passed
- [ ] Step 2: Dead code scan complete
- [ ] Step 3: Duplicate code scan complete via Deslop where supported
- [ ] Step 4: Duplicate test scan complete
- [ ] Step 5: Changes applied one at a time
- [ ] Step 6: Verification passed
```

### Step 1 — Inventory coverage

Record the green baseline from `make test`. Only files with coverage are candidates.

### Step 2 — Scan for dead code

Use the language analyzer first: `cargo clippy`, TypeScript `tsc --noEmit`, `dotnet build -warnaserror`, `dart analyze`, and Gradle diagnostics. For each candidate, search the whole repo before deleting.

### Step 3 — Scan duplicate code

1. MCP: run `top-offenders`, then query `identical`, `nearly_identical`, and `loosely_similar`.
2. CLI: run `deslop .` and inspect `deslop-report.json`.
3. Read every occurrence for a cluster before deciding.
4. Record decision and rationale before editing.

### Step 4 — Scan duplicate tests

Repeat Step 3 for test paths: `tests`, `test`, `Tests`, `.test.ts`, `_test.rs`, `_test.dart`, and `ConformanceTests.cs`.

### Step 5 — Apply changes

Work one change at a time:

1. Call `find-similar` before writing replacement code.
2. Merge/delete the smallest safe unit.
3. Run `make test`.
4. Run `rescan` or `deslop .` to confirm the targeted cluster is gone.
5. Revert the change if tests fail or coverage drops.

### Step 6 — Final verification

Run:

```bash
make lint
make test
deslop .
```

Report every acted-on cluster, final coverage, and the remaining top offenders.

## Rules

- Deslop is mandatory for Rust/C#/Dart duplicate scanning.
- Unsupported language findings must be labelled `(no-deslop fallback)`.
- No coverage means no dedup.
- Coverage must not drop.
- One change at a time.
- Preserve public APIs and release templates.
- Trivial duplication is fine; focus on substantial shared logic or 3+ copies.
