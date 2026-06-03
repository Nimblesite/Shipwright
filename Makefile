# agent-pmo:f481f8d
# =============================================================================
# Standard Makefile — Shipwright
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
  PYTHON = python
else
  RM = rm -rf
  MKDIR = mkdir -p
  PYTHON = python3
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
	npm --prefix tools/validate-manifest install --no-audit --no-fund

## test: Fail-fast tests + coverage + threshold enforcement.
##       See REPO-STANDARDS-SPEC [TEST-RULES] and [COVERAGE-THRESHOLDS-JSON].
test:
	@echo "==> Testing (fail-fast + coverage + threshold)..."
	-@rustup component add llvm-tools-preview
	# Stable cargo test is fail-fast at the binary level by default (omits
	# --no-fail-fast). Per-test --fail-fast requires nightly -Z unstable-options;
	# install cargo-nextest for true intra-binary fail-fast on stable.
	cargo llvm-cov --workspace --all-targets --lcov --output-path lcov.info
	npm --prefix tools/validate-manifest install --no-audit --no-fund
	node --test tests/fixtures.test.mjs
	$(MAKE) _coverage_check

## lint: Run all linters/analyzers (read-only). Does NOT format.
lint:
	@echo "==> Linting Rust..."
	cargo clippy --release --all-targets --workspace -- -D warnings
	@echo "==> Validating JSON schemas + manifests..."
	npm --prefix tools/validate-manifest install --no-audit --no-fund
	node tools/validate-manifest/index.mjs fixtures/manifests

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
	-@rustup component add llvm-tools-preview clippy rustfmt
	-@cargo install cargo-llvm-cov --locked
	npm --prefix tools/validate-manifest install --no-audit --no-fund
	@echo "==> Setup complete. Run 'make ci' to validate."

# =============================================================================
# Internal recipes (NOT public targets — never invoke directly)
# =============================================================================

_coverage_check:
	@$(PYTHON) scripts/coverage_check.py lcov.info $(COVERAGE_THRESHOLDS_FILE)

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
	@echo "Repo-specific targets:"
	@echo "  deploy-skill-claude - Install shipwright-compliance skill to ~/.claude/skills/"

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

.PHONY: build-crates build-npm build-nuget build-dart deploy-skill-claude test-vsix

## test-vsix: Run VS Code extension E2E tests
test-vsix:
	@echo "==> Testing VS Code extension (E2E)..."
	cd extensions/shipwright-tools && npm install --no-audit --no-fund && npm test

## build-crates: Compile the Rust workspace in release mode
build-crates:
	cargo build --release --workspace

## build-npm: Install deps, build and pack all TypeScript packages to dist/npm/
build-npm:
	$(RM) dist/npm
	$(MKDIR) dist/npm
	pnpm install --frozen-lockfile
	pnpm --filter @nimblesite/shipwright-core build
	pnpm --filter @nimblesite/shipwright-mcp build
	pnpm --filter @nimblesite/shipwright-vscode build
	cd clients/ts/packages/shipwright-core && pnpm pack && mv *.tgz ../../../../dist/npm/
	cd clients/ts/packages/shipwright-mcp && pnpm pack && mv *.tgz ../../../../dist/npm/
	cd clients/ts/packages/shipwright-vscode && pnpm pack && mv *.tgz ../../../../dist/npm/
	cd tools/validate-manifest && npm pack && mv *.tgz ../../dist/npm/
	ls dist/npm/

## build-nuget: Pack the Shipwright NuGet package (output → ./nupkg)
build-nuget:
	dotnet pack clients/dotnet/Shipwright/Shipwright.csproj \
		-c Release -o ./nupkg --include-symbols

## build-dart: Validate the Dart package (pub get + analyze)
build-dart:
	cd clients/dart/shipwright && dart pub get && dart analyze

## deploy-skill-claude: Install the shipwright-compliance skill (SKILL.md + reference/) into ~/.claude/skills/
deploy-skill-claude:
ifeq ($(OS),Windows_NT)
	$(RM) "$(HOME)\.claude\skills\shipwright-audit"
	$(RM) "$(HOME)\.claude\skills\shipwright-compliance"
	$(MKDIR) "$(HOME)\.claude\skills\shipwright-compliance"
	Copy-Item -Recurse -Force "docs\agents\shipwright-compliance\*" "$(HOME)\.claude\skills\shipwright-compliance\"
else
	$(RM) "$(HOME)/.claude/skills/shipwright-audit"
	$(RM) "$(HOME)/.claude/skills/shipwright-compliance"
	$(MKDIR) "$(HOME)/.claude/skills/shipwright-compliance"
	cp -R docs/agents/shipwright-compliance/. "$(HOME)/.claude/skills/shipwright-compliance/"
endif
	@echo "==> shipwright-compliance skill installed to ~/.claude/skills/. Restart Claude Code if it was already running."
