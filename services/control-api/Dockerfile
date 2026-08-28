FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run command-ui-react:build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/apps/command-ui ./apps/command-ui
COPY --from=build /app/apps/command-ui-react/dist ./apps/command-ui-react/dist
COPY --from=build /app/packages ./packages
COPY --from=build /app/services ./services
COPY --from=build /app/edge/edge-agent/src ./edge/edge-agent/src
EXPOSE 7080
CMD ["node", "services/control-api/src/server.mjs"]
