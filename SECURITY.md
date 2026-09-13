# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| Current release line and `main` | Yes |
| Older snapshots | No |

## Reporting a vulnerability

Please use GitHub Security Advisories if they are enabled for the repository.
Do not open a public issue containing exploit details or personal data.

Do not attach real backups, SQLite files, JSON exports, PDFs, CSV files,
screenshots with family data, authentication cookies, proxy headers, OIDC
tokens, authorization codes, state, nonce, PKCE verifier values, or client
secrets. Do not include native session cookie values or raw session tokens.
Use a minimal reproduction with fictional data.

If private reporting is unavailable, open a public issue requesting a private
contact channel without disclosing the vulnerability details.

## Security boundary

Betreuungskalender is intended for private, self-hosted use. The operator is
responsible for TLS, host updates, firewall rules, disk encryption, access
control, reverse-proxy configuration, and protected backups. See
[`docs/security.md`](docs/security.md).

Workspace membership is the authorization source for native OIDC users.
Removing a membership also invalidates that identity's active application
sessions; restoring membership requires a new login.

When shared care-party assignments are enabled, non-admin planning and reduced
schedule access is limited to the user's assigned care parties.

Actual care ranges submitted through confirmation workflows use the same
supported-date and maximum-duration limits as regular care entries.

CSV exports encode stored text as inert spreadsheet content. They can still
contain sensitive domain data and require the same protection as other exports.
