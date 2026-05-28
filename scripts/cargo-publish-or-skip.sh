#!/usr/bin/env bash
# SWR-REL-CRATES — publish a workspace crate to crates.io, treating
# "already uploaded" as success so the release workflow is idempotent
# across reruns. See docs/plans/release-pipeline.md §3 for ordering.
#
# --allow-dirty is required: shipwright-version-stamp injects the release
# version into the working tree (Cargo.toml/Cargo.lock) at release time
# WITHOUT committing — source keeps the 0.0.0-dev placeholder
# (SWR-VERSION-BUILD-STAMPING) — so the tree is intentionally dirty here.
set -uo pipefail

crate="${1:?usage: $0 <crate-name>}"

output=$(cargo publish --locked --allow-dirty -p "$crate" 2>&1)
code=$?
printf '%s\n' "$output"

if [ "$code" -ne 0 ] && printf '%s' "$output" | grep -qE 'is already uploaded|already exists'; then
    printf '::notice::%s at this version is already on crates.io — skipping\n' "$crate"
    exit 0
fi
exit "$code"
