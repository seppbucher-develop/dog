# Dog – Server und Web-Client in einem Container
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY packages packages
RUN npm run build -w @dog/client && npm run build -w @dog/server

FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/seppbucher-develop/dog" \
      org.opencontainers.image.description="Dog – Kartenbrettspiel für 2 bis 6 Spieler"
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 DATA_DIR=/data STATIC_DIR=/app/client BOT_DELAY_MS=900
WORKDIR /app
COPY --from=build /src/packages/server/dist/server.js ./server.js
COPY --from=build /src/packages/client/dist ./client
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
