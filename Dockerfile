# Lexicast server: no build step (Node runs the TypeScript directly); one runtime dependency (nodemailer), installed from the lock file.
FROM node:24-alpine
ENV NODE_ENV=production \
    LEXICAST_HOST=0.0.0.0 \
    LEXICAST_PORT=8787 \
    LEXICAST_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
RUN addgroup -S lexicast && adduser -S -G lexicast -H lexicast \
    && mkdir /data && chown lexicast:lexicast /data
USER lexicast
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.LEXICAST_PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.ts"]
