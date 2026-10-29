import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { connectDatabase, type Database } from "../apps/server/src/database.js";
import { createApp } from "../apps/server/src/app.js";
import { config } from "../apps/server/src/config.js";
import { initializeDatabase, validators } from "../database/schema.js";
import { makeQuestion } from "../database/seed.js";
import {
  emptyDefinition,
  type Definition,
  type Question,
  type QuestionType,
  type Value,
} from "../packages/shared/src/domain.js";

const origin = "http://localhost:3000";
let db: Database, app: ReturnType<typeof createApp>;
type Actor = {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  name: string;
};
let owner: Actor, reader: Actor, outsider: Actor;
const send = (
  a: Actor,
  method: "post" | "put" | "patch" | "delete",
  url: string,
  body: object = {},
) =>
  a.agent[method]("/api/v1" + url)
    .set("Origin", origin)
    .set("X-CSRF-Token", a.csrf)
    .send(body);
const get = (a: Actor, url: string) => a.agent.get("/api/v1" + url);
async function actor(name: string): Promise<Actor> {
  const agent = request.agent(app);
  await agent
    .post("/api/v1/auth/register")
    .set("Origin", origin)
    .send({ username: name, password: "Stage2-test-123!" })
    .expect(201);
  const r = await agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ username: name, password: "Stage2-test-123!" })
    .expect(200);
  return { agent, csrf: r.body.csrfToken, name };
}
async function item(type: QuestionType = "number", a = owner) {
  return (
    await send(a, "post", "/library/questions", {
      content: makeQuestion(type, "常用" + type, 1),
    }).expect(201)
  ).body;
}
async function imported(v: string, a = owner): Promise<Question> {
  return (await send(a, "post", `/library/versions/${v}/import`).expect(200))
    .body;
}
async function grant(f: string, usernames: string[], bankIds: string[] = []) {
  const data = (await get(owner, `/library/questions/${f}`).expect(200)).body;
  return (
    await send(owner, "put", `/library/questions/${f}/access`, {
      revision: data.family.revision,
      usernames,
      bankIds,
    }).expect(200)
  ).body;
}
async function draft(
  q: Question[],
  a = owner,
  consent = false,
  multiple = true,
) {
  const def: Definition = {
    ...emptyDefinition(),
    title: "测试问卷_" + randomUUID().slice(0, 8),
    questions: q.map((x, i) => ({ ...x, order: i + 1 })),
    settings: {
      allowAnonymous: true,
      allowMultipleSubmissions: multiple,
      allowEditAfterSubmission: !multiple,
      shareLibraryStatistics: consent,
    },
  };
  const c = (await send(a, "post", "/surveys").expect(201)).body;
  const saved = (
    await send(a, "put", `/surveys/${c._id}/draft`, {
      revision: 1,
      definition: def,
      deadlineAt: null,
    }).expect(200)
  ).body;
  return { ...saved, def };
}
async function publish(s: any, a = owner) {
  const r = (
    await send(a, "post", `/surveys/${s._id}/publish`, {
      revision: s.revision,
    }).expect(200)
  ).body;
  return { ...s, versionId: r.versionId };
}
async function survey(
  q: Question[],
  a = owner,
  consent = false,
  multiple = true,
) {
  return publish(await draft(q, a, consent, multiple), a);
}
async function answer(s: any, values: (Value | undefined)[], a = outsider) {
  const started = (
    await send(a, "post", `/public/surveys/${s.publicId}/attempts`, {
      clientAttemptId: randomUUID(),
      isAnonymous: true,
    }).expect(201)
  ).body.attempt;
  return (
    await send(a, "post", `/attempts/${started.id}/submit`, {
      revision: started.revision,
      submissionId: randomUUID(),
      answers: s.def.questions.flatMap((q: Question, i: number) =>
        values[i] === undefined ? [] : [{ questionId: q.id, value: values[i] }],
      ),
    }).expect(200)
  ).body;
}
const stats = async (v: string, a = owner, page = 1) =>
  (await get(a, `/library/versions/${v}/stats?page=${page}`).expect(200)).body;
const familyStats = async (v: string, a = owner) =>
  (await get(a, `/library/versions/${v}/stats?scope=family`).expect(200)).body;
const derive = async (v: string, revision: number, content: object) =>
  (
    await send(owner, "post", `/library/versions/${v}/derive`, {
      revision,
      content,
    }).expect(201)
  ).body;
beforeAll(async () => {
  const uri =
    process.env.MONGODB_TEST_URI ??
    "mongodb://127.0.0.1:27018/questionnaire_test?replicaSet=survey-rs";
  if (new MongoClient(uri).db().databaseName !== "questionnaire_test")
    throw Error("拒绝操作非测试库");
  db = await connectDatabase(uri);
  await initializeDatabase(db.db);
  for (const name of Object.keys(validators))
    await db.db.collection(name).deleteMany({});
  app = createApp(db, {
    ...config(),
    uri,
    origins: [origin],
    publicBaseUrl: origin,
  });
  owner = await actor("library_owner");
  reader = await actor("library_reader");
  outsider = await actor("library_outsider");
});
afterAll(async () => {
  await db?.client.close();
});

describe("二期：独立题目、共享和题库", () => {
  it.each([
    "single_choice",
    "multiple_choice",
    "text",
    "number",
  ] as QuestionType[])("可独立创建%s，不携带问卷跳转目标", async (type) => {
    const q = makeQuestion(type, "可复用题目", 9);
    q.logic.defaultAction = { action: "goto", targetQuestionId: randomUUID() };
    const r = (
      await send(owner, "post", "/library/questions", { content: q }).expect(
        201,
      )
    ).body;
    expect(r.version.content.order).toBe(1);
    expect(r.version.content.logic.defaultAction).toEqual({ action: "next" });
    expect(r.version.content.source).toBeUndefined();
    expect(r.family.versionCount).toBe(1);
    const a = await imported(r.version._id),
      b = await imported(r.version._id);
    expect(a.id).not.toBe(b.id);
    expect(a.source).toEqual({
      familyId: r.family._id,
      versionId: r.version._id,
    });
    if (q.options) expect(a.options).toEqual(q.options);
  });
  it("题库创建、改名、归属增删、筛选、并发和越权保护", async () => {
    const bank = (
      await send(owner, "post", "/question-banks", {
        name: "基础资料",
        description: "通用属性",
      }).expect(201)
    ).body;
    const q = await item();
    await grant(q.family._id, [], [bank._id]);
    expect(
      (
        await get(owner, `/library/questions?bankId=${bank._id}`).expect(200)
      ).body.items.map((x: any) => x._id),
    ).toEqual([q.family._id]);
    await send(reader, "put", `/question-banks/${bank._id}`, {
      name: "非法修改",
      revision: 1,
    }).expect(404);
    await get(reader, `/library/questions?bankId=${bank._id}`).expect(404);
    await send(owner, "put", `/question-banks/${bank._id}`, {
      name: "学生资料",
      revision: 1,
    }).expect(200);
    await send(owner, "put", `/question-banks/${bank._id}`, {
      name: "覆盖",
      revision: 1,
    }).expect(409);
    const foreign = (
      await send(reader, "post", "/question-banks", {
        name: "别人的题库",
      }).expect(201)
    ).body;
    await send(owner, "put", `/library/questions/${q.family._id}/access`, {
      revision: 2,
      usernames: [],
      bankIds: [foreign._id],
    }).expect(404);
    await grant(q.family._id, [], []);
    expect(
      (await get(owner, `/library/questions?bankId=${bank._id}`)).body.items,
    ).toHaveLength(0);
  });
  it("共享双方均可使用，接收者不可改原题；可另存自己名下并记录来源", async () => {
    const q = await item();
    await get(reader, `/library/questions/${q.family._id}`).expect(404);
    await grant(q.family._id, [reader.name]);
    await imported(q.version._id, owner);
    await imported(q.version._id, reader);
    expect(
      (await get(reader, "/library/questions")).body.items.some(
        (x: any) => x._id === q.family._id,
      ),
    ).toBe(true);
    await send(reader, "post", `/library/versions/${q.version._id}/derive`, {
      revision: 2,
      content: q.version.content,
    }).expect(404);
    await send(reader, "put", `/library/questions/${q.family._id}/access`, {
      revision: 2,
      usernames: [],
      bankIds: [],
    }).expect(404);
    await get(outsider, `/library/versions/${q.version._id}/stats`).expect(404);
    const copy = (
      await send(reader, "post", "/library/questions", {
        content: q.version.content,
        fromVersionId: q.version._id,
      }).expect(201)
    ).body;
    expect(copy.family._id).not.toBe(q.family._id);
    expect(copy.version.parentVersionId).toBe(q.version._id);
    await send(reader, "post", `/library/versions/${copy.version._id}/derive`, {
      revision: 1,
      content: { ...copy.version.content, title: "自有题目" },
    }).expect(201);
    await send(owner, "put", `/library/questions/${q.family._id}/access`, {
      revision: 2,
      usernames: ["unregistered_9834"],
      bankIds: [],
    }).expect(422);
  });
  it("撤销后禁止新导入，但已经保存的草稿仍可编辑、发布和作答", async () => {
    const q = await item();
    await grant(q.family._id, [reader.name]);
    const instance = await imported(q.version._id, reader),
      s = await draft([instance], reader);
    await grant(q.family._id, []);
    await send(
      reader,
      "post",
      `/library/versions/${q.version._id}/import`,
    ).expect(404);
    const saved = (
      await send(reader, "put", `/surveys/${s._id}/draft`, {
        revision: s.revision,
        definition: { ...s.def, title: "撤销后旧问卷" },
        deadlineAt: null,
      }).expect(200)
    ).body;
    const p = await publish({ ...s, revision: saved.revision }, reader);
    await answer(p, [22]);
    const fresh = (await send(reader, "post", "/surveys").expect(201)).body;
    await send(reader, "put", `/surveys/${fresh._id}/draft`, {
      revision: 1,
      definition: s.def,
    }).expect(404);
  });
});

describe("二期：不可变版本、历史和来源", () => {
  it.each(["single_choice", "multiple_choice"] as const)(
    "复制混合%s问卷时，各题选项映射独立且跳转有效",
    async (type) => {
      const itemData = await item(type);
      const linked = await imported(itemData.version._id);
      const detached = structuredClone(linked);
      detached.id = randomUUID();
      detached.title = "解除关联后的题";
      delete detached.source;
      linked.logic.defaultAction = {
        action: "goto",
        targetQuestionId: detached.id,
      };
      const option = linked.options![0].id;
      for (const q of [linked, detached])
        q.logic.rules = [
          {
            id: randomUUID(),
            priority: 1,
            when: {
              operator: type === "single_choice" ? "eq" : "contains_any",
              value: type === "single_choice" ? option : [option],
            },
            then:
              q === linked
                ? { action: "goto", targetQuestionId: detached.id }
                : { action: "end" },
          },
        ];
      const original = await survey([linked, detached]);
      const copy = (
        await send(owner, "post", `/surveys/${original._id}/copy`).expect(201)
      ).body;
      const [a, b] = copy.draft.questions as Question[];
      expect(a.options).toEqual(linked.options);
      expect(a.source).toEqual(linked.source);
      expect(b.options![0].id).not.toBe(option);
      expect(b.source).toBeUndefined();
      expect(a.logic.defaultAction.targetQuestionId).toBe(b.id);
      expect(a.logic.rules[0].then.targetQuestionId).toBe(b.id);
      expect(a.logic.rules[0].when.value).toEqual(
        type === "single_choice" ? option : [option],
      );
      expect(b.logic.rules[0].when.value).toEqual(
        type === "single_choice" ? b.options![0].id : [b.options![0].id],
      );
      const published = await publish({ ...copy, def: copy.draft });
      await answer(
        published,
        [a, b].map((q) =>
          type === "single_choice" ? q.options![0].id : [q.options![0].id],
        ),
      );
      expect((await stats(itemData.version._id)).answerCount).toBe(1);
    },
  );
  it("改题后旧版本、发布快照及旧答卷完全不变；复制问卷保留来源和选项ID", async () => {
    const q = await item("single_choice"),
      instance = await imported(q.version._id),
      s = await survey([instance]);
    const r = await answer(s, [instance.options![0].id]);
    const before = await db.responses.findOne({ _id: new ObjectId(r.id) }),
      snapshot = await db.versions.findOne({ _id: new ObjectId(s.versionId) });
    const changed = {
      ...q.version.content,
      title: "新版题干",
      options: q.version.content.options.map((o: any, i: number) => ({
        ...o,
        label: i ? "新版B" : "新版A",
      })),
    };
    const v2 = (
      await send(owner, "post", `/library/versions/${q.version._id}/derive`, {
        revision: 1,
        content: changed,
      }).expect(201)
    ).body;
    expect(v2.versionNumber).toBe(2);
    expect(
      (await get(owner, `/library/versions/${q.version._id}`)).body.version
        .content,
    ).toEqual(q.version.content);
    expect(
      await db.versions.findOne({ _id: new ObjectId(s.versionId) }),
    ).toEqual(snapshot);
    expect(await db.responses.findOne({ _id: new ObjectId(r.id) })).toEqual(
      before,
    );
    await send(owner, "put", `/library/versions/${q.version._id}`, {
      content: changed,
    }).expect(404);
    const copy = (
      await send(owner, "post", `/surveys/${s._id}/copy`).expect(201)
    ).body;
    expect(copy.draft.questions[0].source).toEqual(instance.source);
    expect(copy.draft.questions[0].options).toEqual(instance.options);
    expect(copy.draft.questions[0].id).not.toBe(instance.id);
    await publish({ ...copy, def: copy.draft });
  });
  it("从旧版派生和恢复均追加版本，保存准确父链", async () => {
    const q = await item();
    const v2 = (
      await send(owner, "post", `/library/versions/${q.version._id}/derive`, {
        revision: 1,
        content: { ...q.version.content, title: "分支A" },
      }).expect(201)
    ).body;
    const v3 = (
      await send(owner, "post", `/library/versions/${q.version._id}/derive`, {
        revision: 2,
        content: { ...q.version.content, title: "分支B" },
      }).expect(201)
    ).body;
    expect(v2.parentVersionId).toBe(q.version._id);
    expect(v3.parentVersionId).toBe(q.version._id);
    const v4 = (
      await send(owner, "post", `/library/versions/${q.version._id}/derive`, {
        revision: 3,
        restore: true,
      }).expect(201)
    ).body;
    expect(v4.parentVersionId).toBe(v3._id);
    expect(v4.restoredFromVersionId).toBe(q.version._id);
    expect(v4.content).toEqual(q.version.content);
    const detail = (await get(owner, `/library/questions/${q.family._id}`))
      .body;
    expect(detail.versions.map((x: any) => x.versionNumber)).toEqual([
      4, 3, 2, 1,
    ]);
    expect(detail.family.latestVersionId).toBe(v4._id);
    await imported(v2._id);
    await imported(v3._id);
  });
  it("同revision并发改题只成功一次，不产生孤立版本", async () => {
    const q = await item();
    const rs = await Promise.all(
      [1, 2].map((n) =>
        send(owner, "post", `/library/versions/${q.version._id}/derive`, {
          revision: 1,
          content: { ...q.version.content, title: `并发${n}` },
        }),
      ),
    );
    expect(rs.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(
      await db.db
        .collection("question_versions")
        .countDocuments({ familyId: new ObjectId(q.family._id) }),
    ).toBe(2);
    expect(
      (await get(owner, `/library/questions/${q.family._id}`)).body.family
        .versionCount,
    ).toBe(2);
  });
  it("拒绝伪造来源、改变核心内容、重复版本；支持大小写ID规范化", async () => {
    const q = await item(),
      instance = await imported(q.version._id),
      s = await draft([]);
    for (const modified of [
      { ...instance, title: "偷改" },
      {
        ...instance,
        source: { ...instance.source!, familyId: new ObjectId().toHexString() },
      },
      {
        ...instance,
        source: {
          ...instance.source!,
          versionId: new ObjectId().toHexString(),
        },
      },
    ]) {
      await send(owner, "put", `/surveys/${s._id}/draft`, {
        revision: s.revision,
        definition: { ...s.def, questions: [modified] },
      }).expect(422);
    }
    const upper = {
      ...instance,
      id: randomUUID(),
      order: 2,
      source: {
        familyId: instance.source!.familyId.toUpperCase(),
        versionId: instance.source!.versionId.toUpperCase(),
      },
    };
    await send(owner, "put", `/surveys/${s._id}/draft`, {
      revision: s.revision,
      definition: { ...s.def, questions: [instance, upper] },
    }).expect(422);
    const saved = (
      await send(owner, "put", `/surveys/${s._id}/draft`, {
        revision: s.revision,
        definition: { ...s.def, questions: [{ ...upper, order: 1 }] },
      }).expect(200)
    ).body;
    expect(saved.draft.questions[0].source).toEqual(instance.source);
  });
  it("引用的题目仍可配置问卷内跳转，脱离后可作为新题目", async () => {
    const q = await item(),
      instance = await imported(q.version._id);
    instance.logic.defaultAction = { action: "end" };
    const later = makeQuestion("text", "应跳过", 2),
      s = await survey([instance, later]);
    await answer(s, [20]);
    expect((await stats(q.version._id)).answerCount).toBe(1);
    const independent = { ...instance, id: randomUUID(), title: "独立修改" };
    delete independent.source;
    await survey([independent]);
  });
  it("历史分页稳定，无遗漏或重复；跨页旧版本仍可选择", async () => {
    const q = await item();
    for (let n = 2; n <= 22; n++)
      await send(owner, "post", `/library/versions/${q.version._id}/derive`, {
        revision: n - 1,
        content: { ...q.version.content, title: `版本${n}` },
      }).expect(201);
    const one = (await get(owner, `/library/questions/${q.family._id}?page=1`))
        .body,
      two = (await get(owner, `/library/questions/${q.family._id}?page=2`))
        .body;
    expect(one.versions).toHaveLength(20);
    expect(one.hasMore).toBe(true);
    expect(two.versions.map((x: any) => x.versionNumber)).toEqual([2, 1]);
    expect(two.hasMore).toBe(false);
    await imported(two.versions[1]._id);
    await get(owner, "/library/questions?page=0").expect(422);
    const page1 = (await get(owner, "/library/questions?page=1")).body,
      page2 = (await get(owner, "/library/questions?page=2")).body;
    expect(
      new Set([...page1.items, ...page2.items].map((x: any) => x._id)).size,
    ).toBe(page1.items.length + page2.items.length);
  });
});

describe("二期：跨问卷统计和隐私边界", () => {
  it("年龄统计按确切版本汇总，仅纳入本人和明确授权的问卷", async () => {
    const q = await item();
    await grant(q.family._id, [reader.name]);
    const own = await survey([await imported(q.version._id)]),
      permitted = await survey(
        [await imported(q.version._id, reader)],
        reader,
        true,
      ),
      privateSurvey = await survey(
        [await imported(q.version._id, reader)],
        reader,
        false,
      );
    await answer(own, [20]);
    await answer(own, [30]);
    await answer(permitted, [40]);
    await answer(privateSurvey, [110]);
    const s = await stats(q.version._id);
    expect(s.answerCount).toBe(3);
    expect(s.average).toBe(30);
    expect([s.min, s.max]).toEqual([20, 40]);
    expect(s.surveyCount).toBe(2);
    expect(s.distribution.reduce((n: number, b: any) => n + b.count, 0)).toBe(
      3,
    );
    const usage = (await get(owner, `/library/versions/${q.version._id}/usage`))
      .body;
    expect(JSON.stringify(usage)).not.toContain(privateSurvey.title);
    expect(JSON.stringify(usage)).not.toContain(privateSurvey._id);
    expect(
      usage.items.find((x: any) => x.title === permitted.title).id,
    ).toBeUndefined();
    const recipient = await stats(q.version._id, reader);
    expect(recipient.answerCount).toBe(2);
    expect(recipient.average).toBe(75);
    await get(reader, `/surveys/${own._id}/stats`).expect(404);
  });
  it("不同版本分别统计，无来源旧题不自动合并", async () => {
    const q = await item();
    const v2 = (
      await send(owner, "post", `/library/versions/${q.version._id}/derive`, {
        revision: 1,
        content: { ...q.version.content, title: "新年龄" },
      }).expect(201)
    ).body;
    const s = await survey([
      await imported(q.version._id),
      { ...(await imported(v2._id)), order: 2 },
    ]);
    await answer(s, [20, 40]);
    const legacy = await survey([q.version.content]);
    await answer(legacy, [100]);
    expect((await stats(q.version._id)).average).toBe(20);
    expect((await stats(v2._id)).average).toBe(40);
    expect((await stats(q.version._id)).answerCount).toBe(1);
  });
  it("未回答或被跳过不计入分母，未提交草稿不计入", async () => {
    const content = {
      ...makeQuestion("number", "可选年龄", 1),
      required: false,
    };
    const q = (
      await send(owner, "post", "/library/questions", { content }).expect(201)
    ).body;
    const s = await survey([await imported(q.version._id)]);
    await answer(s, [undefined]);
    await send(outsider, "post", `/public/surveys/${s.publicId}/attempts`, {
      clientAttemptId: randomUUID(),
      isAnonymous: true,
    }).expect(201);
    expect((await stats(q.version._id)).answerCount).toBe(0);
  });
  it("修改答卷草稿不改变统计，重新提交后替换旧值且不增加份数", async () => {
    const q = await item(),
      s = await survey([await imported(q.version._id)], owner, false, false),
      r = await answer(s, [20]);
    const edit = (
      await send(outsider, "post", `/attempts/${r.id}/edit`, {
        revision: r.revision,
      }).expect(200)
    ).body.attempt;
    const saved = (
      await send(outsider, "put", `/attempts/${r.id}/answers`, {
        revision: edit.revision,
        answers: [{ questionId: s.def.questions[0].id, value: 30 }],
      }).expect(200)
    ).body;
    expect((await stats(q.version._id)).average).toBe(20);
    const body = {
      revision: saved.revision,
      answers: [{ questionId: s.def.questions[0].id, value: 30 }],
      submissionId: randomUUID(),
    };
    await send(outsider, "post", `/attempts/${r.id}/submit`, body).expect(200);
    await send(outsider, "post", `/attempts/${r.id}/submit`, body).expect(200);
    const result = await stats(q.version._id);
    expect(result.answerCount).toBe(1);
    expect(result.average).toBe(30);
  });
  it.each(["single_choice", "multiple_choice"] as QuestionType[])(
    "%s按选项ID计数，回答分母正确",
    async (type) => {
      const q = await item(type),
        a = await imported(q.version._id),
        b = await imported(q.version._id),
        s1 = await survey([a]),
        s2 = await survey([b]);
      await answer(s1, [
        type === "single_choice"
          ? a.options![0].id
          : a.options!.map((o) => o.id),
      ]);
      await answer(s2, [
        type === "single_choice" ? b.options![0].id : [b.options![0].id],
      ]);
      const result = await stats(q.version._id);
      expect(result.answerCount).toBe(2);
      expect(result.options.map((o: any) => o.count)).toEqual(
        type === "single_choice" ? [2, 0] : [2, 1],
      );
    },
  );
  it("外部授权文本只贡献数量；本人文本分页不泄露原文或参与者标识", async () => {
    const q = await item("text");
    await grant(q.family._id, [reader.name]);
    const own = await survey([await imported(q.version._id)]),
      external = await survey(
        [await imported(q.version._id, reader)],
        reader,
        true,
      );
    for (let i = 0; i < 21; i++) await answer(own, [`本人答案${i}`]);
    await answer(external, ["外部私密文本"]);
    const first = await stats(q.version._id),
      second = await stats(q.version._id, owner, 2);
    expect(first.answerCount).toBe(22);
    expect(first.texts).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    expect(second.texts).toHaveLength(1);
    expect(
      new Set([...first.texts, ...second.texts].map((x) => x.value)).size,
    ).toBe(21);
    expect(JSON.stringify(first)).not.toContain("外部私密文本");
    expect(JSON.stringify(first)).not.toContain("participantKey");
  });
});

describe("二期：整道题跨问卷汇总（全部版本合计）", () => {
  it("“你的年龄”多版本分布在多份问卷：合计全部同题型版本，并按版本拆分", async () => {
    const q = await item();
    const v2 = await derive(q.version._id, 1, {
      ...q.version.content,
      title: "年龄（新版）",
    });
    const v3 = await derive(
      v2._id,
      2,
      makeQuestion("text", "年龄（改为文本）", 1),
    );
    const s1 = await survey([await imported(q.version._id)]),
      s2 = await survey([await imported(v2._id)]),
      s3 = await survey([await imported(v3._id)]);
    await answer(s1, [20]);
    await answer(s1, [30]);
    await answer(s2, [40]);
    await answer(s3, ["二十"]);
    const exact = await stats(q.version._id);
    expect(exact.scope).toBe("version");
    expect(exact.answerCount).toBe(2);
    const all = await familyStats(q.version._id);
    expect(all.scope).toBe("family");
    expect(all.answerCount).toBe(3);
    expect(all.average).toBe(30);
    expect([all.min, all.max]).toEqual([20, 40]);
    expect(all.surveyCount).toBe(2);
    expect(
      all.versions.map((x: any) => [x.versionNumber, x.answerCount]),
    ).toEqual([
      [2, 1],
      [1, 2],
    ]);
    expect(all.excludedVersions).toEqual([
      { versionId: v3._id, versionNumber: 3, type: "text" },
    ]);
    expect(all.distribution.reduce((n: number, b: any) => n + b.count, 0)).toBe(
      3,
    );
    // 从新版本发起合计结果相同
    expect((await familyStats(v2._id)).answerCount).toBe(3);
    // 文本版本只与文本版本合计
    expect((await familyStats(v3._id)).answerCount).toBe(1);
    const usage = (
      await get(owner, `/library/versions/${q.version._id}/usage?scope=family`)
    ).body;
    expect(usage.scope).toBe("family");
    expect(
      usage.items.map((x: any) => x.versionNumbers.join(",")).sort(),
    ).toEqual(["1", "2", "3"]);
    const single = (
      await get(owner, `/library/versions/${q.version._id}/usage`)
    ).body;
    expect(single.items).toHaveLength(1);
    expect(single.items[0].versionNumbers).toEqual([1]);
    await get(
      owner,
      `/library/versions/${q.version._id}/stats?scope=all`,
    ).expect(422);
  });
  it.each(["single_choice", "multiple_choice"] as const)(
    "%s跨版本仅合并ID和文字均相同的选项，改名不改变历史统计",
    async (type) => {
      const q = await item(type),
        [a, b] = q.version.content.options;
      const c = { id: randomUUID(), label: "选项 C", order: 3 };
      const v2 = await derive(q.version._id, 1, {
        ...q.version.content,
        options: [{ ...a, label: "不愿意" }, b, c],
      });
      const s1 = await survey([await imported(q.version._id)]),
        s2 = await survey([await imported(v2._id)]);
      const value = (id: string) => (type === "single_choice" ? id : [id]);
      await answer(s1, [value(a.id)]);
      await answer(s2, [value(a.id)]);
      await answer(s1, [value(b.id)]);
      await answer(s2, [value(b.id)]);
      await answer(s2, [value(c.id)]);
      const all = await familyStats(v2._id);
      expect(all.answerCount).toBe(5);
      expect(
        all.options.map((o: any) => [o.label, o.count, o.versionNumbers]),
      ).toEqual([
        ["不愿意", 1, [2]],
        ["选项 B", 2, [1, 2]],
        ["选项 C", 1, [2]],
        [a.label, 1, [1]],
      ]);
      expect(new Set(all.options.map((o: any) => o.key)).size).toBe(4);
      expect((await familyStats(q.version._id)).options).toEqual(all.options);
      const old = await stats(q.version._id);
      expect(old.options.map((o: any) => [o.label, o.count])).toEqual([
        [a.label, 1],
        [b.label, 1],
      ]);
    },
  );
  it("跨卷统计的首个$match条件以surveyId开头，可命中答卷索引（IXSCAN）", async () => {
    const q = await item(),
      s = await survey([await imported(q.version._id)]);
    await answer(s, [33]);
    const plan = await db.responses
      .find({
        surveyId: { $in: [new ObjectId(s._id)] },
        status: "submitted",
        surveyVersionId: { $in: [new ObjectId(s.versionId)] },
      })
      .explain("queryPlanner");
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain("IXSCAN");
  });
});

describe("二期：接口与数据库约束", () => {
  it("新接口均需登录及CSRF，并校验空题、非法版本和参数", async () => {
    await request(app).get("/api/v1/library/questions").expect(401);
    await owner.agent
      .post("/api/v1/library/questions")
      .set("Origin", origin)
      .send({})
      .expect(403);
    await send(owner, "post", "/library/questions", {
      content: makeQuestion("number", " ", 1),
    }).expect(422);
    await get(owner, "/library/versions/invalid").expect(400);
    const q = await item();
    await send(owner, "post", `/library/versions/${q.version._id}/derive`, {
      revision: 0,
      restore: true,
    }).expect(422);
    await send(owner, "post", "/question-banks", {
      name: "",
      ownerId: "forged",
    }).expect(422);
  });
  it("新集合具备校验、唯一版本约束和查询索引；旧结构可继续写入", async () => {
    expect(Object.keys(validators)).toHaveLength(8);
    await expect(
      db.db.collection("question_banks").insertOne({ name: "缺少必填字段" }),
    ).rejects.toMatchObject({ code: 121 });
    const q = await item();
    const stored = await db.db
      .collection("question_versions")
      .findOne({ _id: new ObjectId(q.version._id) });
    await expect(
      db.db
        .collection("question_versions")
        .insertOne({ ...stored, _id: new ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
    for (const content of [
      {
        ...stored!.content,
        source: { familyId: "a".repeat(24), versionId: "b".repeat(24) },
      },
      { ...stored!.content, order: 2 },
      {
        ...stored!.content,
        logic: {
          matchMode: "first_match",
          rules: [],
          defaultAction: { action: "end" },
        },
      },
      {
        ...stored!.content,
        logic: {
          ...stored!.content.logic,
          rules: [
            {
              id: randomUUID(),
              priority: 1,
              when: { operator: "gt", value: 1 },
              then: { action: "end" },
            },
          ],
        },
      },
    ])
      await expect(
        db.db.collection("question_versions").insertOne({
          ...stored,
          _id: new ObjectId(),
          versionNumber: 99,
          content,
        }),
      ).rejects.toMatchObject({ code: 121 });
    const indexes = await db.versions.indexes();
    expect(
      indexes.some((i) => i.key["definition.questions.source.versionId"] === 1),
    ).toBe(true);
    const legacy = await draft([makeQuestion("text", "旧结构", 1)]);
    delete legacy.def.settings.shareLibraryStatistics;
    await send(owner, "put", `/surveys/${legacy._id}/draft`, {
      revision: legacy.revision,
      definition: legacy.def,
    }).expect(200);
  });
});
