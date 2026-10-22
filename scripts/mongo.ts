import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MongoClient } from "mongodb";
const direct = "mongodb://127.0.0.1:27018/?directConnection=true";
const probe = async () => {
  const c = new MongoClient(direct, { serverSelectionTimeoutMS: 800 });
  try {
    await c.connect();
    return await c.db().admin().command({ hello: 1 });
  } finally {
    await c.close();
  }
};
let hello = await probe().catch(() => null);
if (hello && !hello.setName)
  throw new Error(
    "27018 已被非本项目副本集实例使用，请选择其他端口，脚本不会修改现有实例",
  );
if (hello && hello.setName !== "survey-rs")
  throw new Error("27018 属于其他副本集，停止操作");
if (!hello) {
  const dbpath = resolve(".local/mongo-rs");
  mkdirSync(dbpath, { recursive: true });
  const exe =
    process.env.MONGOD_PATH ??
    (existsSync("D:\\mongodb\\bin\\mongod.exe")
      ? "D:\\mongodb\\bin\\mongod.exe"
      : "mongod");
  const child = spawn(
    exe,
    [
      "--dbpath",
      dbpath,
      "--port",
      "27018",
      "--bind_ip",
      "127.0.0.1",
      "--replSet",
      "survey-rs",
      "--logpath",
      resolve(".local/mongodb.log"),
      "--logappend",
    ],
    { detached: true, windowsHide: true, stdio: "ignore" },
  );
  child.on("error", (e) => console.error("mongod 启动失败：", e.message));
  child.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    hello = await probe().catch(() => null);
    if (hello) break;
  }
  if (!hello) throw new Error("MongoDB 启动失败，请查看 .local/mongodb.log");
}
const c = new MongoClient(direct, { serverSelectionTimeoutMS: 3000 });
await c.connect();
try {
  if (!hello.setName)
    await c
      .db()
      .admin()
      .command({
        replSetInitiate: {
          _id: "survey-rs",
          members: [{ _id: 0, host: "127.0.0.1:27018" }],
        },
      });
  for (let i = 0; i < 40; i++) {
    const h = await c.db().admin().command({ hello: 1 });
    if (h.isWritablePrimary) {
      console.log("MongoDB survey-rs 已就绪，端口 27018（本机开发实例）");
      break;
    }
    if (i === 39) throw new Error("等待 PRIMARY 超时");
    await new Promise((r) => setTimeout(r, 500));
  }
} finally {
  await c.close();
}
