# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install -g npm@11.21.2
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx nest build

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g npm@11.21.2
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The migration image: the same code, plus the tooling to apply db/migrations as the owner role.
FROM node:22-bookworm-slim AS migrate
WORKDIR /app
RUN npm install -g npm@11.21.2
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY db ./db
ENV NODE_ENV=production
USER node
CMD ["npx", "tsx", "src/db/cli.ts", "up"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY db ./db
COPY package.json ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
