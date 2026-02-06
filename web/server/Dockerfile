# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable pnpm

# Copy workspace config and lockfile for deterministic installs
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy app package.json so pnpm can resolve the full workspace from the lockfile
COPY app/package.json ./app/

# Copy server package files
COPY server/package.json ./server/
COPY server/prisma ./server/prisma/

# Install dependencies with frozen lockfile for reproducible builds
RUN pnpm install --frozen-lockfile --filter @mlop/server

# Stage 2: Builder (inherits from deps to avoid redundant setup)
FROM deps AS builder

# Copy server source files
COPY server/ ./server/

WORKDIR /app/server

# Build-time version info
ARG GIT_COMMIT="unknown"
ARG GIT_BRANCH="unknown"
ARG BUILD_TIME="unknown"
ARG SERVICE_VERSION="unknown"

# Dummy environment variables for build-time validation
# Real values will be provided at runtime via docker-compose env_file
ENV IS_DOCKER="true"
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV DATABASE_DIRECT_URL="postgresql://dummy:dummy@localhost:5432/dummy?schema=public"
ENV STORAGE_ENDPOINT="http://localhost:9000"
ENV STORAGE_ACCESS_KEY_ID="dummy"
ENV STORAGE_SECRET_ACCESS_KEY="dummy"
ENV STORAGE_BUCKET="dummy"
ENV STORAGE_REGION="us-east-1"
ENV CLICKHOUSE_URL="http://localhost:8123"
ENV CLICKHOUSE_USER="dummy"
ENV CLICKHOUSE_PASSWORD="dummy"
ENV GITHUB_CLIENT_ID="dummy"
ENV GITHUB_CLIENT_SECRET="dummy"
ENV GOOGLE_CLIENT_ID="dummy"
ENV GOOGLE_CLIENT_SECRET="dummy"
ENV PUBLIC_URL="http://localhost:3001"
ENV BETTER_AUTH_URL="http://localhost:3000"
ENV BETTER_AUTH_SECRET="dummy_secret_at_least_32_characters_long"

# Build the application (runs prisma generate + next build)
RUN pnpm run build

# Dereference pnpm symlinks so COPY works in runner stage
# prisma CLI + engines are needed for `prisma migrate deploy` at startup
RUN cp -rL node_modules/prisma /tmp/prisma-cli && \
    cp -rL node_modules/@prisma /tmp/prisma-modules && \
    # pnpm may not hoist @prisma/engines to node_modules/@prisma/ — find it
    # in the prisma CLI's own scope within the pnpm virtual store
    if [ ! -d "/tmp/prisma-modules/engines" ]; then \
      PRISMA_NM=$(dirname "$(readlink -f node_modules/prisma)") && \
      if [ -d "$PRISMA_NM/@prisma/engines" ]; then \
        cp -rL "$PRISMA_NM/@prisma/engines" /tmp/prisma-modules/engines; \
      fi; \
    fi

# Stage 3: Production runner
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output (includes server.js + all traced runtime deps)
COPY --from=builder --chown=nextjs:nodejs /app/server/.next/standalone ./

# Copy Prisma schema + migrations for prisma migrate deploy
COPY --from=builder --chown=nextjs:nodejs /app/server/prisma ./prisma

# Copy prisma CLI + engines from builder (avoids hardcoded version + network call)
# Standalone output bundles @prisma/client for runtime, but the CLI + migration
# engine are separate and needed for `prisma migrate deploy` at container startup
COPY --from=builder /tmp/prisma-cli ./node_modules/prisma
COPY --from=builder /tmp/prisma-modules ./node_modules/@prisma
RUN ln -s /app/node_modules/prisma/build/index.js /usr/local/bin/prisma

# Runtime environment
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Version info (baked in at build time)
ARG GIT_COMMIT="unknown"
ARG GIT_BRANCH="unknown"
ARG BUILD_TIME="unknown"
ARG SERVICE_VERSION="unknown"
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV BUILD_TIME=${BUILD_TIME}
ENV SERVICE_VERSION=${SERVICE_VERSION}

USER nextjs

EXPOSE 3001

CMD ["node", "server/server.js"]
