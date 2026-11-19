# syntax=docker/dockerfile:1
# The remote-access gateway: carries remote users' requests through each site's outbound tunnel. Holds no business data.
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8443
WORKDIR /app
RUN npm install -g npm@11.21.2
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
USER node
EXPOSE 8443
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/__gateway/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
