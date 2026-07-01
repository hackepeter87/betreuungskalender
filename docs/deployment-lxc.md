# Debian/Ubuntu LXC and systemd deployment

## Prerequisites

- Current Debian or Ubuntu LXC
- Node.js 24 LTS and npm 11
- A dedicated unprivileged system account
- TLS and authentication handled by a reverse proxy

## Directories and account

```bash
sudo useradd --system --home /opt/betreuungskalender \
  --shell /usr/sbin/nologin betreuung
sudo mkdir -p \
  /opt/betreuungskalender \
  /var/lib/betreuungskalender \
  /var/backups/betreuungskalender \
  /etc/betreuungskalender
sudo chown -R betreuung:betreuung \
  /opt/betreuungskalender \
  /var/lib/betreuungskalender \
  /var/backups/betreuungskalender
sudo chmod 750 /var/lib/betreuungskalender /var/backups/betreuungskalender
sudo chmod 750 /etc/betreuungskalender
```

Copy the source or release into `/opt/betreuungskalender`, then:

```bash
cd /opt/betreuungskalender
sudo -u betreuung npm ci
sudo -u betreuung npm run build
```

Create `/etc/betreuungskalender/.env` from `.env.example`. For a local
oauth2-proxy use `HOST=127.0.0.1`, `AUTH_MODE=trusted-proxy`,
`REQUIRE_AUTH=true`, and `TRUST_PROXY_AUTH=true`.

```bash
sudo chown root:betreuung /etc/betreuungskalender/.env
sudo chmod 640 /etc/betreuungskalender/.env
```

## systemd

```bash
sudo cp docs/systemd/betreuungskalender.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now betreuungskalender
sudo systemctl status betreuungskalender
```

The service uses a read-only application tree and grants write access only to
the database and backup directories. If a distribution or native Node module
conflicts with a hardening directive, remove only that directive after
documenting and testing the reason.

Optional daily SQLite backup timer:

```bash
sudo cp docs/systemd/betreuungskalender-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now betreuungskalender-backup.timer
sudo systemctl list-timers betreuungskalender-backup.timer
```

## Verification

```bash
curl --fail http://127.0.0.1:3000/api/health
sudo -u betreuung npm run backup --prefix /opt/betreuungskalender
sudo -u betreuung npm run restore:check --prefix /opt/betreuungskalender
```

Do not expose port 3000 publicly when proxy authentication is enabled. See
[`reverse-proxy.md`](reverse-proxy.md).
