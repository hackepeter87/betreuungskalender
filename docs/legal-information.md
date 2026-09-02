# Operator legal information

The application publishes operator-provided plain text at `/impressum` and
`/datenschutz`. It does not generate legal conclusions. Missing, invalid, or
oversized files return a neutral `404`, and responses are never cached.

Start with the deliberately incomplete examples:

- [`impressum.txt.example`](examples/legal/impressum.txt.example)
- [`datenschutz.txt.example`](examples/legal/datenschutz.txt.example)

Copy them into an operator-controlled directory as `impressum.txt` and
`datenschutz.txt`. Replace every `[OPERATOR: ...]` placeholder, remove all
instructions and unused conditional sections, and obtain deployment-specific
legal review before mounting them. Never commit the completed files: names,
addresses, providers, and operating decisions belong to the installation.

The examples use information categories from Section 5 DDG and Articles 13 and
14 GDPR. Applicability still depends on the operator and service. Use the
[data-lifecycle guide](operator-data-lifecycle.md) for retention, erasure, and
privacy-role decisions. Section 25(2) TDDDG can exempt strictly necessary
storage from consent only when its conditions are met; optional storage still
requires a separate assessment.

Primary references:

- [Section 5 DDG](https://www.gesetze-im-internet.de/ddg/__5.html)
- [GDPR Articles 5, 13, 14, 17, and 28](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Section 25 TDDDG](https://www.gesetze-im-internet.de/ttdsg/__25.html)

## Container, Compose, and Podman

`LEGAL_CONTENT_DIR` defaults to `/run/config/legal`. Keep the directory
traversable and files readable by runtime UID/GID `1000`, for example directory
mode `0755` and file mode `0644`. The files are public content, not secrets, but
the mount must be read-only so the app cannot change operator-approved text.

Add this service fragment to the selected Compose file:

```yaml
services:
  betreuungskalender:
    environment:
      LEGAL_CONTENT_DIR: /run/config/legal
    volumes:
      - ./legal:/run/config/legal:ro
```

Docker Compose and `podman-compose` use the same bind-mount shape. Direct
container commands use an explicit read-only mount:

```bash
docker run --mount type=bind,src=/operator/legal,dst=/run/config/legal,readonly IMAGE
podman run --mount type=bind,src=/operator/legal,dst=/run/config/legal,ro=true IMAGE
```

Replace `IMAGE` and `/operator/legal` with deployment values. Preserve the
existing persistence, network, authentication, and secret options; these are
not complete deployment commands. Verify `/impressum` and `/datenschutz`
through the same public HTTPS origin users access.

## Helm

Create an operator-managed ConfigMap from reviewed files. The content is
publicly served, so do not put unrelated secrets in this ConfigMap.

```bash
kubectl create configmap betreuungskalender-operator-legal \
  --from-file=impressum.txt=/operator/legal/impressum.txt \
  --from-file=datenschutz.txt=/operator/legal/datenschutz.txt \
  --namespace example
```

Merge
[`legal-content-values.yaml`](../charts/betreuungskalender/examples/legal-content-values.yaml)
into private values. It uses the existing `extraVolumes` and
`extraVolumeMounts` interfaces and mounts the ConfigMap read-only. Render and
inspect the Deployment before upgrading. After updating reviewed text, roll the
Deployment and verify both pages through the ingress.

## Identity-provider login links

The application shows legal links in its shell, native OIDC pages, and recovery
login. If the identity provider has its own login page, configure its
operator-controlled footer to link to the application origin plus `/impressum`
and `/datenschutz`. This repository neither ships nor manages an identity-
provider theme. Keep one canonical copy of each legal text.

## Publication checklist

- Every placeholder and template instruction has been removed.
- Required and conditional sections match the actual operator.
- Authentication, integrations, recipients, transfers, and browser storage
  match the deployed configuration.
- Retention and erasure statements match the completed operator matrix.
- A deployment-specific legal review and review date are recorded.
- The mount is read-only and both pages return current content over HTTPS.
- Completed legal files remain outside Git, images, archives, and logs.
