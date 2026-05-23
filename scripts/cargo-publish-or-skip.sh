#!/usr/bin/env bash
# SWR-REL-CRATES — publish a workspace crate to crates.io, treating
# "already uploaded" as success so the release workflow is idempotent
# across reruns. See docs/plans/release-pipeline.md §3 for ordering.
set -uo pipefail

crate="${1:?usage: $0 <crate-name>}"

output=$(cargo publish --locked -p "$crate" 2>&1)
code=$?
printf '%s\n' "$output"

if [ "$code" -ne 0 ] && printf '%s' "$output" | grep -q 'is already uploaded'; then
    printf '::notice::%s at this version is already on crates.io — skipping\n' "$crate"
    exit 0
fi
exit "$code"
