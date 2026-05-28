# Supply Chain Security Spec

```
Spec prefix: SWR-SEC-*
Status: Draft
Date: 2026-05-27
```

## [SWR-SEC-PURPOSE] Purpose

Shipwright is a secure supply-chain contract for IDE extensions and developer-tool binaries.
It prevents packaged products from launching unverified, mismatched, or unintended executables.

## [SWR-SEC-THREATS] Threats

- A stale global binary on PATH shadows the bundled binary.
- A VSIX contains the wrong platform binary or extra executable.
- A release stamps one version into the package and another into the binary.
- A user override points at a malicious or incompatible executable.
- An unsigned native binary is blocked or tampered with after build.

## [SWR-SEC-CONTROLS] Controls

| Risk | Shipwright control | Source |
|---|---|---|
| Hidden binary substitution | Bundled or explicit sources only; no normal PATH fallback | [IDE Extension Deployment](ide-extension-deployment.md) |
| Version drift | `shipwright.json`, `--version`, and protocol handshakes must match | [Binary Version Contract](binary-version-contract.md) |
| Package tampering | Artifact contents are verified against the manifest and target platform | [Acceptance Gates](acceptance-gates.md) |
| Runtime mismatch | Resolver stops on mismatch instead of falling through | [Design System](../designs/design-system.md) |
| Native trust failure | macOS signing/notarization and Windows signing policy are explicit | [Binary Signing and Notarization](binary-signing-notarization.md) |

## [SWR-SEC-POSITIONING] Positioning

Shipwright does not replace package registries, code signing, SBOMs, or malware scanning.
It closes the IDE-tooling gap between "installed" and "safe to execute".
