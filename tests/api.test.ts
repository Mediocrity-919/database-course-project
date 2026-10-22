import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { ObjectId, MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { connectDatabase, type Database } from "../apps/server/src/database.js";
import { initializeDatabase } from "../database/schema.js";
import { createApp } from "../apps/server/src/app.js";
import { config } from "../apps/server/src/config.js";
import { demoDefinition, makeQuestion } from "../database/seed.js";
import type { Answer, Definition } from "../packages/shared/src/domain.js";

const origin = "http://localhost:3000";
let d: Database, app: ReturnType<typeof createApp>;
type Actor = {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  id: string;
};
let owner: Actor, other: Actor;
const send = (
  actor: Actor,
  method: "post" | "put" | "patch" | "delete",
  url: string,
  body: object = {},
) =>
  actor.agent[method](`/api/v1${url}`)
    .set("Origin", origin)
    .set("X-CSRF-Token", actor.csrf)
    .send(body);
async function actor(name = `u_${randomUUID().slice(0, 8)}`): Promise<Actor> {
  const agent = request.agent(app);
  await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ username: name, password: "Testing-only-843!" })
    .expect(201);
  const r = await agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ username: name, password: "Testing-only-843!" })
    .expect(200);
  return { agent, csrf: r.body.csrfToken, id: r.body.user.id };
}
async function survey(def: Definition = demoDefinition()) {
  const c = await send(owner, "post", "/surveys");
  expect(c.status).toBe(201);
  const saved = await send(owner, "put", `/surveys/${c.body._id}/draft`, {
    revision: 1,
    definition: def,
    deadlineAt: null,
  });
  expect(saved.status).toBe(200);
  const p = await send(owner, "post", `/surveys/${c.body._id}/publish`, {
    revision: saved.body.revision,
  });
  expect(p.status).toBe(200);
  return {
    id: c.body._id,
    publicId: c.body.publicId,
    def,
    versionId: p.body.versionId,
    sourceRevision: saved.body.revision,
  };
}
async function start(
  s: Awaited<ReturnType<typeof survey>>,
  a: Actor = other,
  isAnonymous = true,
) {
  const r = await send(a, "post", `/public/surveys/${s.publicId}/attempts`, {
    clientAttemptId: randomUUID(),
    isAnonymous,
  });
  expect(r.status).toBe(201);
  return r.body.attempt;
}
const valid = (def: Definition, n = 2): Answer[] => [
  { questionId: def.questions[0].id, value: def.questions[0].options![1].id },
  { questionId: def.questions[2].id, value: n },
];
const submit = (
  a: Actor,
  r: any,
  answers: Answer[],
  submissionId = randomUUID(),
) =>
  send(a, "post", `/attempts/${r.id}/submit`, {
    revision: r.revision,
    answers,
    submissionId,
  });
beforeAll(async () => {
  const cfg = config(),
    uri =
      process.env.MONGODB_TEST_URI ??
      "mongodb://127.0.0.1:27018/questionnaire_test?replicaSet=survey-rs";
  if (new MongoClient(uri).db().databaseName !== "questionnaire_test")
    throw new Error("拒绝操作非 questionnaire_test 测试数据库");
  d = await connectDatabase(uri);
  await initializeDatabase(d.db);
  for (const name of [
    "responses",
    "survey_versions",
    "surveys",
    "sessions",
    "users",
  ])
    await d.db.collection(name).deleteMany({});
  app = createApp(d, { ...cfg, uri, origins: [origin], publicBaseUrl: origin });
  owner = await actor("test_owner");
  other = await actor("test_other");
});
afterAll(async () => {
  await d?.client.close();
});
describe("文本长度跨层一致性", () => {
  it.each([1001, 2000])(
    "%i个表情可保存草稿、恢复和正式提交",
    async (length) => {
      const def = demoDefinition();
      const q = makeQuestion("text", "文本边界", 1);
      q.validation = { maxLength: 2000 };
      def.questions = [q];
      const s = await survey(def);
      const attempt = await start(s);
      const value = "😀".repeat(length);
      const answers = [{ questionId: q.id, value }];
      const saved = await send(
        other,
        "put",
        `/attempts/${attempt.id}/answers`,
        {
          revision: attempt.revision,
          answers,
        },
      );
      expect(saved.status).toBe(200);
      const restored = await other.agent
        .get(`/api/v1/attempts/${attempt.id}`)
        .expect(200);
      expect(restored.body.attempt.answers[0].value).toBe(value);
      const submitted = await submit(
        other,
        { ...attempt, revision: saved.body.revision },
        answers,
      );
      expect(submitted.status).toBe(200);
      const stored = await d.responses.findOne({
        _id: new ObjectId(attempt.id),
      });
      expect(stored?.status).toBe("submitted");
      expect(stored?.answers[0].value).toBe(value);
    },
  );
  it("API按规范化后的2000码点校验，数据库保存规范化文本", async () => {
    const def = demoDefinition();
    const q = makeQuestion("text", "换行边界", 1);
    q.validation = { minLength: 2000, maxLength: 2000 };
    def.questions = [q];
    const s = await survey(def);
    const attempt = await start(s);
    const value = ` \r\n${"𠀀".repeat(999)}\r\n${"😀".repeat(1000)}\t `;
    expect(
      (await submit(other, attempt, [{ questionId: q.id, value }])).status,
    ).toBe(200);
    const stored = await d.responses.findOne({ _id: new ObjectId(attempt.id) });
    expect(stored?.answers[0].value).toBe(
      `${"𠀀".repeat(999)}\n${"😀".repeat(1000)}`,
    );
  });
  it("自定义2字符上限允许两个表情，拒绝三个且不产生半提交", async () => {
    const def = demoDefinition();
    const q = makeQuestion("text", "恰好两个字符", 1);
    q.validation = { minLength: 2, maxLength: 2 };
    def.questions = [q];
    const s = await survey(def);
    const attempt = await start(s);
    const rejected = await submit(other, attempt, [
      { questionId: q.id, value: "😀😀😀" },
    ]);
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe("ANSWER_INVALID");
    expect(
      (await d.responses.findOne({ _id: new ObjectId(attempt.id) }))?.status,
    ).toBe("in_progress");
    expect(
      (await submit(other, attempt, [{ questionId: q.id, value: "😀😀" }]))
        .status,
    ).toBe(200);
  });
  it("2001码点被草稿和提交API拒绝，MongoDB直接写入也拒绝", async () => {
    const def = demoDefinition();
    const q = makeQuestion("text", "全局上限", 1);
    q.validation = { maxLength: 2000 };
    def.questions = [q];
    const s = await survey(def);
    const attempt = await start(s);
    const answers = [{ questionId: q.id, value: "😀".repeat(2001) }];
    const saved = await send(other, "put", `/attempts/${attempt.id}/answers`, {
      revision: attempt.revision,
      answers,
    });
    expect(saved.status).toBe(422);
    expect((await submit(other, attempt, answers)).status).toBe(422);
    await expect(
      d.responses.updateOne(
        { _id: new ObjectId(attempt.id) },
        { $set: { answers: [{ ...answers[0], questionType: "text" }] } },
      ),
    ).rejects.toMatchObject({ code: 121 });
    expect(
      (await d.responses.findOne({ _id: new ObjectId(attempt.id) }))?.answers,
    ).toEqual([]);
  });
});
describe("账号、数据隔离与HTTP边界", () => {
  it("用户名大小写唯一，密码不以明文保存", async () => {
    await request(app)
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .send({ username: "TEST_OWNER", password: "Testing-only-843!" })
      .expect(409);
    const u = await d.users.findOne({ _id: new ObjectId(owner.id) });
    expect(u?.passwordHash).toMatch(/^\$argon2id\$/);
  });
  it("错误密码与未登录被拒绝", async () => {
    await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ username: "test_owner", password: "wrong-pass" })
      .expect(401);
    await request(app).get("/api/v1/surveys").expect(401);
  });
  it("不允许外站Origin或缺少CSRF", async () => {
    await owner.agent
      .post("/api/v1/surveys")
      .set("Origin", "https://evil.invalid")
      .send({})
      .expect(403);
    await owner.agent
      .post("/api/v1/surveys")
      .set("Origin", origin)
      .send({})
      .expect(403);
  });
  it("TTL尚未清理的过期会话也不可用", async () => {
    const a = await actor();
    await d.sessions.updateMany(
      { userId: new ObjectId(a.id) },
      { $set: { expiresAt: new Date(0) } },
    );
    await a.agent.get("/api/v1/auth/me").expect(401);
  });
  it("关闭不存在API时返回JSON404", async () => {
    const r = await request(app).get("/api/v1/missing");
    expect(r.status).toBe(404);
    expect(r.type).toMatch(/json/);
  });
  it("公开简介不泄露草稿、身份或统计", async () => {
    const s = await survey();
    const r = await request(app)
      .get(`/api/v1/public/surveys/${s.publicId}`)
      .expect(200);
    expect(r.body).not.toHaveProperty("ownerId");
    expect(r.body).not.toHaveProperty("definition");
    expect(r.body).not.toHaveProperty("draft");
  });
  it("他人不能查看、关闭、统计或修改问卷", async () => {
    const s = await survey();
    for (const path of [`/surveys/${s.id}`, `/surveys/${s.id}/stats`])
      await other.agent.get(`/api/v1${path}`).expect(404);
    await send(other, "post", `/surveys/${s.id}/close`).then((r) =>
      expect(r.status).toBe(404),
    );
  });
});
describe("创建、发布、校验与保存", () => {
  it("四种题型配置持久化，过期revision不能覆盖", async () => {
    const r = await send(owner, "post", "/surveys");
    const def = demoDefinition();
    const saved = await send(owner, "put", `/surveys/${r.body._id}/draft`, {
      revision: 1,
      definition: def,
      deadlineAt: null,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.draft.questions).toHaveLength(4);
    expect(
      (
        await send(owner, "put", `/surveys/${r.body._id}/draft`, {
          revision: 1,
          definition: def,
          deadlineAt: null,
        })
      ).status,
    ).toBe(409);
  });
  it("非法跳转定义不能保存", async () => {
    const c = await send(owner, "post", "/surveys");
    const def = demoDefinition();
    def.questions[0].logic.rules[0].then.targetQuestionId = def.questions[0].id;
    expect(
      (
        await send(owner, "put", `/surveys/${c.body._id}/draft`, {
          revision: 1,
          definition: def,
          deadlineAt: null,
        })
      ).status,
    ).toBe(422);
  });
  it("发布快照不可修改，发布重试不产生第二版本", async () => {
    const s = await survey();
    expect(
      (
        await send(owner, "post", `/surveys/${s.id}/publish`, {
          revision: s.sourceRevision,
        })
      ).status,
    ).toBe(200);
    expect(
      await d.versions.countDocuments({ surveyId: new ObjectId(s.id) }),
    ).toBe(1);
    expect(
      (
        await send(owner, "put", `/surveys/${s.id}/draft`, {
          revision: 3,
          definition: s.def,
          deadlineAt: null,
        })
      ).status,
    ).toBe(409);
  });
  it("复制问卷生成新的问卷题目选项ID，保留规则引用", async () => {
    const s = await survey();
    const r = await send(owner, "post", `/surveys/${s.id}/copy`);
    expect(r.status).toBe(201);
    expect(r.body.publicId).not.toBe(s.publicId);
    expect(r.body.draft.questions[0].id).not.toBe(s.def.questions[0].id);
    expect(r.body.draft.questions[0].logic.rules[0].then.targetQuestionId).toBe(
      r.body.draft.questions[2].id,
    );
  });
  it("禁止创建未发布问卷的尝试", async () => {
    const c = await send(owner, "post", "/surveys");
    await request(app)
      .get(`/api/v1/public/surveys/${c.body.publicId}`)
      .expect(404);
  });
  it("草稿刷新恢复，旧revision保存失败", async () => {
    const s = await survey(),
      r = await start(s);
    const values = [valid(s.def)[0]];
    const saved = await send(other, "put", `/attempts/${r.id}/answers`, {
      revision: 1,
      answers: values,
    });
    expect(saved.status).toBe(200);
    const read = await other.agent.get(`/api/v1/attempts/${r.id}`).expect(200);
    expect(read.body.attempt.answers[0].value).toBe(values[0].value);
    expect(
      (
        await send(other, "put", `/attempts/${r.id}/answers`, {
          revision: 1,
          answers: [],
        })
      ).status,
    ).toBe(409);
  });
  it("单选跳转跳过必答题，隐藏题和非法数字被后端拒绝", async () => {
    const s = await survey(),
      r = await start(s);
    expect(
      (
        await submit(other, r, [
          ...valid(s.def),
          {
            questionId: s.def.questions[1].id,
            value: [s.def.questions[1].options![0].id],
          },
        ])
      ).status,
    ).toBe(422);
    expect((await submit(other, r, valid(s.def, 25))).status).toBe(422);
    expect((await submit(other, r, [])).status).toBe(422);
    expect((await submit(other, r, valid(s.def, 0))).status).toBe(200);
  });
  it("开始填写请求幂等，别人不能读取我的答卷", async () => {
    const s = await survey(),
      id = randomUUID(),
      body = { clientAttemptId: id, isAnonymous: true };
    const [a, b] = await Promise.all([
      send(other, "post", `/public/surveys/${s.publicId}/attempts`, body),
      send(other, "post", `/public/surveys/${s.publicId}/attempts`, body),
    ]);
    expect(a.body.attempt.id).toBe(b.body.attempt.id);
    await owner.agent.get(`/api/v1/attempts/${a.body.attempt.id}`).expect(404);
  });
});
describe("提交、修改与并发一致性", () => {
  it("提交幂等，同一请求更换内容时冲突；关闭后重试仍返回成功", async () => {
    const s = await survey(),
      r = await start(s),
      id = randomUUID();
    const a = await submit(other, r, valid(s.def), id);
    expect(a.status).toBe(200);
    expect((await submit(other, r, valid(s.def), id)).status).toBe(200);
    expect((await submit(other, r, valid(s.def, 3), id)).status).toBe(409);
    await send(owner, "post", `/surveys/${s.id}/close`);
    expect((await submit(other, r, valid(s.def), id)).status).toBe(200);
    expect(
      await d.responses.countDocuments({
        surveyId: new ObjectId(s.id),
        status: "submitted",
      }),
    ).toBe(1);
  });
  it("同一次提交的并发请求返回同一答卷", async () => {
    const s = await survey(),
      r = await start(s),
      id = randomUUID();
    const out = await Promise.all([
      submit(other, r, valid(s.def), id),
      submit(other, r, valid(s.def), id),
    ]);
    expect(out.map((r) => r.status)).toEqual([200, 200]);
  });
  it("禁止重复时两个尝试并发只成功一个", async () => {
    const s = await survey(),
      a = await start(s),
      b = await start(s);
    const out = await Promise.all([
      submit(other, a, valid(s.def)),
      submit(other, b, valid(s.def)),
    ]);
    expect(out.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(
      await d.responses.countDocuments({
        surveyId: new ObjectId(s.id),
        status: "submitted",
      }),
    ).toBe(1);
  });
  it("允许重复时增加份数，去重人数不增加", async () => {
    const def = demoDefinition();
    def.settings.allowMultipleSubmissions = true;
    def.settings.allowEditAfterSubmission = false;
    const s = await survey(def);
    for (const n of [2, 4]) {
      const r = await start(s);
      expect((await submit(other, r, valid(s.def, n))).status).toBe(200);
    }
    const stats = await owner.agent
      .get(`/api/v1/surveys/${s.id}/stats`)
      .expect(200);
    expect(stats.body.totalSubmissions).toBe(2);
    expect(stats.body.uniqueRespondents).toBe(1);
    expect(stats.body.questions[0].options[1]).toMatchObject({
      count: 2,
      uniqueRespondents: 1,
    });
  });
  it("修改原答卷不增加份数，草稿不污染统计，确认后平均值更新", async () => {
    const s = await survey(),
      r = await start(s);
    const submitted = await submit(other, r, valid(s.def, 2));
    const originalId = submitted.body.id;
    const edit = await send(other, "post", `/attempts/${r.id}/edit`, {
      revision: submitted.body.revision,
    });
    expect(edit.status).toBe(200);
    const saved = await send(other, "put", `/attempts/${r.id}/answers`, {
      revision: edit.body.attempt.revision,
      answers: valid(s.def, 8),
    });
    expect(saved.status).toBe(200);
    const before = await owner.agent.get(`/api/v1/surveys/${s.id}/stats`);
    expect(before.body.questions[2].average).toBe(2);
    const changed = await submit(other, saved.body, valid(s.def, 8));
    expect(changed.status).toBe(200);
    expect(changed.body.id).toBe(originalId);
    expect(changed.body.editCount).toBe(1);
    const after = await owner.agent.get(`/api/v1/surveys/${s.id}/stats`);
    expect(after.body).toMatchObject({
      totalSubmissions: 1,
      uniqueRespondents: 1,
    });
    expect(after.body.questions[2].average).toBe(8);
  });
  it("修改前题后必须清除不再可达的答案", async () => {
    const s = await survey(),
      r = await start(s),
      qs = s.def.questions;
    const answers = [
      { questionId: qs[0].id, value: qs[0].options![0].id },
      { questionId: qs[1].id, value: [qs[1].options![0].id] },
      { questionId: qs[2].id, value: 3 },
    ];
    const submitted = await submit(other, r, answers);
    const edit = await send(other, "post", `/attempts/${r.id}/edit`, {
      revision: submitted.body.revision,
    });
    const bad = await submit(other, edit.body.attempt, [
      ...valid(s.def),
      answers[1],
    ]);
    expect(bad.status).toBe(422);
    const good = await submit(other, edit.body.attempt, valid(s.def));
    expect(good.status).toBe(200);
    const stored = await d.responses.findOne({ _id: new ObjectId(r.id) });
    expect(stored?.answers.some((a) => a.questionId === qs[1].id)).toBe(false);
  });
  it("提交后旧自动保存不可覆盖；修改流程受策略与截止限制", async () => {
    const s = await survey(),
      r = await start(s),
      sub = await submit(other, r, valid(s.def));
    expect(
      (
        await send(other, "put", `/attempts/${r.id}/answers`, {
          revision: r.revision,
          answers: valid(s.def, 7),
        })
      ).status,
    ).toBe(409);
    await send(owner, "post", `/surveys/${s.id}/close`);
    expect(
      (
        await send(other, "post", `/attempts/${r.id}/edit`, {
          revision: sub.body.revision,
        })
      ).status,
    ).toBe(410);
  });
  it("关闭和截止阻止新提交且不留下半提交", async () => {
    const s = await survey(),
      r = await start(s);
    await d.surveys.updateOne(
      { _id: new ObjectId(s.id) },
      { $set: { deadlineAt: new Date(Date.now() - 1000) } },
    );
    expect((await submit(other, r, valid(s.def))).status).toBe(410);
    expect(
      (await d.responses.findOne({ _id: new ObjectId(r.id) }))?.status,
    ).toBe("in_progress");
    expect(
      (await d.surveys.findOne({ _id: new ObjectId(s.id) }))?.submissionGateSeq,
    ).toBe(0);
  });
  it("关闭与提交并发仅有合法顺序", async () => {
    const s = await survey(),
      r = await start(s);
    const [submitted, closed] = await Promise.all([
      submit(other, r, valid(s.def)),
      send(owner, "post", `/surveys/${s.id}/close`),
    ]);
    expect(closed.status).toBe(200);
    expect([200, 410]).toContain(submitted.status);
    expect(
      (await d.responses.findOne({ _id: new ObjectId(r.id) }))?.status,
    ).toBe(submitted.status === 200 ? "submitted" : "in_progress");
  });
  it("10人并发提交无丢失", async () => {
    const s = await survey();
    const actors: Actor[] = [];
    for (let i = 0; i < 10; i++) actors.push(await actor());
    const attempts = await Promise.all(actors.map((a) => start(s, a)));
    const out = await Promise.all(
      actors.map((a, i) => submit(a, attempts[i], valid(s.def, i))),
    );
    expect(out.every((r) => r.status === 200)).toBe(true);
    const stats = await owner.agent.get(`/api/v1/surveys/${s.id}/stats`);
    expect(stats.body).toMatchObject({
      totalSubmissions: 10,
      uniqueRespondents: 10,
    });
  });
});
describe("匿名、统计与数据库约束", () => {
  it("匿名答卷不向创建者泄露内部身份", async () => {
    const s = await survey(),
      r = await start(s);
    await submit(other, r, valid(s.def));
    const rows = await owner.agent
      .get(`/api/v1/surveys/${s.id}/responses`)
      .expect(200);
    const text = JSON.stringify(rows.body);
    expect(text).not.toContain("participantKey");
    expect(text).not.toContain("clientAttemptId");
    expect(rows.body.items[0].respondentId).toBeNull();
    expect(rows.body.items[0]).not.toHaveProperty("editDraft");
  });
  it("不允许匿名时拒绝伪造匿名并保留实名账号", async () => {
    const def = demoDefinition();
    def.settings.allowAnonymous = false;
    const s = await survey(def);
    expect(
      (
        await send(other, "post", `/public/surveys/${s.publicId}/attempts`, {
          clientAttemptId: randomUUID(),
          isAnonymous: true,
        })
      ).status,
    ).toBe(422);
    const r = await start(s, other, false);
    await submit(other, r, valid(s.def));
    expect(
      (
        await d.responses.findOne({ _id: new ObjectId(r.id) })
      )?.respondentId?.toHexString(),
    ).toBe(other.id);
  });
  it("无人作答时计数为0、选项保留、平均值为null", async () => {
    const s = await survey();
    const stats = await owner.agent.get(`/api/v1/surveys/${s.id}/stats`);
    expect(stats.body).toMatchObject({
      totalSubmissions: 0,
      uniqueRespondents: 0,
    });
    expect(stats.body.questions[2].average).toBeNull();
    expect(stats.body.questions[0].options).toHaveLength(2);
    expect(stats.body.questions[0].options[0].count).toBe(0);
  });
  it("统计固定数据：份数、人数、跳过、未填、数字和文本", async () => {
    const qs = [
      makeQuestion("single_choice", "S", 1),
      makeQuestion("multiple_choice", "M", 2),
      makeQuestion("number", "N", 3),
      makeQuestion("text", "T", 4),
    ];
    qs[1].options!.push({ id: randomUUID(), label: "z", order: 3 });
    qs[1].validation = {};
    for (const q of qs.slice(1)) q.required = false;
    qs[0].logic.rules = [
      {
        id: randomUUID(),
        priority: 1,
        when: { operator: "eq", value: qs[0].options![1].id },
        then: { action: "end" },
      },
    ];
    const def = demoDefinition();
    def.questions = qs;
    def.settings = {
      allowAnonymous: true,
      allowMultipleSubmissions: true,
      allowEditAfterSubmission: false,
    };
    const s = await survey(def);
    const base = [{ questionId: qs[0].id, value: qs[0].options![0].id }],
      mk = (n: number, text: string, vals: string[]) => [
        ...base,
        { questionId: qs[1].id, value: vals },
        { questionId: qs[2].id, value: n },
        { questionId: qs[3].id, value: text },
      ];
    for (const values of [
      mk(
        10,
        "很好",
        qs[1].options!.slice(0, 2).map((o) => o.id),
      ),
      mk(20, "一般", [qs[1].options![1].id]),
      [{ questionId: qs[0].id, value: qs[0].options![1].id }],
      base,
    ]) {
      const r = await start(s);
      expect((await submit(other, r, values)).status).toBe(200);
    }
    const draft = await start(s);
    await send(other, "put", `/attempts/${draft.id}/answers`, {
      revision: 1,
      answers: mk(100, "未完成", [qs[1].options![2].id]),
    });
    const { body } = await owner.agent.get(`/api/v1/surveys/${s.id}/stats`);
    expect(body).toMatchObject({ totalSubmissions: 4, uniqueRespondents: 1 });
    expect(body.questions[1]).toMatchObject({
      arrivedCount: 3,
      answeredCount: 2,
      skippedCount: 1,
      unansweredCount: 1,
    });
    expect(body.questions[1].options.map((o: any) => o.count)).toEqual([
      1, 2, 0,
    ]);
    expect(body.questions[2].average).toBe(15);
    const texts = await owner.agent.get(
      `/api/v1/surveys/${s.id}/questions/${qs[3].id}/stats`,
    );
    expect(texts.body.items.map((x: any) => x.answer.value).sort()).toEqual([
      "一般",
      "很好",
    ]);
  });
  it("MongoDB拒绝错误BSON类型与匿名身份泄漏", async () => {
    await expect(
      d.db.collection("users").insertOne({ username: "bad" }),
    ).rejects.toMatchObject({ code: 121 });
    const s = await survey(),
      r = await start(s);
    await expect(
      d.responses.updateOne(
        { _id: new ObjectId(r.id) },
        { $set: { respondentId: new ObjectId(other.id) } },
      ),
    ).rejects.toMatchObject({ code: 121 });
  });
  it("事务抛错后所有写入回滚", async () => {
    const s = await survey();
    const session = d.client.startSession();
    try {
      await expect(
        session.withTransaction(async () => {
          await d.surveys.updateOne(
            { _id: new ObjectId(s.id) },
            { $inc: { submissionGateSeq: 99 } },
            { session },
          );
          throw new Error("故障注入");
        }),
      ).rejects.toThrow("故障注入");
    } finally {
      await session.endSession();
    }
    expect(
      (await d.surveys.findOne({ _id: new ObjectId(s.id) }))?.submissionGateSeq,
    ).toBe(0);
  });
});
