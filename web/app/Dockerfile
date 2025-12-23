FROM node:lts AS builder
# FROM node:18-alpine AS builder
WORKDIR /app

ARG VITE_IS_DOCKER
ARG VITE_ENV
ARG VITE_SERVER_URL
ARG PUBLIC_URL
ARG NODE_ENV
ENV VITE_IS_DOCKER=${VITE_IS_DOCKER}
ENV VITE_ENV=${VITE_ENV}
ENV VITE_SERVER_URL=${VITE_SERVER_URL}
ENV PUBLIC_URL=${PUBLIC_URL}

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
