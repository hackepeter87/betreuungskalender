FROM node:24.18.0-bookworm-slim AS build

ENV NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app
RUN npm install -g npm@11.18.0 && npm cache clean --force
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig*.json vite.config.ts ./
COPY public ./public
COPY server ./server
COPY shared ./shared
COPY src ./src
COPY scripts/copy-migrations.js ./scripts/copy-migrations.js
RUN npm run build

FROM build AS production-deps

RUN rm -rf node_modules && npm ci --omit=dev && npm cache clean --force

FROM node:24.18.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/app.sqlite \
    BACKUP_DIR=/backups \
    LOG_LEVEL=info

WORKDIR /app
RUN npm install -g npm@11.18.0 && npm cache clean --force
COPY package.json package-lock.json ./
COPY --from=production-deps /app/node_modules ./node_modules

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY scripts/backup.js scripts/restore-check.js scripts/healthcheck.js scripts/runtime-verify.js ./scripts/

RUN mkdir -p /data /backups && chown -R node:node /app /data /backups
USER node

EXPOSE 3000
VOLUME ["/data", "/backups"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["node", "scripts/healthcheck.js"]

CMD ["node", "dist-server/server/index.js"]
