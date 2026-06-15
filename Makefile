# agent-pmo:b636503
# =============================================================================
# Standard Makefile — Shipwright
# Cross-platform: Linux, macOS, Windows (via GNU Make)
# Multi-language: Rust, TypeScript/Node, Dart, C#/.NET, Kotlin/Gradle, Eleventy.
# =============================================================================

.PHONY: build test lint fmt clean ci setup

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

## build: Compile/assemble artifacts
build:
	@echo "==> Building Rust workspace..."
	cargo build --release --workspace
	@echo "==> Building TypeScript workspace packages..."
	pnpm install --frozen-lockfile
	pnpm --filter @nimblesite/shipwright-core build
	pnpm --filter @nimblesite/shipwright-mcp build
	pnpm --filter @nimblesite/shipwright-vscode build
	@echo "==> Building VS Code extension..."
	npm --prefix extensions/shipwright-tools install --no-audit --no-fund
	npm --prefix extensions/shipwright-tools run build
	@echo "==> Building .NET package project..."
	dotnet build clients/dotnet/Shipwright/Shipwright.csproj -c Release
	@echo "==> Resolving Dart package..."
	cd clients/dart/shipwright && dart pub get
	@echo "==> Building website..."
	cd website && pnpm install --frozen-lockfile --ignore-workspace && pnpm run build

## test: Fail-fast tests + coverage + threshold enforcement.
##       See REPO-STANDARDS-SPEC [TEST-RULES] and [COVERAGE-THRESHOLDS-JSON].
test:
	@echo "==> Testing (fail-fast + coverage + threshold)..."
	-@rustup component add llvm-tools-preview
	cargo llvm-cov --workspace --all-targets --lcov --output-path lcov.info
	pnpm install --frozen-lockfile
	pnpm --filter @nimblesite/shipwright-core test -- --bail=1
	pnpm --filter @nimblesite/shipwright-mcp test -- --bail=1
	pnpm --filter @nimblesite/shipwright-vscode test -- --bail=1
	node --test tests/fixtures.test.mjs
	dotnet test clients/dotnet/Shipwright.Tests/Shipwright.Tests.csproj \
		-c Release \
		--settings coverlet.runsettings \
		--collect:"XPlat Code Coverage" \
		--results-directory TestResults \
		--verbosity normal \
		-- xunit.stopOnFail=true
	cd clients/dart/shipwright && dart test --fail-fast
	$(MAKE) _coverage_check

## lint: Run all linters/analyzers (read-only). Does NOT format.
lint:
	@echo "==> Linting Rust..."
	cargo clippy --release --all-targets --workspace -- -D warnings
	@echo "==> Type-checking TypeScript workspace packages..."
	pnpm install --frozen-lockfile
	pnpm --filter @nimblesite/shipwright-core typecheck
	pnpm --filter @nimblesite/shipwright-mcp typecheck
	pnpm --filter @nimblesite/shipwright-vscode typecheck
	@echo "==> Type-checking VS Code extension..."
	npm --prefix extensions/shipwright-tools install --no-audit --no-fund
	npm --prefix extensions/shipwright-tools run lint
	@echo "==> Analyzing Dart..."
	cd clients/dart/shipwright && dart pub get && dart analyze
	@echo "==> Building .NET with warnings as errors..."
	dotnet build clients/dotnet/Shipwright/Shipwright.csproj -c Release -warnaserror
	@echo "==> Validating JSON schemas + manifests..."
	npm --prefix tools/validate-manifest install --no-audit --no-fund
	node tools/validate-manifest/index.mjs fixtures/manifests

## fmt: Format all code in-place. Pass CHECK=1 for read-only check.
fmt:
	@echo "==> Formatting Rust$(if $(CHECK), (check mode),)..."
	cargo fmt --all$(if $(CHECK), -- --check,)
	@echo "==> Formatting TypeScript/JavaScript/JSON$(if $(CHECK), (check mode),)..."
	pnpm install --frozen-lockfile
	pnpm exec prettier $(if $(CHECK),--check,--write) \
		"package.json" \
		"clients/ts/packages/**/*.{ts,json}" \
		"extensions/shipwright-tools/**/*.{ts,json,js,mjs,css}" \
		"tools/validate-manifest/**/*.{mjs,json}" \
		"website/**/*.{js,json,css,md}"
	@echo "==> Formatting Dart$(if $(CHECK), (check mode),)..."
	cd clients/dart/shipwright && dart format $(if $(CHECK),--set-exit-if-changed ,).

## clean: Remove build artifacts
clean:
	@echo "==> Cleaning..."
	cargo clean
	$(RM) lcov.info target/llvm-cov coverage TestResults dist nupkg
	$(RM) clients/ts/packages/shipwright-core/dist
	$(RM) clients/ts/packages/shipwright-mcp/dist
	$(RM) clients/ts/packages/shipwright-vscode/dist
	$(RM) extensions/shipwright-tools/dist extensions/shipwright-tools/out
	$(RM) website/_site

## ci: lint + test + build (full CI simulation)
ci: lint test build

## setup: Post-create dev environment setup
setup:
	@echo "==> Setting up development environment..."
	-@rustup component add llvm-tools-preview clippy rustfmt
	-@cargo install cargo-llvm-cov --locked
	pnpm install --frozen-lockfile
	npm --prefix tools/validate-manifest install --no-audit --no-fund
	npm --prefix extensions/shipwright-tools install --no-audit --no-fund
	dotnet restore clients/dotnet/Shipwright.Tests/Shipwright.Tests.csproj
	cd clients/dart/shipwright && dart pub get
	cd website && pnpm install --frozen-lockfile --ignore-workspace
	@echo "==> Setup complete. Run 'make ci' to validate."

# =============================================================================
# Internal recipes (NOT public targets — never invoke directly)
# =============================================================================

_coverage_check:
	@if [ ! -f "$(COVERAGE_THRESHOLDS_FILE)" ]; then echo "FAIL: $(COVERAGE_THRESHOLDS_FILE) not found"; exit 1; fi; \
	if ! command -v jq >/dev/null 2>&1; then echo "FAIL: jq is required for coverage checks"; exit 1; fi; \
	if [ ! -f lcov.info ]; then echo "FAIL: lcov.info not found"; exit 1; fi; \
	THRESHOLD=$$(jq -r '.default_threshold' "$(COVERAGE_THRESHOLDS_FILE)"); \
	LH=$$(grep '^LH:' lcov.info | awk -F: '{sum+=$$2} END{print sum+0}'); \
	LF=$$(grep '^LF:' lcov.info | awk -F: '{sum+=$$2} END{print sum+0}'); \
	if [ "$$LF" -eq 0 ]; then echo "FAIL: No lines in lcov.info"; exit 1; fi; \
	PCT=$$(awk "BEGIN{printf \"%.1f\", $$LH/$$LF*100}"); \
	PCT_INT=$$(awk "BEGIN{printf \"%d\", $$LH/$$LF*100}"); \
	echo "Line coverage: $${PCT}% (threshold: $${THRESHOLD}%)"; \
	if [ "$$PCT_INT" -lt "$${THRESHOLD}" ]; then echo "FAIL: $${PCT}% < $${THRESHOLD}%"; exit 1; fi; \
	jq -r '.projects // {} | to_entries[] | "\(.key)|\(.value.threshold // .value)"' "$(COVERAGE_THRESHOLDS_FILE)" | while IFS='|' read -r PROJECT PROJECT_THRESHOLD; do \
	  [ -z "$$PROJECT" ] && continue; \
	  PROJECT_TOTALS=$$(awk -v project="$$PROJECT" 'BEGIN{lh=0;lf=0;active=0} /^SF:/ {active=index($$0, project)>0} active && /^LH:/ {lh+=$$2} active && /^LF:/ {lf+=$$2} END{print lh ":" lf}' FS=':' lcov.info); \
	  PROJECT_LH=$${PROJECT_TOTALS%%:*}; PROJECT_LF=$${PROJECT_TOTALS##*:}; \
	  if [ "$$PROJECT_LF" -eq 0 ]; then echo "FAIL: $$PROJECT has no coverage data in lcov.info"; exit 1; fi; \
	  PROJECT_PCT=$$(awk "BEGIN{printf \"%.1f\", $$PROJECT_LH/$$PROJECT_LF*100}"); \
	  PROJECT_PCT_INT=$$(awk "BEGIN{printf \"%d\", $$PROJECT_LH/$$PROJECT_LF*100}"); \
	  echo "$$PROJECT line coverage: $${PROJECT_PCT}% (threshold: $${PROJECT_THRESHOLD}%)"; \
	  if [ "$$PROJECT_PCT_INT" -lt "$${PROJECT_THRESHOLD}" ]; then echo "FAIL: $$PROJECT $${PROJECT_PCT}% < $${PROJECT_THRESHOLD}%"; exit 1; fi; \
	done

# =============================================================================
# Repo-Specific Targets
#
# Targets below this line are specific to this repo and are NOT part of the
# standard 7-target interface. They do not shadow the standard targets above.
# =============================================================================

.PHONY: build-crates build-npm build-nuget build-dart deploy-skill-claude test-vsix rebuild-install-vsix

## test-vsix: Run VS Code extension E2E tests
test-vsix:
	@echo "==> Testing VS Code extension (E2E)..."
	cd extensions/shipwright-tools && npm install --no-audit --no-fund && npm test

## rebuild-install-vsix: Clean, package, and locally install the VS Code extension
rebuild-install-vsix: _vsix_uninstall _vsix_clean _vsix_build _vsix_package _vsix_install

_vsix_uninstall:
	-@code --uninstall-extension nimblesite.shipwright-tools

_vsix_clean:
	$(RM) extensions/shipwright-tools/dist extensions/shipwright-tools/out extensions/shipwright-tools/*.vsix

_vsix_build:
	npm --prefix extensions/shipwright-tools install --no-audit --no-fund
	npm --prefix extensions/shipwright-tools run build

_vsix_package:
	npm --prefix extensions/shipwright-tools run package

_vsix_install:
	code --install-extension extensions/shipwright-tools/*.vsix

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

## build-nuget: Pack the Shipwright NuGet package (output -> ./nupkg)
build-nuget:
	dotnet pack clients/dotnet/Shipwright/Shipwright.csproj \
		-c Release -o ./nupkg --include-symbols

## build-dart: Validate the Dart package (pub get + analyze)
build-dart:
	cd clients/dart/shipwright && dart pub get && dart analyze

## deploy-skill-claude: Install the shipwright-compliance skill into ~/.claude/skills/
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
