import { config } from "../apps/server/src/config.js";
import { connectDatabase } from "../apps/server/src/database.js";
import { initializeDatabase } from "../database/schema.js";
import { demoDefinition } from "../database/seed.js";
import { SurveyService } from "../apps/server/src/service.js";
import { ObjectId } from "mongodb";
import argon2 from "argon2";
import { passwordIssues } from "../packages/shared/src/auth.js";
const cfg = config(),
  d = await connectDatabase(cfg.uri);
try {
  await initializeDatabase(d.db);
  if (process.argv[2] === "seed") {
    const password = process.env.DEMO_PASSWORD;
    if (!password || passwordIssues(password).length)
      throw new Error(
        `请先设置符合要求的 DEMO_PASSWORD：${passwordIssues(password ?? "")
          .map((issue) => issue.message)
          .join("；")}`,
      );
    const existing = await d.users.findOne({ usernameNormalized: "demo" });
    let user = existing;
    if (!user) {
      user = {
        _id: new ObjectId(),
        schemaVersion: 1,
        username: "demo",
        usernameNormalized: "demo",
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await d.users.insertOne(user);
    }
    const service = new SurveyService(d, cfg);
    if (!(await d.surveys.findOne({ ownerId: user._id }))) {
      const s = await service.create(user._id, demoDefinition());
      await service.publish(s._id.toHexString(), user._id, s.revision);
      console.log("演示问卷已创建，账号 demo；密码使用提供的 DEMO_PASSWORD");
    } else console.log("演示账号和问卷已存在，不重复导入");
  }
  console.log("八个集合、数据库校验与索引已就绪（兼容第一阶段数据）");
} finally {
  await d.client.close();
}
