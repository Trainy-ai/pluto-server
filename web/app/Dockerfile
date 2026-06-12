# Previous releases to bake in alongside this build (for the version switcher).
# Declared at the top in GLOBAL scope because ARGs referenced by a FROM must be
# declared before the first FROM — otherwise they're stage-scoped and resolve
# to blank in `FROM ${PREV_IMAGE_x}` below. Default to the `self` stage so a
# plain build (docker compose, local docker build, first release) is a
# single-version no-op. CI overrides these with real image refs.
ARG PREV_IMAGE_1=self
ARG PREV_IMAGE_2=self

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

# Stage 1b: the canonical, version-pure build for THIS release.
#
# Kept at a stable path so (a) this image can assemble its own /v/<version>/
# entry and (b) the *next* release can pull just this version's files via
# `COPY --from=asaiacai/mlop-frontend:<this-version> /srv/self`. Because Vite
# emits absolute, content-hashed asset paths, every release's assets are
# globally unique and can be merged into one /assets/ dir without collisions —
# only index.html differs per version.
FROM scratch AS self
COPY --from=builder /app/app/dist /srv/self

# Previous releases to bake in alongside this one (for the version switcher).
# PREV_IMAGE_1/2 are declared at the top of the file (global scope, required for
# use in FROM); default to the `self` stage so plain builds stay single-version.
# CI passes real image refs for the last two releases; it only passes images
# that contain /srv/self (older pre-feature images are skipped).
FROM ${PREV_IMAGE_1} AS prev1
FROM ${PREV_IMAGE_2} AS prev2

# Stage 2: nginx static server
FROM nginx:stable-alpine

# Re-declare ARGs for this stage (ARGs don't carry across stages)
ARG GIT_COMMIT="unknown"
ARG GIT_BRANCH="unknown"
ARG BUILD_TIME="unknown"
ARG SERVICE_VERSION="unknown"
ARG PREV_VERSION_1=""
ARG PREV_VERSION_2=""

# Current build at the web root (latest, served when no version is pinned).
COPY --from=builder /app/app/dist /usr/share/nginx/html

# Persist this version's pure build so the next release can consume it.
COPY --from=self /srv/self /srv/self

# Pull the previous releases' pure builds into staging for assembly.
COPY --from=prev1 /srv/self /tmp/prev1
COPY --from=prev2 /srv/self /tmp/prev2

# Assemble the multi-version layout:
#   /index.html              -> latest
#   /v/<version>/index.html  -> per-version entry documents
#   /assets/<hash>.{js,css}  -> union of all versions' assets (hashes => unique)
#   /versions.json           -> manifest consumed by the in-app switcher
RUN set -eu; \
    html=/usr/share/nginx/html; \
    mkdir -p "$html/v" "$html/assets"; \
    add_version() { \
      src="$1"; ver="$2"; \
      [ -z "$ver" ] && return 0; \
      [ -f "$src/index.html" ] || return 0; \
      mkdir -p "$html/v/$ver"; \
      cp -a "$src/index.html" "$html/v/$ver/index.html"; \
      if [ -d "$src/assets" ]; then cp -a "$src/assets/." "$html/assets/"; fi; \
    }; \
    add_version /srv/self "${SERVICE_VERSION}"; \
    add_version /tmp/prev1 "${PREV_VERSION_1}"; \
    add_version /tmp/prev2 "${PREV_VERSION_2}"; \
    versions=""; \
    for v in "${SERVICE_VERSION}" "${PREV_VERSION_1}" "${PREV_VERSION_2}"; do \
      [ -z "$v" ] && continue; \
      case ",$versions," in *",$v,"*) continue ;; esac; \
      versions="${versions:+$versions,}$v"; \
    done; \
    json=""; oldifs=$IFS; IFS=,; \
    for v in $versions; do json="${json:+$json, }\"$v\""; done; \
    IFS=$oldifs; \
    printf '{"current": "%s", "versions": [%s]}\n' "${SERVICE_VERSION}" "$json" \
      > "$html/versions.json"; \
    rm -rf /tmp/prev1 /tmp/prev2

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
