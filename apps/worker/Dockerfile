# The worker runs TypeScript directly on Node, which strips the types at load
# time. No build step, and the source in the image is the source in the repo.
FROM node:22-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter @stackkeeper/worker...

COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/worker apps/worker

RUN addgroup -g 1001 -S nodejs && adduser -S worker -u 1001 && chown -R worker:nodejs /app
USER worker
CMD ["node", "apps/worker/src/index.ts"]
