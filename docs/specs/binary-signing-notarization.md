# Binary Signing and Notarization Spec

```
Spec prefix: SWR-SIGN-*
Status: Draft
Date: 2026-05-01
```

## [SWR-SIGN-PURPOSE] Purpose

This spec defines the mandatory code-signing and notarization pipeline for all native binaries
distributed by Nimblesite products. Unsigned or unnotarized binaries will be blocked by OS
security mechanisms — Gatekeeper on macOS, SmartScreen on Windows — producing a broken user
experience. Signing is not optional.

**Default rule: every binary distributed to end users MUST be signed and, on macOS,
notarized before upload.** This applies to all products that consume Shipwright
(`too-many-cooks`, `Deslop`, `Basilisk`, `forge`, `dart_mutant`) and to Shipwright's own
`shipwright-version-stamp` binary.

---

## [SWR-SIGN-REFS] External References

Read these before writing any signing or CI code. Pages marked AUTHORITATIVE define the
canonical behavior; everything else is supplementary.

### Apple

- **AUTHORITATIVE** — Developer ID overview (signing + notarization together):
  https://developer.apple.com/developer-id/
- **AUTHORITATIVE** — Developer ID support (cert lifecycle, revocation, provisioning profiles):
  https://developer.apple.com/support/developer-id/
- **AUTHORITATIVE** — Notarizing macOS software before distribution (end-to-end walkthrough):
  https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- **AUTHORITATIVE** — Customizing the notarization workflow (`notarytool` CLI, CI, API key auth):
  https://developer.apple.com/documentation/security/customizing-the-notarization-workflow
- **AUTHORITATIVE** — Resolving common notarization issues:
  https://developer.apple.com/documentation/security/resolving-common-notarization-issues
- **AUTHORITATIVE** — Hardened Runtime:
  https://developer.apple.com/documentation/security/hardened-runtime
- **AUTHORITATIVE** — Entitlements reference:
  https://developer.apple.com/documentation/bundleresources/entitlements
- **Conceptual** — WWDC 2019 "All About Notarization" (concepts unchanged, `notarytool` syntax
  differs): https://developer.apple.com/videos/play/wwdc2019/703/
- **Community** — Quinn "The Eskimo!" notarization posts on Apple Developer Forums
  (search `notarisation` filtered by author "eskimo"):
  https://developer.apple.com/forums/

> **Stale-content warning:** Apple docs are split between the legacy "Code Signing Guide" and
> the current Security framework docs. Any page or guide that references `altool` is stale —
> `notarytool` replaced it in late 2021 and `altool` was removed entirely in late 2023.
> Only follow documentation that references `notarytool`.

### Microsoft

- **AUTHORITATIVE** — Code signing options for Windows developers:
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
- **AUTHORITATIVE** — SmartScreen reputation for developers:
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- **Reference** — Authenticode signing with signtool:
  https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool

---

## [SWR-SIGN-APPLE-CONCEPTS] Apple Signing Concepts

### Developer ID

Apple distributes a "Developer ID" to members of the Apple Developer Program. There are two
certificate types relevant to binary distribution:

- **Developer ID Application** — signs Mac applications, command-line tools, frameworks, and
  bundles distributed outside the App Store.
- **Developer ID Installer** — signs `.pkg` installer packages.

All Nimblesite products use **Developer ID Application** certificates. Developer ID Application
certificates are valid for **5 years** from creation. Software signed with a certificate that
has since expired can still be installed and run, provided it was notarized while the certificate
was valid. Software signed with a **revoked** certificate cannot be installed or launched.

### Gatekeeper

Gatekeeper is the macOS mechanism that verifies Developer ID signatures and notarization tickets
before allowing software to run. When a user downloads and opens a binary:

1. Gatekeeper checks the Developer ID signature for validity.
2. Gatekeeper checks for a notarization ticket (either stapled to the binary or fetched online
   from Apple's servers).
3. If either check fails, macOS blocks execution and shows a warning dialog.

An unnotarized Developer-ID-signed binary will be blocked on all macOS versions since macOS
Catalina (10.15). Users can override via System Settings, but this is not an acceptable
distribution experience.

### Hardened Runtime

The Hardened Runtime is a macOS protection that restricts an executable from performing
dangerous operations such as code injection, DLL hijacking, and process memory space tampering.
Apple's notarization service **requires** the Hardened Runtime to be enabled; notarization
submission is rejected if it is absent.

For Rust and Go command-line tools, enabling the Hardened Runtime requires only the
`--options runtime` flag during signing. No special entitlements are needed for standard
CLI binaries that do not load unsigned libraries, use JIT compilation, or inject into other
processes. If a binary requires any of these capabilities, add the minimum necessary
entitlements from the reference above [SWR-SIGN-APPLE-ENTITLEMENTS].

### Notarization vs Stapling

**Notarization** is the act of submitting a signed binary to Apple's notary service, which
scans it for malware and returns a signed ticket confirming the binary passed. The ticket is
then available on Apple's CDN keyed by the binary's code hash.

**Stapling** attaches the notarization ticket directly to the binary or archive. Without
stapling, Gatekeeper fetches the ticket online on first launch. With stapling, the ticket is
embedded and Gatekeeper can verify offline. Stapling is required for any binary distributed
to environments where the Mac may not have internet access on first launch (air-gapped
deployments, corporate networks). **All Nimblesite binaries MUST be stapled.**

Note: `xcrun stapler` works with `.app` bundles, `.dmg` disk images, and `.pkg` packages.
Raw binaries (e.g., a plain `my-lsp` ELF-equivalent Mach-O) cannot be stapled directly —
they must be wrapped in a `.zip` or `.dmg` for submission, then the stapled artifact is the
wrapper. For bare executables distributed via GitHub Releases, staple the `.zip` or `.tar.gz`
archive that wraps them.

---

## [SWR-SIGN-APPLE-WORKFLOW] macOS Signing and Notarization Workflow

This is the canonical four-step sequence. Every CI job that produces a macOS binary MUST
execute all four steps before uploading any artifact.

### Step 1 — Sign with Developer ID and Hardened Runtime

```bash
# SWR-SIGN-APPLE-WORKFLOW step 1
codesign \
  --sign "Developer ID Application: Nimblesite Pty Ltd (TEAM_ID)" \
  --options runtime \
  --timestamp \
  --force \
  path/to/binary
```

Required flags:
- `--sign` — the exact certificate name as it appears in Keychain / `security find-identity`.
- `--options runtime` — enables Hardened Runtime. **Without this flag, notarization will be
  rejected.**
- `--timestamp` — embeds a cryptographic timestamp from Apple's timestamping server. Required
  for notarization.
- `--force` — overwrites any existing signature (needed when re-signing CI-built artifacts).

If the binary requires entitlements (rare for standard CLI tools):

```bash
codesign \
  --sign "Developer ID Application: Nimblesite Pty Ltd (TEAM_ID)" \
  --options runtime \
  --timestamp \
  --entitlements entitlements.plist \
  --force \
  path/to/binary
```

Verify the signature and confirm hardened runtime is present:

```bash
codesign --display --verbose=4 path/to/binary
# Look for: flags=0x10000(runtime) in the output
```

### Step 2 — Wrap for Submission

The notary service accepts `.zip`, `.dmg`, or `.pkg`. For bare executables:

```bash
# SWR-SIGN-APPLE-WORKFLOW step 2
ditto -c -k --keepParent path/to/binary submission.zip
```

### Step 3 — Submit and Wait

Use App Store Connect API key authentication (see [SWR-SIGN-APPLE-CI] for CI setup).
The `--wait` flag blocks until the notary service returns a verdict — use this in CI
to fail fast rather than polling separately.

```bash
# SWR-SIGN-APPLE-WORKFLOW step 3
xcrun notarytool submit submission.zip \
  --key AuthKey.p8 \
  --key-id "$NOTARIZATION_KEY_ID" \
  --issuer "$NOTARIZATION_ISSUER_ID" \
  --wait
```

On success the service returns `status: Accepted`. On failure (`Invalid` or `Rejected`),
fetch the full log to diagnose:

```bash
xcrun notarytool log <submission-id> \
  --key AuthKey.p8 \
  --key-id "$NOTARIZATION_KEY_ID" \
  --issuer "$NOTARIZATION_ISSUER_ID"
```

Common rejection causes and fixes are documented at the "Resolving common notarization issues"
reference above. The most frequent cause for CLI tools is a missing `--options runtime` flag
on the `codesign` invocation.

### Step 4 — Staple

Staple the ticket to the archive. For `.zip` wrappers around bare executables, staple the zip.
For `.dmg` or `.pkg`, staple those directly.

```bash
# SWR-SIGN-APPLE-WORKFLOW step 4
xcrun stapler staple submission.zip
```

Validate stapling succeeded:

```bash
xcrun stapler validate submission.zip
spctl --assess --verbose --type open --context context:primary-signature path/to/binary
```

---

## [SWR-SIGN-APPLE-CI] CI Integration — App Store Connect API Key Auth

App Store Connect API key authentication is the **required** method for CI. It is
programmatically issued and revoked, does not expose account passwords, and can be scoped
to minimal permissions. Never use Apple ID + app-specific password in CI.

### One-Time Setup (Nimblesite admin)

1. Log in to https://appstoreconnect.apple.com/access/api under the Nimblesite account.
2. Create a new API key with **Developer** or **App Manager** access level.
3. Download the `.p8` private key file — it can only be downloaded once.
4. Note the **Key ID** (a 10-character alphanumeric string, e.g. `ABC1234567`) and
   **Issuer ID** (a UUID, e.g. `12345678-1234-1234-1234-123456789012`).
5. Import the Developer ID Application certificate into the GitHub Actions environment
   (see certificate import below).

### GitHub Actions Secrets Required

| Secret | Content |
|---|---|
| `APPLE_DEVELOPER_ID_CERT_P12` | Base64-encoded `.p12` export of the Developer ID Application certificate + private key |
| `APPLE_DEVELOPER_ID_CERT_PASSWORD` | Password used when exporting the `.p12` |
| `NOTARIZATION_API_KEY_P8` | Base64-encoded App Store Connect API key `.p8` file |
| `NOTARIZATION_KEY_ID` | Key ID string (e.g. `ABC1234567`) |
| `NOTARIZATION_ISSUER_ID` | Issuer UUID |

### Certificate Import Step (add to every macOS CI job that signs)

```yaml
- name: Import Developer ID certificate
  run: |
    # Decode cert to temp file
    echo "$APPLE_DEVELOPER_ID_CERT_P12" | base64 --decode > cert.p12
    # Create ephemeral keychain
    security create-keychain -p "" build.keychain
    security default-keychain -s build.keychain
    security unlock-keychain -p "" build.keychain
    security import cert.p12 -k build.keychain -P "$APPLE_DEVELOPER_ID_CERT_PASSWORD" \
      -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
  env:
    APPLE_DEVELOPER_ID_CERT_P12: ${{ secrets.APPLE_DEVELOPER_ID_CERT_P12 }}
    APPLE_DEVELOPER_ID_CERT_PASSWORD: ${{ secrets.APPLE_DEVELOPER_ID_CERT_PASSWORD }}
```

### Notarization Steps

```yaml
- name: Decode notarization API key
  run: |
    echo "$NOTARIZATION_API_KEY_P8" | base64 --decode > AuthKey.p8
  env:
    NOTARIZATION_API_KEY_P8: ${{ secrets.NOTARIZATION_API_KEY_P8 }}

- name: Sign, notarize, and staple
  run: |
    # Step 1: sign
    codesign --sign "Developer ID Application: Nimblesite Pty Ltd ($TEAM_ID)" \
      --options runtime --timestamp --force "$BINARY_PATH"
    # Step 2: wrap
    ditto -c -k --keepParent "$BINARY_PATH" submission.zip
    # Step 3: submit and wait
    xcrun notarytool submit submission.zip \
      --key AuthKey.p8 \
      --key-id "$NOTARIZATION_KEY_ID" \
      --issuer "$NOTARIZATION_ISSUER_ID" \
      --wait
    # Step 4: staple
    xcrun stapler staple submission.zip
  env:
    TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    NOTARIZATION_KEY_ID: ${{ secrets.NOTARIZATION_KEY_ID }}
    NOTARIZATION_ISSUER_ID: ${{ secrets.NOTARIZATION_ISSUER_ID }}
```

Add `APPLE_TEAM_ID` to the secrets table — it is the 10-character team identifier visible
in developer.apple.com under Membership.

### Runner Requirement

Signing and notarization MUST run on a `macos-*` GitHub Actions runner. The `codesign`,
`notarytool`, and `stapler` tools are part of the Xcode Command Line Tools, which are
pre-installed on all `macos-*` hosted runners.

---

## [SWR-SIGN-APPLE-ENTITLEMENTS] Entitlements for Rust CLI Binaries

Most Rust CLI tools (LSP servers, MCP servers, CLI utilities) do not require any entitlements.
Enabling `--options runtime` on a standard binary imposes no restrictions beyond preventing
code injection, which Rust binaries do not perform.

If a specific binary requires capabilities beyond the defaults, add only the minimum necessary
entitlement in an `entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Add only what is actually required. Empty dict = no extra entitlements (standard). -->
</dict>
</plist>
```

Common entitlements and when they apply:

| Entitlement | When needed |
|---|---|
| `com.apple.security.cs.allow-dyld-environment-variables` | Tool accepts `DYLD_*` env vars (debuggers, profilers) |
| `com.apple.security.cs.disable-library-validation` | Tool loads unsigned or third-party dynamic libraries |
| `com.apple.security.cs.allow-jit` | Tool performs JIT compilation (e.g. embedded scripting engines) |
| `com.apple.security.cs.debugger` | Tool is a debugging utility that attaches to other processes |

See the Entitlements reference URL above for the full list.

---

## [SWR-SIGN-APPLE-INTEGRATION] Integration with Release Pipeline

Signing and notarization fit between the binary build step and the archive/upload step in
`release.reusable.yml`. The build matrix already runs on `macos-*` runners for Apple targets.

In `release.reusable.yml`, for any job with `platform: darwin`, add the certificate import
step after checkout and before the binary build, then add the sign/notarize/staple steps
after the binary build and before archiving.

The signed and stapled `.zip` becomes the distribution artifact. Downstream:
- GitHub Releases upload the stapled archive.
- VSIX builds on `macos-*` runners sign the binary before staging it to `bin/<platform>/`.
  The VSIX itself is not notarized (VS Code extensions are not subject to Gatekeeper), but
  the embedded binary must be signed so it passes Gatekeeper when VS Code first executes it.

For VSIX builds, add the sign step in `publish-vsix-per-platform.yml` immediately after the
binary is built and before the `SWR-VSIX-STAGING` copy step:

```bash
# In publish-vsix-per-platform.yml, darwin-* platforms only
if [[ "${{ matrix.platform }}" == "darwin" ]]; then
  echo "$APPLE_DEVELOPER_ID_CERT_P12" | base64 --decode > cert.p12
  security create-keychain -p "" build.keychain
  security default-keychain -s build.keychain
  security unlock-keychain -p "" build.keychain
  security import cert.p12 -k build.keychain \
    -P "$APPLE_DEVELOPER_ID_CERT_PASSWORD" -T /usr/bin/codesign
  security set-key-partition-list -S apple-tool:,apple: -s -k "" build.keychain
  codesign --sign "Developer ID Application: Nimblesite Pty Ltd ($APPLE_TEAM_ID)" \
    --options runtime --timestamp --force \
    "target/release/${{ inputs.binary_name }}"
fi
```

Binaries embedded in VSIX packages do not need notarization tickets — only stapled archives
that Gatekeeper quarantines on download require notarization.

---

## [SWR-SIGN-WINDOWS] Windows Authenticode Signing

### What Is Authenticode

Authenticode is Microsoft's code-signing technology for Windows. Signed executables display
the publisher name in UAC prompts and Windows security dialogs. Unsigned executables trigger
SmartScreen warnings or hard blocks depending on the user's security policy.

### The SmartScreen Reputation Problem

SmartScreen evaluates two signals before allowing an executable to run:

1. **Publisher reputation** — whether the certificate's subject has enough download history
   across Windows users to be trusted.
2. **File hash reputation** — whether the specific file binary has been downloaded by enough
   users without being flagged as malicious.

A new code-signing certificate starts with zero reputation, regardless of certificate type.
Until sufficient download history accumulates (typically several weeks and hundreds of clean
installs — Microsoft publishes no exact threshold), SmartScreen shows a warning dialog to users
who run the binary. There is no mechanism to purchase or expedite reputation; it must be earned
organically through user adoption.

**Critical change (2024):** Extended Validation (EV) certificates previously bypassed
SmartScreen on first download. That behavior was removed. EV and OV certificates now go through
the same reputation-building process. The price premium for EV certificates no longer delivers
a SmartScreen bypass.

**Certificate renewal impact:** When a certificate expires and a new one is issued, the new
certificate carries a different fingerprint and starts with zero SmartScreen reputation.
Reputation is non-transferable between certificates.

**Certificate lifespan change (February 2026):** As of February 15, 2026, code-signing
certificate lifespans are capped at one year. Previously, multi-year certificates were
available. Annual renewal means annual reputation resets.

### Cost

Organization Validated (OV) certificates cost approximately $150–$300 per year from major
Certificate Authorities (DigiCert, Sectigo, GlobalSign). Extended Validation certificates
cost $400 or more per year, and as noted above no longer provide a SmartScreen bypass.

### Nimblesite Position on Windows Signing

**Nimblesite is not pursuing Windows Authenticode signing at this time.** The reasons:

1. **Cost without meaningful benefit at current scale.** Certificates cost $150–$400+ per year.
2. **Reputation cannot be bought.** Even with a valid certificate, SmartScreen will warn
   users until the binary accumulates hundreds of downloads — identical user experience to
   unsigned binaries during the reputation-building period.
3. **Annual renewal resets reputation.** The 1-year certificate lifespan cap (February 2026)
   means reputation resets every year with a new cert, negating long-term investment.
4. **Windows is not the primary platform for Nimblesite products at this stage.**

When Windows signing becomes worthwhile (larger Windows user base, enterprise sales requiring
it), revisit this decision. At that point, evaluate whether Azure Trusted Signing (Microsoft's
cloud-based code-signing service, ~$10/month) is more practical than purchasing a certificate
from a traditional CA — it integrates directly with GitHub Actions and avoids HSM requirements.

See: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options

---

## [SWR-SIGN-GAPS] Known Gaps

| ID | Gap | Location |
|---|---|---|
| SWR-SIGN-GAP-CERT-IMPORT | Developer ID cert import not yet in `release.reusable.yml` | `.github/workflows/release.reusable.yml` |
| SWR-SIGN-GAP-VSIX-SIGNING | Sign step not yet in `publish-vsix-per-platform.yml` | `templates/gh-actions/publish-vsix-per-platform.yml` |
| SWR-SIGN-GAP-SECRETS | Apple signing secrets not yet created in GitHub org | GitHub org/repo settings |
| SWR-SIGN-GAP-VERIFY | No CI check that a darwin binary is signed before upload | `release.reusable.yml` build job |
