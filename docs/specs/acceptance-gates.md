# Shipwright Acceptance Gates

```
Spec prefix: SWR-GATE-*
Status: Draft
```

These gates define what product repos must prove before they can claim Shipwright compliance.

## `verify-binaries`

Inputs:

- Product `shipwright.json`.
- Target platform id.
- Build output root or installed tool root.

Required checks:

- Every required executable component resolves from the configured source chain.
- Every resolved executable returns the manifest `expectedVersion` from `--version`.
- Every executable that supports JSON output conforms to `schemas/version-manifest.schema.json`.
- Protocol servers expose the same version through initialize metadata when their host requires it.
- Optional components can fail only when the manifest marks `"required": false`.

## `verify-extension-package`

Inputs:

- Product `shipwright.json`.
- Extension artifact path (VSIX, JetBrains ZIP/JAR, or Zed package).
- Target platform id.

Required checks:

- The artifact contains `shipwright.json`.
- VSIX native binaries are under `bin/<platform>/<binaryName><exe>`.
- VSIX platform-agnostic binaries are under `bin/all/<binaryName>`.
- JetBrains plugin packages either omit native binaries or place explicitly allowed helpers under plugin-root `bin/<platform>`.
- Zed packages declare `lsp-initialize` for components that cannot be preflighted by subprocess.
- Package contents include only manifest-listed binaries for the target platform.

## `verify-extension-tests`

Inputs:

- Product test command for the IDE extension.
- Product `shipwright.json`.
- Target platform id.

Required checks:

- The test command stages required binaries inside the extension bundle.
- Override variables for binary path and binary directory are cleared.
- Product binaries installed on PATH are removed or cause an immediate failure.
- Tests assert that every bundled required component resolves from `bundled`.
- Tests do not use build-output directories such as `target/release` as a resolver source.

## Startup Contract

Every host library must exercise these resolver cases:

- Configured exact binary path.
- Configured directory containing the binary.
- Environment path and directory overrides.
- Bundled binary.
- Package manager or dotnet/npm tool fallback.
- PATH fallback.
- Version mismatch.
- Missing binary.
- Required component failure.
- Optional component warning.

## CI Contract

Product repos must run at minimum:

```bash
shipwright-validate-manifest shipwright.json
<binary> --version
<binary> --version --json
```

When the full CLI is available, also run:

```bash
shipwright verify-binaries --manifest shipwright.json --platform <target>
shipwright verify-extension-package --manifest shipwright.json --package <artifact> --platform <target>
```
