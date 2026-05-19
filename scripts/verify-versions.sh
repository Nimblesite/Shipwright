#!/usr/bin/env bash
# DTK-REL-VERSION-VERIFY — assert every manifest agrees with the expected version.
# Usage: verify-versions.sh <version>  (e.g. verify-versions.sh 1.2.3)
set -euo pipefail

EXPECTED="${1:?Usage: $0 <version>}"
ERRORS=0

fail() {
    echo "FAIL: $1" >&2
    ERRORS=$((ERRORS + 1))
}

check() {
    local label="$1" actual="$2"
    if [ "$actual" = "$EXPECTED" ]; then
        echo "OK:   $label = $actual"
    else
        fail "$label: expected '$EXPECTED', got '$actual'"
    fi
}

# 1. Cargo workspace
cargo_version=$(grep '^version = ' Cargo.toml | head -1 | sed 's/version = "\(.*\)"/\1/')
check "Cargo.toml [workspace.package] version" "$cargo_version"

# 2. Every package.json (excluding node_modules/ and target/)
while IFS= read -r pkg; do
    ver=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$pkg','utf8')).version)")
    check "$pkg" "$ver"
done < <(find . -name "package.json" \
    -not -path "*/node_modules/*" \
    -not -path "*/target/*" \
    -not -path "*/.git/*")

# 3. Every *.csproj
while IFS= read -r csproj; do
    ver=$(grep '<Version>' "$csproj" | sed 's/.*<Version>\(.*\)<\/Version>.*/\1/' | tr -d '[:space:]')
    check "$csproj" "$ver"
done < <(find . -name "*.csproj" -not -path "*/.git/*")

# 4. Every pubspec.yaml
while IFS= read -r pubspec; do
    ver=$(grep '^version:' "$pubspec" | sed 's/version: *//' | tr -d '[:space:]')
    check "$pubspec" "$ver"
done < <(find . -name "pubspec.yaml" -not -path "*/.git/*")

# 5. build.gradle.kts
gradle_kts="clients/kotlin/shipwright-intellij/build.gradle.kts"
if [ -f "$gradle_kts" ]; then
    ver=$(grep '^version = ' "$gradle_kts" | sed 's/version = "\(.*\)"/\1/' | tr -d '[:space:]')
    check "$gradle_kts" "$ver"
fi

if [ "$ERRORS" -gt 0 ]; then
    echo "" >&2
    echo "Version check FAILED: $ERRORS mismatch(es) found." >&2
    exit 1
fi

echo ""
echo "All versions match $EXPECTED."
