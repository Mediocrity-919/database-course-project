// npm run db:verify [-- --test] [-- --baseline latest|<dir>] [-- --out <file>]
// Read-only: prints each check and writes a JSON report (IDs only, no answers or usernames).
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { MongoClient } from "mongodb";
import { latestBackup, verifyDatabase } from "../database/verify.js";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const test = args.includes("--test");
const uri = test
  ? (process.env.MONGODB_TEST_URI ??
    "mongodb://127.0.0.1:27018/questionnaire_test?replicaSet=survey-rs")
  : (process.env.MONGODB_URI ??
    "mongodb://127.0.0.1:27018/questionnaire_stage1?replicaSet=survey-rs");
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
let exitCode = 1;
try {
  await client.connect();
  const db = client.db();
  let baselineDir = flag("--baseline");
  if (baselineDir === "latest") {
    baselineDir = latestBackup(db.databaseName);
    if (!baselineDir)
      throw new Error(`没有找到数据库 ${db.databaseName} 的备份，请先运行 npm run db:backup`);
  }
  const report = await verifyDatabase(db, {
    baselineDir: baselineDir ? resolve(baselineDir) : undefined,
  });
  console.log(`数据库一致性检查：${report.database}（只读）`);
  console.log("文档数量：", JSON.stringify(report.counts));
  for (const c of report.checks) {
    const mark = c.problems.length
      ? c.level === "error"
        ? "FAIL"
        : "WARN"
      : "PASS";
    console.log(`[${mark}] ${c.id}：${c.title}（检查${c.checked}项）`);
    for (const p of c.problems.slice(0, 30)) console.log(`       - ${p}`);
    if (c.problems.length > 30)
      console.log(`       … 另有${c.problems.length - 30}条，详见JSON报告`);
  }
  const out = resolve(
    flag("--out") ??
      `.local/qa/db-verify-${report.database}-${report.generatedAt.replace(/[:.]/g, "-")}.json`,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(
    `结论：${report.ok ? "通过" : "未通过"}，错误${report.errors}条，提示${report.warnings}条；报告 ${out}`,
  );
  exitCode = report.ok ? 0 : 1;
} catch (e) {
  console.error("数据库检查无法完成：", (e as Error).message);
} finally {
  await client.close();
  process.exitCode = exitCode;
}
