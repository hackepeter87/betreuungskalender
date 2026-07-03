# Security review and optional DAST

This document records the current decision for optional dynamic application
security testing and external review preparation. It is operational guidance,
not a penetration-test report.

## Decision

Automated DAST is not part of the default CI pipeline.

The approved path is:

- Run ZAP-style baseline scans only against a local or staging test instance.
- Use fictional demo data only.
- Keep production and private real deployments out of automated DAST targets.
- Treat DAST output as review input, not as an automatic release blocker.
- Track confirmed findings as normal GitHub issues without secrets, tokens,
  private URLs, screenshots with personal data, or request/response bodies that
  contain sensitive content.

This keeps routine releases predictable while still allowing targeted security
review before broader exposure.

## Safe scan target

Use a disposable local instance or a staging instance that meets all of these
conditions:

- It contains only fictional children, users, care entries, notes, evidence
  references, calendar feeds, and notification subscriptions.
- It does not use production identity-provider clients, secrets, databases,
  backups, domains, or mail/push credentials.
- It is reachable only for the review window, or is protected by an explicit
  allowlist.
- The tested authentication mode is documented before the scan starts.

Do not point DAST tools at production. Do not scan a demo environment that
contains user-created personal data.

## Local ZAP baseline example

Run this only against a disposable test URL:

```bash
docker run --rm \
  -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t http://host.docker.internal:3000 \
  -r zap-baseline.html
```

If Docker is not available, use the equivalent Podman command and adjust the
host address for the local environment.

For authenticated application coverage, prefer a short manual review session or
an explicitly scripted test account with fictional data. Do not export real
session cookies, OIDC tokens, calendar-feed tokens, or recovery-admin cookies
into scanner configuration.

## External review packet

Before handing the application to an external reviewer, prepare:

- The tested commit SHA, image tag or digest, and deployment mode.
- The authentication mode and test identity-provider setup.
- A list of intentionally unauthenticated endpoints, such as health checks and
  token-based calendar-feed URLs.
- The data-protection rules from `AGENTS.md`, `docs/security.md`, and
  `docs/security-baseline.md`.
- A fictional test-data description and reset procedure.
- Known residual risks and deferred work from the security baseline.

Give reviewers a dedicated test account and a dedicated test instance. Revoke
all temporary credentials after the review.

## Finding handling

For each confirmed issue, create a GitHub issue with:

- affected component and route or workflow,
- impact,
- reproduction steps using fictional data,
- expected fix direction,
- severity and priority,
- whether the finding affects production, demo, or only local test mode.

Do not include live secrets, real personal data, raw cookies, bearer tokens,
database files, backups, or full scanner logs with sensitive traffic.
