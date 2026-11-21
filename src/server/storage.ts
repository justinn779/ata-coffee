import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DomainError } from "@/lib/errors";

/**
 * 檔案儲存 Adapter。
 *  - local：存放於 STORAGE_LOCAL_DIR（開發／自架主機）
 *  - supabase：尚未實作（需 Supabase 專案與 service-role key，僅能在伺服器端使用；見 DEPLOYMENT.md）
 * 所有上傳皆驗證副檔名、MIME 類型與檔案大小；檔案僅能透過需登入的 /api/files 讀取。
 */
export const UPLOAD_RULES = {
  curve: { exts: [".csv", ".txt", ".alog"], mimes: ["text/csv", "text/plain", "application/octet-stream", "application/vnd.ms-excel", ""], maxBytes: 5 * 1024 * 1024 },
  image: { exts: [".jpg", ".jpeg", ".png", ".webp"], mimes: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 },
  document: { exts: [".pdf", ".jpg", ".jpeg", ".png"], mimes: ["application/pdf", "image/jpeg", "image/png"], maxBytes: 10 * 1024 * 1024 },
} as const;
export type UploadKind = keyof typeof UPLOAD_RULES;

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  ".png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  ".jpg": (b) => b[0] === 0xff && b[1] === 0xd8,
  ".jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  ".webp": (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  ".pdf": (b) => b.subarray(0, 5).toString() === "%PDF-",
};

export async function validateUpload(file: File, kind: UploadKind): Promise<Buffer> {
  const rule = UPLOAD_RULES[kind];
  const ext = path.extname(file.name).toLowerCase();
  if (!(rule.exts as readonly string[]).includes(ext)) throw new DomainError(`不支援的檔案類型 ${ext || "(無副檔名)"}，允許：${rule.exts.join("、")}`);
  if (!(rule.mimes as readonly string[]).includes(file.type)) throw new DomainError(`檔案 MIME 類型不符（${file.type || "未知"}）`);
  if (file.size > rule.maxBytes) throw new DomainError(`檔案過大（上限 ${rule.maxBytes / 1024 / 1024}MB）`);
  if (file.size === 0) throw new DomainError("檔案是空的");
  const buf = Buffer.from(await file.arrayBuffer());
  const magic = MAGIC[ext];
  if (magic && !magic(buf)) throw new DomainError("檔案內容與副檔名不符");
  if (kind === "curve" && buf.includes(0)) throw new DomainError("曲線檔應為純文字檔");
  return buf;
}

function baseDir() {
  return path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage");
}

export async function putObject(buf: Buffer, folder: string, originalName: string): Promise<string> {
  if ((process.env.STORAGE_DRIVER ?? "local") !== "local") throw new DomainError("目前僅實作 local 儲存驅動，請設定 STORAGE_DRIVER=local");
  const ext = path.extname(originalName).toLowerCase();
  const key = `${folder.replace(/[^a-z0-9-]/gi, "")}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
  const full = path.join(baseDir(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  return key;
}

export async function getObject(key: string): Promise<Buffer> {
  if (!/^[a-z0-9-]+\/\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]+$/i.test(key)) throw new DomainError("無效的檔案路徑");
  return readFile(path.join(baseDir(), key));
}
