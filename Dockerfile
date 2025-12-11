# syntax=docker/dockerfile:1

# === Build stage ===
FROM node:20-alpine AS build
WORKDIR /app

COPY src ./src
COPY tsconfig.json tsconfig.build.json ./
COPY package.json package-lock.json* ./

# Install deps first (better cache)
RUN npm ci --no-audit --no-fund

# Copy sources and build
RUN npm run build

# === Runtime stage ===
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only necessary files
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist

# Default environment variables (can be overridden at runtime)
ENV MYSQL_PORT=3306 \
    MYSQL_SSL=off \
    MYSQL_CONNECT_TIMEOUT_MS=10000 \
    MYSQL_QUERY_TIMEOUT_MS=60000 \
    MYSQL_POOL_MIN=0 \
    MYSQL_POOL_MAX=10 \
    MAX_ROWS=10000 \
    LOG_LEVEL=info

# No ports exposed: stdio transport only

ENTRYPOINT ["node", "dist/index.js"]
