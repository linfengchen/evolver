# Security Policy

## Supported Versions

We support the latest minor version of `@evomap/evolver` on npm. Only the current release line receives security updates; older minor versions are not backported.

| Version   | Supported           |
| --------- | ------------------- |
| 1.67.x    | Yes (current)       |
| < 1.67    | No                  |

Run `npm view @evomap/evolver version` to check the latest published version.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities. Instead, use one of the private channels below.

### Preferred: GitHub Private Vulnerability Reporting

Submit a private report via:

  https://github.com/EvoMap/evolver/security/advisories/new

This is the fastest and most secure channel. Only repository maintainers will see the report.

### Alternative: Email

If you cannot use GitHub advisories, email `team@evomap.ai` with subject line `[SECURITY] evolver: <short title>`.

### What to include

- A clear description of the vulnerability and its impact
- Affected version(s) and environment (OS, Node.js version)
- Steps to reproduce or a minimal proof-of-concept
- Any suggested mitigation or patch

### What to expect

- **Acknowledgement**: within 48 hours of receipt
- **Initial assessment**: within 7 days (severity, affected versions, mitigation plan)
- **Fix timeline**: critical issues are targeted for a patch release within 14 days; lower severity follows the normal release cadence
- **Disclosure**: we practice coordinated disclosure. Once a fix is available, we publish a GitHub Security Advisory crediting the reporter (unless anonymity is requested)

### Scope

In scope:

- `@evomap/evolver` npm package source code
- Default configuration and built-in protocols (GEP, A2A Proxy)
- Supply-chain risks (malicious dependencies, install scripts)

Out of scope:

- Vulnerabilities in the EvoMap Hub service itself -- please report those separately to `security@evomap.ai`
- Third-party LLM providers, user-authored genes, or user-generated content
- Social engineering and physical attacks

## Safe Harbor

Good-faith security research conducted under this policy is authorized. We will not pursue legal action against researchers who:

- Give us reasonable time to respond before public disclosure
- Avoid accessing data that does not belong to them
- Do not degrade service for other users

Thank you for helping keep the EvoMap ecosystem safe.
