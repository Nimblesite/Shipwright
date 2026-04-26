# Deployment Toolkit Acceptance Gates

Status: Draft

These gates define what Nimblesite product repos must prove before they can claim deployment-toolkit compliance. The reusable libraries and workflows referenced here use generic package names.

## `verify-binaries`

Inputs:

- Product `deployment-toolkit.json`.
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

- Product `deployment-toolkit.json`.
- Extension artifact path, such as VSIX, JetBrains ZIP/JAR, or Zed package.
- Target platform id.

Required checks:

- The artifact contains `deployment-toolkit.json`.
- VSIX native binaries are under `bin/<platform>/<binaryName><exe>`.
- VSIX platform-agnostic binaries are under `bin/all/<binaryName>`.
- JetBrains plugin packages either omit native binaries or place explicitly allowed helpers under plugin-root `bin/<platform>`.
- Zed packages declare `lsp-initialize` for components that cannot be preflighted by subprocess.
- Package contents include only manifest-listed binaries for the target platform.

## `verify-extension-tests`

Inputs:

- Product test command for the IDE extension.
- Product `deployment-toolkit.json`.
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

The example workflow at `examples/ci/github-actions.yml` validates all golden manifests and proves invalid manifests fail. Product repos should add the generic validator package and then run product-specific binary/package checks after build.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm validate:manifest deployment-toolkit.json
deploy-toolkit verify-binaries --manifest deployment-toolkit.json --platform <target>
deploy-toolkit verify-extension-package --manifest deployment-toolkit.json --package <artifact> --platform <target>
```

## Tickets

- DTK-SPEC-ACCEPTANCE-VERIFY-BINARIES: Implement `deploy-toolkit verify-binaries` after the manifest validator is stable.
- DTK-SPEC-ACCEPTANCE-VERIFY-PACKAGE: Implement `deploy-toolkit verify-extension-package` after the first VSIX pilot ships.
