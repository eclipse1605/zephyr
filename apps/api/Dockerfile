FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --filter @zephyr/api... && pnpm --filter @zephyr/domain build && pnpm --filter @zephyr/server build && pnpm --filter @zephyr/api build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 8080
CMD ["node", "dist/index.js"]
