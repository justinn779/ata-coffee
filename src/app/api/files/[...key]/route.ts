import { getCurrentUser } from "@/server/auth";
import { getObject } from "@/server/storage";

const TYPES: Record<string, string> = { csv: "text/csv; charset=utf-8", txt: "text/plain; charset=utf-8", alog: "text/plain; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };

/** 需登入才能讀取的上傳檔案（原始曲線檔、發票、圖片） */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (!(await getCurrentUser())) return new Response("未登入", { status: 401 });
  const key = (await params).key.join("/");
  try {
    const buf = await getObject(key);
    const ext = key.split(".").pop()!.toLowerCase();
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Content-Disposition": ["csv", "txt", "alog"].includes(ext) ? `attachment; filename="${key.split("/").pop()}"` : "inline",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("找不到檔案", { status: 404 });
  }
}
