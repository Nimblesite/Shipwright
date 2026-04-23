# agent-pmo:f481f8d
# =============================================================================
# Standard Makefile — deployment_toolkit
# Cross-platform: Linux, macOS, Windows (via GNU Make)
# Multi-language: Rust workspace (crates/) + Node tooling (tools/, tests/).
# =============================================================================

.PHONY: build test lint fmt clean ci setup help

# ---------------------------------------------------------------------------
# OS Detection
# ---------------------------------------------------------------------------
ifeq ($(OS),Windows_NT)
  SHELL := powershell.exe
  .SHELLFLAGS := -NoProfile -Command
  RM = Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  MKDIR = New-Item -ItemType Directory -Force
  HOME ?= $(USERPROFILE)
else
  RM = rm -rf
  MKDIR = mkdir -p
endif

# ---------------------------------------------------------------------------
# Coverage — single source of truth is coverage-thresholds.json
# See REPO-STANDARDS-SPEC [COVERAGE-THRESHOLDS-JSON].
# ---------------------------------------------------------------------------
COVERAGE_THRESHOLDS_FILE := coverage-thresholds.json

# =============================================================================
# Standard Targets
#
# These 7 targets are portfolio-wide and identical across every repo.
# Do NOT add extra public targets here — put them in the Repo-Specific
# Targets section at the bottom of this file.
# See REPO-STANDARDS-SPEC [MAKE-TARGETS].
# =============================================================================

## build: Compile/assemble all artifacts (Rust workspace + Node tools)
build:
	@echo "==> Building Rust workspace..."
	cargo build --release --workspace
	@echo "==> Installing Node tooling deps..."
	cd tools/validate-manifest && npm install --no-audit --no-fund

## test: Fail-fast tests + coverage + threshold enforcement.
##       See REPO-STANDARDS-SPEC [TEST-RULES] and [COVERAGE-THRESHOLDS-JSON].
test:
	@echo "==> Testing (fail-fast + coverage + threshold)..."
	rustup component add llvm-tools-preview 2>/dev/null || true
	# Stable cargo test is fail-fast at the binary level by default (omits
	# --no-fail-fast). Per-test --fail-fast requires nightly -Z unstable-options;
	# install cargo-nextest for true intra-binary fail-fast on stable.
	cargo llvm-cov --workspace --all-targets --lcov --output-path lcov.info
	cd tools/validate-manifest && npm install --no-audit --no-fund
	node --test tests/fixtures.test.mjs
	$(MAKE) _coverage_check

## lint: Run all linters/analyzers (read-only). Does NOT format.
lint:
	@echo "==> Linting Rust..."
	cargo clippy --release --all-targets --workspace -- -D warnings
	@echo "==> Validating JSON schemas + manifests..."
	cd tools/validate-manifest && npm install --no-audit --no-fund
	node tools/validate-manifest/index.mjs fixtures/manifests fixtures/golden-manifests

## fmt: Format all code in-place. Pass CHECK=1 for read-only check (CI use).
fmt:
	@echo "==> Formatting Rust$(if $(CHECK), (check mode),)..."
	cargo fmt --all$(if $(CHECK), -- --check,)

## clean: Remove all build artifacts
clean:
	@echo "==> Cleaning..."
	cargo clean
	$(RM) lcov.info target/llvm-cov tools/validate-manifest/node_modules

## ci: lint + test + build (full CI simulation)
ci: lint test build

## setup: Post-create dev environment setup (used by devcontainer)
setup:
	@echo "==> Setting up development environment..."
	rustup component add llvm-tools-preview clippy rustfmt 2>/dev/null || true
	cargo install cargo-llvm-cov --locked 2>/dev/null || true
	cd tools/validate-manifest && npm install --no-audit --no-fund
	@echo "==> Setup complete. Run 'make ci' to validate."

# =============================================================================
# Internal recipes (NOT public targets — never invoke directly)
# =============================================================================

_coverage_check:
	@if [ ! -f "$(COVERAGE_THRESHOLDS_FILE)" ]; then echo "FAIL: $(COVERAGE_THRESHOLDS_FILE) not found"; exit 1; fi; \
	THRESHOLD=$$(jq -r '.default_threshold' "$(COVERAGE_THRESHOLDS_FILE)"); \
	LH=$$(grep '^LH:' lcov.info | awk -F: '{sum+=$$2} END{print sum+0}'); \
	LF=$$(grep '^LF:' lcov.info | awk -F: '{sum+=$$2} END{print sum+0}'); \
	if [ "$$LF" -eq 0 ]; then echo "FAIL: No lines in lcov.info"; exit 1; fi; \
	PCT=$$(awk "BEGIN{printf \"%.1f\", $$LH/$$LF*100}"); \
	PCT_INT=$$(awk "BEGIN{printf \"%d\", $$LH/$$LF*100}"); \
	echo "Line coverage: $${PCT}% (threshold: $${THRESHOLD}%)"; \
	if [ "$$PCT_INT" -lt "$${THRESHOLD}" ]; then \
	  echo "FAIL: $${PCT}% < $${THRESHOLD}%"; exit 1; \
	else \
	  echo "OK: $${PCT}% >= $${THRESHOLD}%"; \
	fi

## help: List all available targets
help:
	@echo "Standard targets:"
	@echo "  build  - Compile/assemble all artifacts"
	@echo "  test   - Fail-fast tests + coverage + threshold enforcement"
	@echo "  lint   - All linters/analyzers (read-only, no formatting)"
	@echo "  fmt    - Format all code in-place (CHECK=1 for read-only CI check)"
	@echo "  clean  - Remove build artifacts"
	@echo "  ci     - lint + test + build (full CI simulation)"
	@echo "  setup  - Post-create dev environment setup"

# =============================================================================
# Repo-Specific Targets
#
# Targets below this line are specific to this repo and are NOT part of the
# standard 7-target interface. Add repo-specific helpers here.
#
# Rules:
#   - MUST NOT duplicate or shadow any of the 7 standard targets above.
#   - Add them to .PHONY if they are phony.
# =============================================================================
