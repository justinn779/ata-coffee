// 本機開發用 PostgreSQL 17（不需 Docker）。
// 使用 @embedded-postgres/windows-x64 等套件內附之正式 PostgreSQL 執行檔。
// 因 Windows 版 PostgreSQL 無法處理非 ASCII 安裝路徑（例如「桌面」），
// 先將執行檔複製到 %LOCALAPPDATA%\ata-coffee\pgbin，資料放在 %LOCALAPPDATA%\ata-coffee\pgdata。
// 僅供開發與測試；正式環境請使用 Supabase / 託管 PostgreSQL。
//
// 用法：node scripts/local-db.mjs [start|stop|status]
import { cpSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const password = process.env.LOCAL_PG_PASSWORD ?? "ata_local_dev";
const base = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "ata-coffee");
const binRoot = path.join(base, "pgbin");
const dataDir = path.join(base, "pgdata");
const ext = process.platform === "win32" ? ".exe" : "";

function platformPkg() {
  const map = { win32: "windows", darwin: "darwin", linux: "linux" };
  return `@embedded-postgres/${map[process.platform]}-${process.arch}`;
}

function ensureBinaries() {
  const marker = path.join(binRoot, "bin", "pg_ctl" + ext);
  if (existsSync(marker)) return;
  const pkgDir = path.resolve("node_modules", ...platformPkg().split("/"));
  const native = path.join(pkgDir, "native");
  console.log(`[local-db] 複製 PostgreSQL 執行檔到 ${binRoot}`);
  mkdirSync(binRoot, { recursive: true });
  cpSync(native, binRoot, { recursive: true });
}

const bin = (n) => path.join(binRoot, "bin", n + ext);
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    console.error(r.stdout, r.stderr);
    throw new Error(`${path.basename(cmd)} 失敗（code ${r.status}）`);
  }
  return r;
};

function init() {
  if (existsSync(path.join(dataDir, "PG_VERSION"))) return;
  console.log(`[local-db] 初始化資料目錄 ${dataDir}`);
  mkdirSync(base, { recursive: true });
  const pwfile = path.join(base, "pwfile.tmp");
  writeFileSync(pwfile, password);
  try {
    run(bin("initdb"), ["-D", dataDir, "-U", "postgres", "-A", "scram-sha-256", "--pwfile", pwfile, "--locale=C", "-E", "UTF8"], {
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    });
  } finally {
    rmSync(pwfile, { force: true });
  }
}

function status() {
  return run(bin("pg_ctl"), ["-D", dataDir, "status"], { allowFail: true }).status === 0;
}

function start() {
  ensureBinaries();
  init();
  if (!status()) {
    run(bin("pg_ctl"), ["-D", dataDir, "-l", path.join(base, "postgres.log"), "-o", `-p ${port} -h 127.0.0.1`, "-w", "start"], { stdio: "ignore" });
  }
  for (const db of ["ata_dev", "ata_test"]) {
    const r = run(bin("createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", db], {
      allowFail: true,
      env: { ...process.env, PGPASSWORD: password },
    });
    if (r.status === 0) console.log(`[local-db] 建立資料庫 ${db}`);
  }
  console.log(`[local-db] PostgreSQL 已啟動於 127.0.0.1:${port}（資料庫 ata_dev / ata_test）`);
}

function stop() {
  if (status()) run(bin("pg_ctl"), ["-D", dataDir, "-m", "fast", "stop"]);
  console.log("[local-db] 已停止");
}

const cmd = process.argv[2] ?? "start";
if (cmd === "start") start();
else if (cmd === "stop") stop();
else if (cmd === "status") console.log(status() ? "執行中" : "未執行");
else console.log("用法：node scripts/local-db.mjs [start|stop|status]");
