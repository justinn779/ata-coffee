// 資料庫備份：使用 pg_dump 產生自訂格式備份檔（可用 pg_restore 還原）。
// 優先使用系統 PATH 中的 pg_dump；本機開發則使用 local-db 複製的執行檔。
//   npm run backup                → 備份 DATABASE_URL（讀取 .env）
//   BACKUP_DIR=D:\backups npm run backup
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import "dotenv/config";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}
const outDir = path.resolve(process.env.BACKUP_DIR ?? "backups");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const file = path.join(outDir, `ata-${stamp}.dump`);

const localBin = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "ata-coffee", "pgbin", "bin", "pg_dump" + (process.platform === "win32" ? ".exe" : ""));
const bin = existsSync(localBin) ? localBin : "pg_dump";
// 移除 Prisma 專用的 ?schema= 參數
const pgUrl = url.replace(/[?&]schema=[^&]+/, "");
const r = spawnSync(bin, ["--format=custom", "--no-owner", "--no-privileges", "--file", file, pgUrl], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("備份失敗；請確認已安裝 PostgreSQL 用戶端工具（pg_dump）且版本 ≥ 伺服器版本。");
  process.exit(1);
}
console.log(`備份完成：${file}（${(statSync(file).size / 1024).toFixed(1)} KB）`);
console.log("還原範例（請先在測試資料庫驗證）：pg_restore --clean --if-exists --no-owner -d <DATABASE_URL> " + file);
console.log("提醒：上傳檔案目錄（STORAGE_LOCAL_DIR）需另外備份。");
