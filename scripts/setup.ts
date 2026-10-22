import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
mkdirSync(".local", { recursive: true });
if (!existsSync(".env")) {
  writeFileSync(
    ".env",
    readFileSync(".env.example", "utf8").replace(
      "generate-with-npm-run-setup",
      randomBytes(32).toString("hex"),
    ),
  );
  console.log("已创建 .env（随机密钥已持久保存，不输出到终端）");
} else console.log(".env 已存在，保持现有配置和密钥");
