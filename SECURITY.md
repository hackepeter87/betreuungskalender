# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `0.1.x` and current `main` | Yes |
| Older snapshots | No |

## Reporting a vulnerability

Please use GitHub Security Advisories if they are enabled for the repository.
Do not open a public issue containing exploit details or personal data.

Do not attach real backups, SQLite files, JSON exports, PDFs, CSV files,
screenshots with family data, authentication cookies, proxy headers, OIDC
tokens, authorization codes, state, nonce, PKCE verifier values, or client
secrets. Use a minimal reproduction with fictional data.

If private reporting is unavailable, open a public issue requesting a private
contact channel without disclosing the vulnerability details.

## Security boundary

Betreuungskalender is intended for private, self-hosted use. The operator is
responsible for TLS, host updates, firewall rules, disk encryption, access
control, reverse-proxy configuration, and protected backups. See
[`docs/security.md`](docs/security.md).
