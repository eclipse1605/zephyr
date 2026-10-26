FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN bun install --frozen-lockfile --filter @zephyr/worker
RUN bun run --filter @zephyr/domain build && bun run --filter @zephyr/server build && bun run --filter @zephyr/worker build

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/worker
EXPOSE 8081
CMD ["bun", "dist/index.js"]
