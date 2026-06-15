# Security Policy

## Reporting a Vulnerability

Do **not** open public issues, discussions, or PRs for security vulnerabilities.

Report privately via the repo's **Security** tab → **Report a vulnerability**
(<https://github.com/Nimblesite/Shipwright/security/advisories/new>). Fallback:
email <cftools@nimblesite.co>.

Include: issue type (e.g. injection, path traversal, secret exposure, release/supply-chain
tampering), affected version/crate/file(s), reproduction steps/PoC, and impact.

## What to Expect

- Acknowledgement within 3 business days.
- Assessment + remediation plan (or reasoned decline) within 10 business days.
- Coordinated disclosure; credit unless you prefer anonymity.

## Supported Versions

Security fixes land on the latest released minor.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

See [`docs/specs/supply-chain-security.md`](docs/specs/supply-chain-security.md)
(`SWR-SEC-POLICY`) for how this fits Shipwright's threat model.

Refs: [add a security policy](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/add-security-policy) ·
[private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
