FROM node:lts AS builder
# FROM node:18-alpine AS builder
WORKDIR /app

# Only build-time configuration, not secrets or runtime URLs
ARG VITE_IS_DOCKER=true
ARG VITE_ENV=production
ARG NODE_ENV=production

ENV VITE_IS_DOCKER=${VITE_IS_DOCKER}
ENV VITE_ENV=${VITE_ENV}
ENV NODE_ENV=${NODE_ENV}

COPY . .
RUN npm install -g pnpm && pnpm i && pnpm build

FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
