FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS build

ENV NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app
RUN npm install -g npm@12.0.1 && npm cache clean --force
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html playwright.config.ts tsconfig*.json vite.config.ts ./
COPY public ./public
COPY server ./server
COPY shared ./shared
COPY src ./src
COPY e2e/*.ts ./e2e/
COPY scripts/*.ts scripts/copy-migrations.js scripts/check-frontend-bundle.js ./scripts/
RUN npm run build

FROM build AS production-deps

RUN rm -rf node_modules && npm ci --omit=dev && npm cache clean --force
RUN mkdir -p /runtime-layout/data /runtime-layout/backups && \
    chown -R 1000:1000 /runtime-layout

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bb6b03d81066993293a10feda7250e8e1cc034035fe9b61cfceededa7c8bf04d AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/app.sqlite \
    BACKUP_DIR=/backups \
    TMPDIR=/tmp \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/.cache \
    LOG_LEVEL=info

WORKDIR /app
COPY --chown=1000:1000 package.json package-lock.json ./
COPY --from=production-deps --chown=1000:1000 /app/node_modules ./node_modules

COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --from=build --chown=1000:1000 /app/dist-server ./dist-server
COPY --chown=1000:1000 scripts/backup.js scripts/restore-check.js scripts/healthcheck.js scripts/runtime-verify.js ./scripts/
COPY --from=production-deps --chown=1000:1000 /runtime-layout/data /data
COPY --from=production-deps --chown=1000:1000 /runtime-layout/backups /backups

USER 1000:1000

EXPOSE 3000
VOLUME ["/data", "/backups"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["/nodejs/bin/node", "scripts/healthcheck.js"]

CMD ["dist-server/server/index.js"]
