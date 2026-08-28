FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY packages ./packages
COPY services/evidence-service ./services/evidence-service
COPY edge/analytics ./edge/analytics
COPY edge/edge-agent ./edge/edge-agent
COPY edge/vision-runtime/src ./edge/vision-runtime/src
CMD ["sh", "-c", "node edge/vision-runtime/src/simulate-tracks.mjs | node edge/analytics/src/track-bridge.mjs"]
