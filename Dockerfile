# ATA Coffee Management System — 正式環境容器映像
# 建置：docker build -t ata-coffee .
# 執行：docker run -p 3000:3000 --env-file .env.production -v ata-storage:/app/storage ata-coffee
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=optional --ignore-scripts && npx prisma generate

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 STORAGE_LOCAL_DIR=/app/storage
COPY --from=build /app ./
RUN useradd -m ata && mkdir -p /app/storage && chown -R ata /app/storage
USER ata
EXPOSE 3000
# 啟動前套用尚未執行的 migration（非破壞性），再啟動伺服器
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p ${PORT}"]
