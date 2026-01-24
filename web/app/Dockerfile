FROM node:lts AS builder
# FROM node:18-alpine AS builder
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

COPY . .
RUN npm install -g pnpm && pnpm i && pnpm build

FROM nginx:stable-alpine

# Re-declare ARGs for this stage (ARGs don't carry across stages)
ARG GIT_COMMIT="unknown"
ARG GIT_BRANCH="unknown"
ARG BUILD_TIME="unknown"
ARG SERVICE_VERSION="unknown"

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Version info (passed to entrypoint.sh for runtime injection)
ENV GIT_COMMIT=${GIT_COMMIT}
ENV GIT_BRANCH=${GIT_BRANCH}
ENV BUILD_TIME=${BUILD_TIME}
ENV SERVICE_VERSION=${SERVICE_VERSION}

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
