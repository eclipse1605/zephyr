FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web ./apps/web
RUN bun install --frozen-lockfile --filter @zephyr/web
RUN bun run --filter @zephyr/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
