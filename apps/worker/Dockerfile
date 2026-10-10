FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --filter @zephyr/worker... && pnpm --filter @zephyr/domain build && pnpm --filter @zephyr/server build && pnpm --filter @zephyr/worker build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app /app
WORKDIR /app/apps/worker
EXPOSE 8081
CMD ["node", "dist/index.js"]
