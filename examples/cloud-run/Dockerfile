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

CMD ["dist/server.js"]
