FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/contracts ./packages/contracts
COPY packages/database ./packages/database
RUN pnpm install --frozen-lockfile && pnpm --filter @supportdesk/api build
FROM node:24-alpine
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
RUN wget -q https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -O /app/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-global-bundle.pem
COPY --from=build /app ./
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
