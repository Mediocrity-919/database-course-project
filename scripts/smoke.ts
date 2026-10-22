import "dotenv/config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import assert from "node:assert/strict";
const uri =
  process.env.MONGODB_TEST_URI ??
  "mongodb://127.0.0.1:27018/questionnaire_test?replicaSet=survey-rs";
if (new MongoClient(uri).db().databaseName !== "questionnaire_test")
  throw Error("冒烟测试只允许使用 questionnaire_test");
const origin = "http://127.0.0.1:3011";
let cookie = "",
  csrf = "";
const child = spawn(process.execPath, ["dist/apps/server/src/index.js"], {
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    PORT: "3011",
    APP_ORIGIN: origin,
    PUBLIC_BASE_URL: origin,
    MONGODB_URI: uri,
    COOKIE_SECURE: "false",
  },
});
let output = "";
child.stdout.on("data", (x) => {
  output += x;
});
child.stderr.on("data", (x) => {
  output += x;
});
async function call(path: string, method = "GET", body?: object) {
  const r = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body
        ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const data = await r.json();
  assert.ok(r.ok, `${path}: ${r.status} ${JSON.stringify(data)}`);
  if (data.csrfToken) csrf = data.csrfToken;
  return data;
}
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(origin + "/api/v1/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, `服务器未就绪：${output}`);
  assert.equal((await fetch(origin + "/dashboard")).status, 200);
  assert.equal((await fetch(origin + "/api/v1/missing")).status, 404);
  const username = "smoke_" + randomUUID().slice(0, 8),
    password = "Smoke-only-check-123!";
  await call("/auth/register", "POST", { username, password });
  await call("/auth/login", "POST", { username, password });
  const s = await call("/surveys", "POST", {}),
    qid = randomUUID();
  const def = {
    title: "HTTP冒烟问卷",
    description: "自动化冒烟数据",
    settings: {
      allowAnonymous: true,
      allowMultipleSubmissions: false,
      allowEditAfterSubmission: true,
    },
    questions: [
      {
        id: qid,
        order: 1,
        type: "number",
        title: "年龄",
        description: "",
        required: true,
        validation: { min: 0, max: 120, integerOnly: true },
        logic: {
          matchMode: "first_match",
          rules: [],
          defaultAction: { action: "next" },
        },
      },
    ],
  };
  const saved = await call(`/surveys/${s._id}/draft`, "PUT", {
    revision: 1,
    definition: def,
    deadlineAt: null,
  });
  await call(`/surveys/${s._id}/publish`, "POST", { revision: saved.revision });
  const share = await call(`/surveys/${s._id}/share`);
  assert.ok(share.url.startsWith(origin));
  const a = await call(`/public/surveys/${s.publicId}/attempts`, "POST", {
    clientAttemptId: randomUUID(),
    isAnonymous: true,
  });
  let r = await call(`/attempts/${a.attempt.id}/submit`, "POST", {
    revision: a.attempt.revision,
    answers: [{ questionId: qid, value: 20 }],
    submissionId: randomUUID(),
  });
  const e = await call(`/attempts/${r.id}/edit`, "POST", {
    revision: r.revision,
  });
  r = await call(`/attempts/${r.id}/submit`, "POST", {
    revision: e.attempt.revision,
    answers: [{ questionId: qid, value: 30 }],
    submissionId: randomUUID(),
  });
  const stats = await call(`/surveys/${s._id}/stats`);
  assert.equal(stats.totalSubmissions, 1);
  assert.equal(stats.uniqueRespondents, 1);
  assert.equal(stats.questions[0].average, 30);
  await call(`/surveys/${s._id}/close`, "POST", {});
  console.log(
    "PASS HTTP冒烟：生产构建静态路由、健康检查、注册登录、创建发布、分享URL、匿名提交、修改原答卷、去重统计与关闭。",
  );
} finally {
  child.kill();
}
