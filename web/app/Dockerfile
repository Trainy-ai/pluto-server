# Stage 1: Build the frontend from the pnpm workspace.
#
# The build context is the `web/` workspace root (not web/app) so the build
# can use the committed pnpm-lock.yaml. Installing with --frozen-lockfile
# keeps the whole dependency tree — including transitive deps — reproducible;
# a standalone `pnpm i` on web/app/package.json alone re-resolves transitive
# deps on every build and can pick incompatible versions. Mirrors
# web/server/Dockerfile.
FROM node:22 AS builder
WORKDIR /app

# Only build-time configuration, not secrets or runtime URLs
ARG VITE_IS_DOCKER=true
ARG VITE_ENV=production
ARG NODE_ENV=production

# Build-time version info
ARG GIT_COMMIT="unknown"
ARG GIT_BRANCH="unknown"
ARG BUILD_TIME="unknown"
ARG SERVICE_VERSION="unknown"

ENV VITE_IS_DOCKER=${VITE_IS_DOCKER}
ENV VITE_ENV=${VITE_ENV}
ENV NODE_ENV=${NODE_ENV}

# Pin pnpm to the project's packageManager version — pnpm 11+ exits non-zero
# on ignored build scripts (warning becomes a hard error) which breaks the
# image build even though the warning is benign for our deps.
RUN npm install -g pnpm@10.9.0

# Copy workspace config + lockfile + every package manifest first so the
# dependency layer caches independently of source changes. All workspace
# manifests are needed for pnpm to resolve the workspace from the lockfile.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY app/package.json ./app/
COPY server/package.json ./server/

# Install with the frozen lockfile — reproducible, no transitive drift.
RUN pnpm install --frozen-lockfile --filter @mlop/app

# Copy the app source and build.
COPY app/ ./app/
RUN pnpm --filter @mlop/app build

# Stage 2: nginx static server
FROM nginx:stable-alpine

# Re-declare ARGs for this stage (ARGs don't carry across stages)
ARG GIT_COMMIT="unknown"
ARG GIT_BRANCH="unknown"
ARG BUILD_TIME="unknown"
ARG SERVICE_VERSION="unknown"

COPY --from=builder /app/app/dist /usr/share/nginx/html
COPY app/nginx.conf /etc/nginx/conf.d/default.conf
COPY app/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Version info (passed to entrypoint.sh for runtime injection)
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV BUILD_TIME=${BUILD_TIME}
ENV SERVICE_VERSION=${SERVICE_VERSION}

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
