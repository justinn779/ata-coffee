// 建置連線本機 Firebase 模擬器的靜態網站（與 GitHub Pages 相同的 /ata-coffee 子路徑），供 E2E 與本機預覽。
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_BASE_PATH: "/ata-coffee", NEXT_PUBLIC_USE_EMULATORS: "1", MSYS_NO_PATHCONV: "1" },
});
process.exit(r.status ?? 1);
