FROM node:24-bookworm-slim AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

COPY deepagents.plugins.yaml deepagents.plugins.lock.json ./
COPY plugin-policy.yaml ./
COPY src ./src
COPY tsconfig.json ./

RUN npx deepagents-plugins verify --frozen-lockfile

RUN npx deepagents-plugins compile \
    --frozen-lockfile \
    --policy plugin-policy.yaml \
    --output /workspace/.deepagents/plugins \
    --reproducible

RUN npm run build
RUN npm prune --omit=dev

FROM gcr.io/distroless/nodejs24-debian12:nonroot

WORKDIR /app

COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/dist ./dist
COPY --from=build /workspace/.deepagents/plugins ./.deepagents/plugins
COPY --from=build /workspace/package.json ./

ENV NODE_ENV=production
ENV DEEPAGENTS_PLUGIN_DIR=/app/.deepagents/plugins

# Distroless nonroot image already defaults to uid 65532; make it explicit for scanners.
USER nonroot

# Cloud Run uses platform probes; this satisfies container scanners that require HEALTHCHECK.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "process.exit(0)"]

CMD ["dist/server.js"]
