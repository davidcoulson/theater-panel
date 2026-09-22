# Theater panel. Plain Node on Alpine, like Strimmer: no build step, no native modules.
FROM node:26-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    CACHE_DIR=/data/cache

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY web ./web

# Poster cache lives on a volume so it survives image updates.
RUN mkdir -p /data/cache && chown -R node:node /data
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/state >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.mjs"]
