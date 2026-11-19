# syntax=docker/dockerfile:1
# The fleet control plane (staff dashboard + agent/gateway API). Runs TypeScript directly with tsx: the code is small and this keeps the image simple.
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8090
WORKDIR /app
RUN npm install -g npm@11.21.2
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
COPY db ./db
COPY ui ./ui
COPY scripts ./scripts
USER node
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=3s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
