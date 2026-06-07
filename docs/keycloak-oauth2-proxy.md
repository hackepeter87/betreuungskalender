# Keycloak and oauth2-proxy

## Keycloak client

Create an OpenID Connect confidential client:

- Client ID: `betreuungskalender`
- Standard Flow: enabled
- Direct Access Grants: disabled
- Valid redirect URI:
  `https://betreuung.example.net/oauth2/callback`
- Web origin: `https://betreuung.example.net`
- Client authentication: enabled
- MFA: recommended for all users

Restrict access to an explicit Keycloak group or role where possible.

## oauth2-proxy example

Store this configuration outside the repository and protect it with mode
`0600`.

```ini
provider = "keycloak-oidc"
oidc_issuer_url = "https://idp.example.net/realms/example"
client_id = "betreuungskalender"
client_secret = "CHANGE_ME"
redirect_url = "https://betreuung.example.net/oauth2/callback"

email_domains = [ "*" ]
http_address = "127.0.0.1:4180"
upstreams = [ "http://127.0.0.1:3000" ]

cookie_secret = "CHANGE_ME_32_BYTE_BASE64"
cookie_secure = true
cookie_httponly = true
cookie_samesite = "lax"

reverse_proxy = true
set_xauthrequest = true
pass_access_token = false
pass_authorization_header = false
```

Generate `client_secret` in Keycloak. Generate `cookie_secret` using the
oauth2-proxy documentation. Never reuse the example strings.

## Identity headers

Betreuungskalender accepts these headers when `TRUST_PROXY_AUTH=true`:

- `X-Auth-Request-Email`
- `X-Forwarded-Email`
- `X-Auth-Request-User`
- `X-Forwarded-User`

Prefer email only if it is stable and required for your audit policy. The
application stores the asserted identity in API audit records.

## Required app settings

```dotenv
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
ALLOWED_ORIGIN=https://betreuung.example.net
HOST=127.0.0.1
```

If the app runs in a container, bind it only to a private container network
reachable by oauth2-proxy.

## Critical warning

Identity headers can be forged by any client that reaches the app directly.
Authentication is secure only when firewall, listener address, or private
container networking prevents bypassing oauth2-proxy. Strip incoming
`X-Auth-Request-*` and `X-Forwarded-*User/Email` headers at the public edge.
