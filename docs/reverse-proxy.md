# Reverse proxy deployment

The recommended production mode is native OIDC behind an ordinary HTTPS
reverse proxy. The proxy terminates TLS and forwards requests without creating
identity headers. The application validates OIDC itself and keeps
`TRUST_PROXY_AUTH=false`.

```text
Browser -> HTTPS reverse proxy -> Betreuungskalender -> selected database
```

Forward the original scheme and host, preserve WebSocket-capable HTTP/1.1
behavior, and set request-size and timeout limits compatible with the documented
transfer limits. Do not expose the application container on an additional
public port.

## Trusted-proxy compatibility mode

`AUTH_MODE=trusted-proxy` remains available for operators with an independently
managed authentication proxy. This repository does not provide or configure
such a proxy. The operator is responsible for its lifecycle and security.

The following boundary is mandatory:

- only the authentication proxy can reach the application listener;
- the public proxy strips all configured identity headers from client requests
  before setting trusted values;
- `TRUSTED_PROXY_CIDRS` contains only the proxy source address or the smallest
  isolated proxy network;
- `OIDC_USER_ID_HEADER` carries a stable, immutable subject;
- names, email addresses, and groups are optional attributes and never replace
  the stable subject;
- direct access that bypasses the authentication proxy is blocked by container
  networking, loopback binding, or firewall policy.

The application accepts IP addresses and CIDR ranges in `TRUSTED_PROXY_CIDRS`,
not DNS or container names. Validate the actual socket source address observed
by the application before enabling the mode.

## Validation

1. Direct access to the application listener is impossible from an untrusted
   network.
2. An unauthenticated request is rejected.
3. A client-supplied identity header is removed or replaced by the proxy.
4. `/api/session` reports the expected application user and role.
5. Logout follows the configured `AUTH_LOGOUT_URL`, when one is provided.
6. Application logs contain neither identity headers nor authentication tokens.

See [configuration](configuration.md), [security](security.md), and the
[native OIDC guide](native-oidc-keycloak-podman.md) for the supported runtime
contracts.
