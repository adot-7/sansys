# Multi-stage build: React client (built into server/public) + Express server.
FROM node:20 AS build-client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=build-client /app/server/public ./public
EXPOSE 8080
CMD ["node", "src/index.js"]