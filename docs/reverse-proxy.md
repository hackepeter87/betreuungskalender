# Reverse proxy deployment

## Security model

Recommended architecture:

```text
Browser -> HTTPS reverse proxy -> oauth2-proxy -> Betreuungskalender -> SQLite
```

The public proxy terminates TLS. oauth2-proxy authenticates the user and sets a
trusted identity header. Betreuungskalender must not be reachable around that
authentication path.

Set:

```dotenv
HOST=127.0.0.1
PORT=3000
AUTH_MODE=trusted-proxy
REQUIRE_AUTH=true
TRUST_PROXY_AUTH=true
ALLOWED_ORIGIN=https://betreuung.example.net
```

The proxy should set `X-Forwarded-Proto`, `X-Forwarded-Host`,
`X-Forwarded-Port`, and `X-Forwarded-For`. Strip incoming authentication
headers from clients before setting trusted values. In oauth2-proxy, pair
`reverse_proxy = true` with a narrow `trusted_ips` list for the upstream proxy,
for example `trusted_ips = [ "127.0.0.1/32", "192.0.2.10/32" ]`, and replace
the documentation CIDR with the actual proxy address.

## HAProxy in front of oauth2-proxy

```haproxy
frontend https_in
  bind :443 ssl crt /etc/haproxy/certs/betreuung.example.net.pem
  mode http
  http-request set-header X-Forwarded-Proto https
  http-request set-header X-Forwarded-Host %[req.hdr(Host)]
  http-request set-header X-Forwarded-Port 443
  option forwardfor
  default_backend oauth2_proxy

backend oauth2_proxy
  mode http
  server oauth2 127.0.0.1:4180 check
```

oauth2-proxy forwards authenticated requests to `127.0.0.1:3000`. Keep both
ports behind the host firewall.

## nginx

```nginx
location / {
    proxy_pass http://127.0.0.1:4180;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port $server_port;
}
```

## Caddy

```caddyfile
betreuung.example.net {
    reverse_proxy 127.0.0.1:4180
}
```

## Traefik

Place oauth2-proxy and Betreuungskalender on a private Docker network. Route
the public HTTPS service only to oauth2-proxy. Do not publish the app container
port directly. Configure forwarded headers only from trusted network ranges.

## Validation

- A request to `/api/children` without a trusted identity must return `401`.
- `/api/health` remains unauthenticated for monitoring and contains no paths.
- A valid authenticated request must reach the API through oauth2-proxy.
- Direct access to port 3000 must be blocked from untrusted networks.
- The browser origin must exactly match `ALLOWED_ORIGIN`.
