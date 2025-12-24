FROM node:lts AS base
RUN apt-get update && apt-get install -y libc6-dev && rm -rf /var/lib/apt/lists/*

# FROM node:18-alpine AS base
# RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Dummy environment variables for build-time validation
# Real values will be provided at runtime via docker-compose env_file
ARG IS_DOCKER="true"
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ARG DATABASE_DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ARG STORAGE_ENDPOINT="http://localhost:9000"
ARG STORAGE_ACCESS_KEY_ID="dummy"
ARG STORAGE_SECRET_ACCESS_KEY="dummy"
ARG STORAGE_BUCKET="dummy"
ARG STORAGE_REGION="us-east-1"
ARG CLICKHOUSE_URL="http://localhost:8123"
ARG CLICKHOUSE_USER="dummy"
ARG CLICKHOUSE_PASSWORD="dummy"
ARG GITHUB_CLIENT_ID="dummy"
ARG GITHUB_CLIENT_SECRET="dummy"
ARG GOOGLE_CLIENT_ID="dummy"
ARG GOOGLE_CLIENT_SECRET="dummy"
ARG PUBLIC_URL="http://localhost:3001"
ARG BETTER_AUTH_URL="http://localhost:3000"
ARG BETTER_AUTH_SECRET="dummy_secret_at_least_32_characters_long"

ENV IS_DOCKER=${IS_DOCKER}
ENV DATABASE_URL=${DATABASE_URL}
ENV DATABASE_DIRECT_URL=${DATABASE_DIRECT_URL}
ENV STORAGE_ENDPOINT=${STORAGE_ENDPOINT}
ENV STORAGE_ACCESS_KEY_ID=${STORAGE_ACCESS_KEY_ID}
ENV STORAGE_SECRET_ACCESS_KEY=${STORAGE_SECRET_ACCESS_KEY}
ENV STORAGE_BUCKET=${STORAGE_BUCKET}
ENV STORAGE_REGION=${STORAGE_REGION}
ENV CLICKHOUSE_URL=${CLICKHOUSE_URL}
ENV CLICKHOUSE_USER=${CLICKHOUSE_USER}
ENV CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD}
ENV GITHUB_CLIENT_ID=${GITHUB_CLIENT_ID}
ENV GITHUB_CLIENT_SECRET=${GITHUB_CLIENT_SECRET}
ENV GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
ENV GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
ENV PUBLIC_URL=${PUBLIC_URL}
ENV BETTER_AUTH_URL=${BETTER_AUTH_URL}
ENV BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}

COPY . .
RUN corepack enable pnpm && pnpm i && pnpm run build

# Runtime environment - all secrets provided via K8s ConfigMaps/Secrets
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "./.next/standalone/server.js"]
EXPOSE 3001
