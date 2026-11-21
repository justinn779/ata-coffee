# ATA Coffee Management System — 正式環境容器映像
# 建置：docker build -t ata-coffee .
# 執行：docker run -p 3000:3000 --env-file .env.production -v ata-storage:/app/storage ata-coffee
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
# 保留 optional 依賴（Tailwind / LightningCSS 的原生執行檔），略過 postinstall 後再明確產生 Prisma Client
RUN npm ci --ignore-scripts && npx prisma generate

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates postgresql-client && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 STORAGE_LOCAL_DIR=/app/storage
COPY --from=build /app ./
RUN mkdir -p /app/storage
# 註：雲端平台掛載的持久化磁碟通常屬於 root，因此此映像以預設使用者執行以確保可寫入上傳檔案。
EXPOSE 3000
# 啟動流程：套用尚未執行的 migration（非破壞性）→ 若設定了 ADMIN_EMAIL/ADMIN_PASSWORD 且帳號不存在則建立管理員 → 啟動
CMD ["sh", "-c", "npx prisma migrate deploy && node scripts/bootstrap-admin.mjs && npx next start -p ${PORT}"]
