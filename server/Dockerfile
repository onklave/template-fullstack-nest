# syntax=docker/dockerfile:1
#
# The `api` service: NestJS + node-postgres, compiled with tsc. Build context
# is ./server (see onklave.yaml) — paths below are relative to it.

# --- Build stage: compile TypeScript, then drop the dev toolchain ---
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Runtime stage ---
FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json

# Unprivileged user shipped with the node image. Nothing is written to disk:
# state lives in PostgreSQL, reached via the injected DATABASE_URL.
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
