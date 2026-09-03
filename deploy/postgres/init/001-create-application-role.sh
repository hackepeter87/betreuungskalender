#!/usr/bin/env bash
set -euo pipefail

case "${APP_POSTGRES_USER:-}" in
  ""|*[!a-z0-9_]*|[0-9]*)
    echo "APP_POSTGRES_USER must use lowercase letters, digits, and underscores and must not start with a digit." >&2
    exit 1
    ;;
esac

case "${APP_POSTGRES_DATABASE:-}" in
  ""|*[!a-z0-9_]*|[0-9]*)
    echo "APP_POSTGRES_DATABASE must use lowercase letters, digits, and underscores and must not start with a digit." >&2
    exit 1
    ;;
esac

if [[ ! -r "${APP_POSTGRES_PASSWORD_FILE:-}" ]]; then
  echo "The application database password file is missing or unreadable." >&2
  exit 1
fi

if [[ ! -s "$APP_POSTGRES_PASSWORD_FILE" ]]; then
  echo "The application database password file is empty." >&2
  exit 1
fi

app_password="$(tr -d '\r\n' <"$APP_POSTGRES_PASSWORD_FILE")"
if [[ -z "$app_password" ]]; then
  echo "The application database password file contains no usable password." >&2
  exit 1
fi

printf '%s\n%s\n' "$app_password" "$app_password" | createuser \
  --username "$POSTGRES_USER" \
  --pwprompt \
  --no-superuser \
  --no-createdb \
  --no-createrole \
  --no-inherit \
  --no-replication \
  --no-bypassrls \
  "$APP_POSTGRES_USER"
unset app_password

createdb \
  --username "$POSTGRES_USER" \
  --owner "$APP_POSTGRES_USER" \
  "$APP_POSTGRES_DATABASE"

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --command "REVOKE ALL ON DATABASE \"$APP_POSTGRES_DATABASE\" FROM PUBLIC;"
