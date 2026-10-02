# Theater panel. Plain Node on Alpine, like Strimmer: no build step, no native modules.
# Pinned by digest for repeatable builds; Dependabot moves the pin as the tag is republished.
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80
LABEL org.opencontainers.image.source=https://github.com/davidcoulson/theater-panel

WORKDIR /app
# Stamped by `npm run push` so the panel can show which build it is running.
ARG BUILD_VERSION=dev
ARG BUILD_TIME=
ENV NODE_ENV=production \
    PORT=8787 \
    CACHE_DIR=/data/cache \
    BUILD_VERSION=$BUILD_VERSION \
    BUILD_TIME=$BUILD_TIME

COPY package.json package-lock.json ./
# Alpine fixes published since the base image was built, then the app's dependencies. npm itself
# is removed afterwards: the panel never runs it, and its own bundled packages were the only
# vulnerabilities a scan of the image found (brace-expansion, undici, ip-address in npm's tree).
RUN apk upgrade --no-cache \
 && npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /root/.npm

COPY server ./server
COPY web ./web

# Poster cache lives on a volume so it survives image updates.
RUN mkdir -p /data/cache && chown -R node:node /data
VOLUME /data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "server/index.mjs"]
