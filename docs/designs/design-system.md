# Shipwright Design System

```
Spec prefix: SWR-DESIGN-*
Status: Draft
Date: 2026-05-27
```

## [SWR-DESIGN-OVERVIEW] Overview

Shipwright is a portfolio-shared library that standardizes binary deployment and IDE-extension scaffolding across multiple downstream products. This document describes the system-level design: how the layers compose, where data flows, and which invariants each layer owns.

Products: Too Many Cooks, Deslop, Basilisk, Forge, dart_mutant.

---

## [SWR-DESIGN-LAYERS] Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Product Repos                         │
│  (too-many-cooks, deslop, basilisk, forge, dart_mutant) │
├─────────────────────────────────────────────────────────┤
│                  Host Libraries                         │
│  shipwright-vscode · shipwright-host · shipwright-zed   │
├─────────────────────────────────────────────────────────┤
│                   Core Libraries                        │
│  shipwright-core (TS) · shipwright-manifest (Rust)      │
├─────────────────────────────────────────────────────────┤
│                  Binary Libraries                       │
│  shipwright (Rust) · Shipwright (.NET) · shipwright-mcp │
├─────────────────────────────────────────────────────────┤
│                   Schemas & Tooling                     │
│  JSON schemas · validate-manifest · version-stamp       │
├─────────────────────────────────────────────────────────┤
│                   CI Templates                          │
│  publish-vsix-per-platform.yml · acceptance gates       │
└─────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Owns | Does NOT own |
|---|---|---|
| **Schemas & Tooling** | Manifest shape, platform ids, test vectors, validation CLI | Runtime behavior |
| **Binary Libraries** | `--version` contract, version stamping, JSON version output | Resolution, host integration |
| **Core Libraries** | Path construction, platform normalization, pure `resolve()` algorithm, shared types | I/O, IDE APIs |
| **Host Libraries** | IDE-specific activation, manifest loading, `--version` execution, diagnostics | Binary compilation, manifest authoring |
| **CI Templates** | Build matrix, binary staging, VSIX packaging, signing, publishing | Product-specific build steps |
| **Product Repos** | `shipwright.json`, product binaries, product-specific tests | Resolver algorithm, manifest schema |

---

## [SWR-DESIGN-DATA-FLOW] Data Flow

### Build time

```
Tag push
  → CI template stamps version into manifests
  → Rust/dotnet/node compile binaries
  → Binaries staged into bin/<platform>/
  → darwin-* binaries signed + notarized
  → vsce package --target <vsceTarget> per platform
  → VSIX content verified (SWR-GATE-VERIFY-EXT-PKG)
  → All VSIXs published in single job
```

### Runtime (IDE extension activation)

```
Extension activates
  → Load shipwright.json from extension root
  → For each required component:
      → Walk sources array (user-setting → env → bundled)
      → Injected probe executes --version (or protocol handshake for Zed)
      → Compare reported version against expectedVersion
  → All required components pass → start LSP/MCP/sidecar
  → Any failure → structured error notification, block activation
```

### Validation (CI gate)

```
Product CI
  → shipwright-validate-manifest shipwright.json
  → <binary> --version
  → <binary> --version --json
  → shipwright verify-binaries --manifest shipwright.json --platform <target>
  → shipwright verify-extension-package --manifest shipwright.json --package <artifact> --platform <target>
```

---

## [SWR-DESIGN-MANIFEST] Manifest as Single Source of Truth

`shipwright.json` is the central artifact. Every decision — what to bundle, what to verify, what version to expect, which platforms to target — derives from it.

```
shipwright.json
  ├── product.id, product.version
  ├── components[]
  │     ├── id, kind, language, binaryName
  │     ├── expectedVersion
  │     ├── required: bool
  │     ├── platforms[]
  │     ├── sources[] (resolution order)
  │     └── bundlePath (template for packaged location)
  └── manifestVersion (schema compatibility gate)
```

Schema source of truth: `schemas/shipwright.schema.json`.

Invariants:

- Every component `expectedVersion` matches the product `version` after stamping.
- Every `binaryName` resolves to exactly one file per platform after staging.
- `manifestVersion` gates host library compatibility — hosts reject unknown future versions.

---

## [SWR-DESIGN-RESOLUTION] Resolution Algorithm

The resolution algorithm lives in `shipwright-core` (TypeScript) and `shipwright-host` (Rust). Both implementations MUST pass `schemas/test-vectors.json`.

```
resolve(component, manifest, probe) → Result<ResolvedBinary, ResolutionError>

For each source in component.sources:
  candidate = buildPath(source, component, platform)
  probeResult = probe(candidate)     ← injected, no I/O in core
  if probeResult.version == expectedVersion:
    return Ok(ResolvedBinary { path, version, source })
  if probeResult.version != expectedVersion:
    return Err(VersionMismatch { expected, found, path, source })
  if probeResult == NotFound:
    continue

return Err(BinaryNotFound { component, searchedSources })
```

Design constraints:

- **Pure function.** No filesystem, network, or process spawning in the algorithm. The probe callback is injected by the host.
- **Source-ordered.** Products control their own cascade via the `sources` array. A self-contained extension uses `["user-setting", "bundled"]` and never falls back to PATH.
- **Fail on mismatch, don't fall through.** If a user-configured path points to a wrong version, stop and report — never silently try the next source.

---

## [SWR-DESIGN-PLATFORM] Platform Model

Platform ids are defined in `schemas/platforms.json` and map 1:1 to VS Code `vsceTarget` values.

| Platform id | OS | Arch | exe suffix | Runner |
|---|---|---|---|---|
| `darwin-arm64` | macOS | ARM64 | (none) | `macos-15` |
| `darwin-x64` | macOS | x64 | (none) | `macos-13` |
| `linux-x64` | Linux | x64 | (none) | `ubuntu-latest` |
| `linux-arm64` | Linux | ARM64 | (none) | `ubuntu-latest` |
| `win32-x64` | Windows | x64 | `.exe` | `windows-latest` |
| `win32-arm64` | Windows | ARM64 | `.exe` | `windows-latest` |
| `all` | Any | Any | (none) | Any single runner |

`all` is reserved for platform-agnostic components (pure Node, framework-dependent .NET). These live under `bin/all/` and produce fat VSIXs.

---

## [SWR-DESIGN-VERSION-CONTRACT] Version Contract

Every executable component implements the same contract regardless of language:

```
<binary> --version         → "<component-id> <semver>\n"    (mandatory)
<binary> --version --json  → { name, version, kind, ... }   (recommended)
Protocol handshake         → serverInfo.version == semver    (mandatory for servers)
```

Matching rules: strip leading `v`, compare full semver including pre-release, compare build metadata unless `ignoreBuildMetadata: true`.

Stamping: source control carries `0.0.0-dev`. Release CI stamps the tag version into every carrier (Cargo.toml, package.json, csproj, pubspec.yaml, shipwright.json) before compilation.

---

## [SWR-DESIGN-HOST-MATRIX] Host Integration Matrix

| Host | Library | Resolution | Verification | Bundling |
|---|---|---|---|---|
| VS Code | `@nimblesite/shipwright-vscode` | `resolve()` with `execFile` probe | `--version` before activation | Native binaries in `bin/<platform>/`, .NET in `bin/all/` |
| Zed | `shipwright-zed` (Rust) | `resolve()` with WASM-compatible probe | LSP `initialize` metadata | Download + cache (marketplace prevents bundling) |
| JetBrains | (planned) | `resolve()` with process probe | `--version` before LSP start | External binaries (marketplace limits) |
| CLI | `shipwright` (Rust/.NET) | Direct `--version` invocation | Exit code + output parsing | N/A |

All host libraries share the core resolution algorithm. The only host-specific code is the probe implementation and IDE API integration.

---

## [SWR-DESIGN-SIGNING] Signing and Notarization

Native binaries distributed to end users MUST be signed. macOS binaries MUST also be notarized.

```
Build binary
  → [darwin-*] codesign --sign "Developer ID Application: ..."
  → [darwin-*] notarytool submit → wait for Apple approval
  → [win32-*]  signtool sign /sha1 ... /fd sha256 /tr timestamp
  → Stage signed binary into bin/<platform>/
  → Package into VSIX
```

Unsigned binaries are blocked by Gatekeeper (macOS) and SmartScreen (Windows). Full spec: [binary-signing-notarization.md](../specs/binary-signing-notarization.md).

---

## [SWR-DESIGN-DOTNET-RUNTIME] .NET Runtime Acquisition

Extensions with framework-dependent .NET sidecars use Microsoft's `.NET Install Tool` extension — never require pre-installed .NET, never crash on missing runtime.

```
Extension activates
  → dotnet.findPath (check for existing runtime)
  → dotnet.acquire (install if missing, non-interactive toast)
  → Set DOTNET_ROOT in spawn env
  → Launch Rust LSP host (which spawns .NET sidecar)
  → On failure: degraded state + retry command
```

Mandatory dependency: `"extensionDependencies": ["ms-dotnettools.vscode-dotnet-runtime"]`.

Full spec: [ide-extension-deployment.md](../specs/ide-extension-deployment.md) [SWR-IDE-DOTNET-RUNTIME].

---

## [SWR-DESIGN-TESTING] Testing Strategy

### Schema and manifest validation

- `tools/validate-manifest/` — AJV validator against `schemas/shipwright.schema.json`.
- `tests/fixtures.test.mjs` — exercises every fixture in `fixtures/manifests/` and `fixtures/golden-manifests/`.
- `schemas/test-vectors.json` — canonical inputs and expected outputs for the resolution algorithm.

### Resolution algorithm

- `shipwright-host` (Rust) and `shipwright-core` (TS) both pass `schemas/test-vectors.json`.
- Tests cover: user-setting override, env override, bundled binary, missing binary, version mismatch, PATH rejection.

### Acceptance gates

Product repos run these gates before claiming Shipwright compliance:

| Gate | What it proves |
|---|---|
| `verify-binaries` | Every component resolves and reports the expected version |
| `verify-extension-package` | VSIX contains correct binaries at correct paths, no foreign platforms |
| `verify-extension-tests` | Tests use bundled binaries, not developer-machine fallbacks |

Full gate definitions: [acceptance-gates.md](../specs/acceptance-gates.md).

### Product integration tests

- Extension tests stage binaries inside the package, clear PATH, and assert `bundled` source.
- CI runs `shipwright-validate-manifest`, `--version`, and `--version --json` for every component.

---

## [SWR-DESIGN-INTEGRATION-PATH] Product Integration Path

```
1. Add binary library (shipwright / Shipwright / shipwright-mcp)
   → Binary now exposes --version contract

2. Create shipwright.json
   → Manifest declares components, platforms, sources, expected versions

3. Replace bespoke resolver with host library
   → shipwright-vscode / shipwright-host / shipwright-zed

4. Restructure release packaging
   → bin/<platform>/ layout, .vscodeignore, vsce package --target

5. Adopt CI template
   → publish-vsix-per-platform.yml or product-specific equivalent

6. Pass acceptance gates
   → verify-binaries, verify-extension-package, verify-extension-tests
```

---

## [SWR-DESIGN-INVARIANTS] System Invariants

1. **Schema is source of truth.** `schemas/shipwright.schema.json` defines manifest shape. Generated code consumes it — never the reverse.
2. **Resolution is pure.** `shipwright-host` and `shipwright-core` contain zero I/O. Probes are injected.
3. **One version, everywhere.** After stamping, every carrier (manifest, binary output, protocol handshake) reports the same semver.
4. **No silent fallback.** A mismatch stops resolution. A missing required component blocks activation.
5. **No PATH at startup.** VS Code native-binary extensions resolve from bundled or user-configured paths only. PATH/global-install is never a normal startup source.
6. **Templates are published interfaces.** `templates/gh-actions/` files ship as-is to downstream products. Breaking changes require a manifest version bump.
7. **Platform ids are vsceTarget values.** Directory names, matrix fields, and manifest entries all use the same string from `schemas/platforms.json`.
