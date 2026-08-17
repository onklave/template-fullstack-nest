# syntax=docker/dockerfile:1
#
# The `api` service: NestJS + node-postgres, compiled with tsc. Build context
# is ./server (see onklave.yaml) — paths below are relative to it.

# --- Build stage: compile TypeScript, then drop the dev toolchain ---
FROM node:22-alpine AS build
WORKDIR /app
# .npmrc carries engine-strict=true (and nothing else, ever), so a base image
# below the `engines` floor in package.json fails here rather than several
# steps later. This service's floor is Node 22; the web service's is higher.
COPY package.json package-lock.json tsconfig.json .npmrc ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Runtime stage ---
FROM node:22-alpine AS runtime
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
