#!/usr/bin/env python3
"""Coverage threshold enforcer. See REPO-STANDARDS-SPEC [COVERAGE-THRESHOLDS-JSON].

Usage: coverage_check.py <lcov.info> <coverage-thresholds.json>

Reads per-package thresholds (lines, functions, branches) from the JSON file
and validates each metric against the lcov.info data. Exits non-zero on any
threshold violation. Package key must match the crate/package directory name.
"""

import json
import sys
from pathlib import Path


def parse_lcov(path: str) -> dict[str, dict[str, float]]:
    """Parse lcov.info into per-package {lines_pct, functions_pct, branches_pct}."""
    packages: dict[str, dict[str, int]] = {}
    current: str | None = None

    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if line.startswith("SF:"):
            src = line[3:]
            # Package key = the directory that contains src/ (e.g. deploy-toolkit-manifest)
            p = Path(src)
            try:
                # Walk up until we find a part named "src" or "tests", then take its parent
                parts = p.parts
                src_idx = next(
                    (i for i, part in enumerate(parts) if part in ("src", "tests")),
                    None,
                )
                current = parts[src_idx - 1] if src_idx and src_idx > 0 else p.stem
            except (StopIteration, IndexError):
                current = p.stem
            if current not in packages:
                packages[current] = {"lh": 0, "lf": 0, "fnh": 0, "fnf": 0, "brh": 0, "brf": 0}
        elif line.startswith("LH:") and current:
            packages[current]["lh"] += int(line[3:])
        elif line.startswith("LF:") and current:
            packages[current]["lf"] += int(line[3:])
        elif line.startswith("FNH:") and current:
            packages[current]["fnh"] += int(line[4:])
        elif line.startswith("FNF:") and current:
            packages[current]["fnf"] += int(line[4:])
        elif line.startswith("BRH:") and current:
            packages[current]["brh"] += int(line[4:])
        elif line.startswith("BRF:") and current:
            packages[current]["brf"] += int(line[4:])

    def pct(hit: int, found: int) -> float:
        return round(hit / found * 100, 1) if found > 0 else 0.0

    return {
        pkg: {
            "lines": pct(v["lh"], v["lf"]),
            "functions": pct(v["fnh"], v["fnf"]),
            "branches": pct(v["brh"], v["brf"]),
        }
        for pkg, v in packages.items()
    }


def workspace_totals(lcov_path: str) -> dict[str, float]:
    """Compute workspace-level totals from lcov.info."""
    lh = lf = fnh = fnf = brh = brf = 0
    for raw in Path(lcov_path).read_text().splitlines():
        line = raw.strip()
        if line.startswith("LH:"):
            lh += int(line[3:])
        elif line.startswith("LF:"):
            lf += int(line[3:])
        elif line.startswith("FNH:"):
            fnh += int(line[4:])
        elif line.startswith("FNF:"):
            fnf += int(line[4:])
        elif line.startswith("BRH:"):
            brh += int(line[4:])
        elif line.startswith("BRF:"):
            brf += int(line[4:])

    def pct(hit: int, found: int) -> float:
        return round(hit / found * 100, 1) if found > 0 else 0.0

    return {
        "lines": pct(lh, lf),
        "functions": pct(fnh, fnf),
        "branches": pct(brh, brf),
    }


def main() -> int:
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <lcov.info> <coverage-thresholds.json>", file=sys.stderr)
        return 1

    lcov_path, thresholds_path = sys.argv[1], sys.argv[2]

    if not Path(lcov_path).exists():
        print(f"FAIL: {lcov_path} not found", file=sys.stderr)
        return 1
    if not Path(thresholds_path).exists():
        print(f"FAIL: {thresholds_path} not found", file=sys.stderr)
        return 1

    thresholds = json.loads(Path(thresholds_path).read_text())
    default_lines = float(thresholds.get("default_threshold", 0))
    pkg_thresholds: dict[str, dict[str, float]] = thresholds.get("packages", {})

    per_pkg = parse_lcov(lcov_path)
    workspace = workspace_totals(lcov_path)

    failures: list[str] = []

    # Per-package checks
    for pkg, limits in pkg_thresholds.items():
        measured = per_pkg.get(pkg)
        if measured is None:
            print(f"  WARN: {pkg} has thresholds but no coverage data in lcov.info")
            continue
        for metric, threshold in limits.items():
            actual = measured.get(metric, 0.0)
            status = "OK  " if actual >= threshold else "FAIL"
            print(f"  {status}  {pkg}:{metric} {actual}% (threshold {threshold}%)")
            if actual < threshold:
                failures.append(f"{pkg}:{metric} {actual}% < {threshold}%")

    # Workspace-level default lines check
    ws_lines = workspace["lines"]
    ws_status = "OK  " if ws_lines >= default_lines else "FAIL"
    print(f"  {ws_status}  workspace:lines {ws_lines}% (threshold {default_lines}%)")
    if ws_lines < default_lines:
        failures.append(f"workspace:lines {ws_lines}% < {default_lines}%")

    if failures:
        print(f"\nCoverage check FAILED: {len(failures)} violation(s):")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"\nAll coverage thresholds passed. Workspace lines: {ws_lines}%")
    return 0


if __name__ == "__main__":
    sys.exit(main())
