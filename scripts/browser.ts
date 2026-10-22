import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync } from "node:fs";
import { MongoClient } from "mongodb";
const uri =
  process.env.MONGODB_TEST_URI ??
  "mongodb://127.0.0.1:27018/questionnaire_test?replicaSet=survey-rs";
if (new MongoClient(uri).db().databaseName !== "questionnaire_test")
  throw Error("浏览器测试只允许使用 questionnaire_test");
mkdirSync(".local/qa", { recursive: true });
const base = process.env.PLAYWRIGHT_TEST_ORIGIN ?? "http://127.0.0.1:3010",
  external = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1";
const browserOrigin = new URL(base);
if (browserOrigin.protocol !== "http:" || browserOrigin.port !== "3010")
  throw Error("浏览器测试入口必须为HTTP且使用独立3010端口");
const fd = openSync(".local/qa/browser-server.log", "a");
const server = external
  ? null
  : spawn(process.execPath, ["dist/apps/server/src/index.js"], {
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      env: {
        ...process.env,
        PORT: "3010",
        HOST: browserOrigin.hostname,
        MONGODB_URI: uri,
        APP_ORIGIN: base,
        PUBLIC_BASE_URL: base,
        COOKIE_SECURE: "false",
      },
    });
closeSync(fd);
let exit = 1;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server && server.exitCode !== null)
      throw Error(
        "测试服务启动失败：" +
          readFileSync(".local/qa/browser-server.log", "utf8"),
      );
    try {
      if ((await fetch(base + "/api/v1/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw Error("测试服务启动超时，请检查3010端口和MongoDB副本集");
  const cli = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, PLAYWRIGHT_EXTERNAL_SERVER: "1" },
    },
  );
  exit = await new Promise<number>((resolve, reject) => {
    cli.once("error", reject);
    cli.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  if (server) {
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once("exit", () => resolve());
      setTimeout(resolve, 3000).unref();
    });
  }
}
process.exitCode = exit;
