# Lexicast server. Stage 1 builds the editor UI (Vite, dev dependencies); the final image has no build tools:
# Node runs the TypeScript directly, one runtime dependency (nodemailer) from the lock file, plus the built UI files.
FROM node:24-alpine AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.ts ./
COPY web ./web
RUN npm run build:web

FROM node:24-alpine
ENV NODE_ENV=production \
    LEXICAST_HOST=0.0.0.0 \
    LEXICAST_PORT=8787 \
    LEXICAST_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY --from=web /build/dist/web ./dist/web
RUN addgroup -S lexicast && adduser -S -G lexicast -H lexicast \
    && mkdir /data && chown lexicast:lexicast /data
USER lexicast
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.LEXICAST_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.ts"]
