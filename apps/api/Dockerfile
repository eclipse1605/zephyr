FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN bun install --frozen-lockfile --filter @zephyr/api
RUN bun run --filter @zephyr/domain build && bun run --filter @zephyr/server build && bun run --filter @zephyr/api build

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["bun", "dist/index.js"]
