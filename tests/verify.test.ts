import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { BSON, MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectDatabase, type Database } from "../apps/server/src/database.js";
import { createApp } from "../apps/server/src/app.js";
import { config } from "../apps/server/src/config.js";
import { initializeDatabase, validators } from "../database/schema.js";
import { makeQuestion } from "../database/seed.js";
import { verifyDatabase, type VerifyReport } from "../database/verify.js";
import {
  emptyDefinition,
  type Definition,
  type Question,
} from "../packages/shared/src/domain.js";

// db:verify 的回归：先用正常接口造出一期+二期完整数据，要求零错误零提示；
// 再逐项人为破坏，确认检查能定位到对应问题，最后恢复。
const origin = "http://localhost:3000";
let db: Database, app: ReturnType<typeof createApp>;
type Actor = { agent: ReturnType<typeof request.agent>; csrf: string; name: string };
let owner: Actor, reader: Actor;
const send = (a: Actor, method: "post" | "put", url: string, body: object = {}) =>
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
    .send({ username: name, password: "Verify-test-123!" })
    .expect(201);
  const r = await agent
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .send({ username: name, password: "Verify-test-123!" })
    .expect(200);
  return { agent, csrf: r.body.csrfToken, name };
}
async function publishSurvey(a: Actor, questions: Question[], multiple = true) {
  const def: Definition = {
    ...emptyDefinition(),
    title: "核查问卷_" + randomUUID().slice(0, 8),
    questions: questions.map((x, i) => ({ ...x, order: i + 1 })),
    settings: {
      allowAnonymous: true,
      allowMultipleSubmissions: multiple,
      allowEditAfterSubmission: !multiple,
      shareLibraryStatistics: true,
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
  const p = (
    await send(a, "post", `/surveys/${c._id}/publish`, {
      revision: saved.revision,
    }).expect(200)
  ).body;
  return { ...saved, def, versionId: p.versionId };
}
async function answer(a: Actor, s: any, values: unknown[]) {
  const started = (
    await send(a, "post", `/public/surveys/${s.publicId}/attempts`, {
      clientAttemptId: randomUUID(),
      isAnonymous: false,
    }).expect(201)
  ).body.attempt;
  return (
    await send(a, "post", `/attempts/${started.id}/submit`, {
      revision: started.revision,
      submissionId: randomUUID(),
      answers: s.def.questions.map((q: Question, i: number) => ({
        questionId: q.id,
        value: values[i],
      })),
    }).expect(200)
  ).body;
}
const problems = (r: VerifyReport, id?: string) =>
  r.checks.filter((c) => !id || c.id === id).flatMap((c) => c.problems);
let familyId = "",
  v1 = "",
  survey: any;

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
  app = createApp(db, { ...config(), uri, origins: [origin], publicBaseUrl: origin });
  owner = await actor("verify_owner");
  reader = await actor("verify_reader");
  // 题库、归属、共享、派生、恢复、另存
  const bank = (
    await send(owner, "post", "/question-banks", { name: "核查题库" }).expect(201)
  ).body;
  const created = (
    await send(owner, "post", "/library/questions", {
      content: makeQuestion("single_choice", "核查单选", 1),
    }).expect(201)
  ).body;
  familyId = created.family._id;
  v1 = created.version._id;
  await send(owner, "put", `/library/questions/${familyId}/access`, {
    revision: 1,
    usernames: [reader.name],
    bankIds: [bank._id],
  }).expect(200);
  const v2 = (
    await send(owner, "post", `/library/versions/${v1}/derive`, {
      revision: 2,
      content: { ...created.version.content, title: "核查单选v2" },
    }).expect(201)
  ).body;
  await send(owner, "post", `/library/versions/${v1}/derive`, {
    revision: 3,
    restore: true,
  }).expect(201);
  await send(reader, "post", "/library/questions", {
    content: created.version.content,
    fromVersionId: v1,
  }).expect(201);
  // 两份引用问卷（作者、共享接收者）+ 一份一期式独立题问卷 + 一份草稿 + 复制
  const imported = async (a: Actor, v: string) =>
    (await send(a, "post", `/library/versions/${v}/import`).expect(200)).body;
  survey = await publishSurvey(owner, [
    await imported(owner, v1),
    makeQuestion("number", "独立数字题", 2),
  ]);
  const shared = await publishSurvey(reader, [await imported(reader, v2._id)], false);
  await answer(reader, survey, [survey.def.questions[0].options[0].id, 18]);
  await answer(owner, survey, [survey.def.questions[0].options[1].id, 30]);
  const r = await answer(owner, shared, [shared.def.questions[0].options[0].id]);
  const edit = (
    await send(owner, "post", `/attempts/${r.id}/edit`, { revision: r.revision }).expect(200)
  ).body.attempt;
  await send(owner, "post", `/attempts/${r.id}/submit`, {
    revision: edit.revision,
    submissionId: randomUUID(),
    answers: [
      { questionId: shared.def.questions[0].id, value: shared.def.questions[0].options[1].id },
    ],
  }).expect(200);
  const draft = (await send(owner, "post", "/surveys").expect(201)).body;
  await send(owner, "put", `/surveys/${draft._id}/draft`, {
    revision: 1,
    definition: {
      ...emptyDefinition(),
      title: "核查草稿",
      questions: [{ ...(await imported(owner, v2._id)), order: 1 }],
    },
    deadlineAt: null,
  }).expect(200);
  await send(owner, "post", `/surveys/${survey._id}/copy`).expect(201);
  await send(owner, "post", `/surveys/${shared._id}/close`).expect(404);
  await send(reader, "post", `/surveys/${shared._id}/close`).expect(200);
});
afterAll(async () => {
  await db?.client.close();
});

describe("数据库一致性核查（npm run db:verify）", () => {
  it("正常接口产生的一期与二期数据：零错误、零提示，覆盖全部集合", async () => {
    const report = await verifyDatabase(db.db);
    expect(problems(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.id)).toEqual([
      "collections",
      "indexes",
      "documents",
      "users",
      "surveys",
      "survey_versions",
      "definitions",
      "responses",
      "question_banks",
      "question_families",
      "question_versions",
      "sources",
    ]);
    expect(Object.keys(report.counts).sort()).toEqual(Object.keys(validators).sort());
    expect(report.counts.question_versions).toBe(4);
    expect(report.checks.find((c) => c.id === "sources")!.checked).toBe(4);
    expect((await get(owner, `/library/questions/${familyId}`)).status).toBe(200);
  });
  it("版本计数、孤立版本、被改的发布快照、缺失索引、违规文档都能被定位", async () => {
    const families = db.db.collection("question_families"),
      versions = db.db.collection("question_versions");
    await families.updateOne({ _id: new ObjectId(familyId) }, { $inc: { versionCount: 1 } });
    const orphan = new ObjectId();
    const stored = await versions.findOne({ _id: new ObjectId(v1) });
    await versions.insertOne({ ...stored, _id: orphan, familyId: new ObjectId(), versionNumber: 1 });
    const snapshot = await db.versions.findOne({ _id: new ObjectId(survey.versionId) });
    await db.versions.updateOne(
      { _id: snapshot!._id },
      { $set: { "definition.questions.0.title": "被偷改的题干" } },
    );
    await versions.dropIndex("familyId_1_versionNumber_1");
    const bad = new ObjectId();
    await db.db
      .collection("question_banks")
      .insertOne({ _id: bad, name: "缺字段" }, { bypassDocumentValidation: true });
    try {
      const report = await verifyDatabase(db.db);
      expect(report.ok).toBe(false);
      expect(problems(report, "question_families").join()).toContain("versionCount");
      expect(problems(report, "question_versions").join()).toContain("孤立版本");
      expect(problems(report, "sources").join()).toContain("核心内容与题库版本不一致");
      expect(problems(report, "indexes").join()).toContain("familyId");
      expect(problems(report, "documents").join()).toContain(bad.toHexString());
    } finally {
      await families.updateOne({ _id: new ObjectId(familyId) }, { $inc: { versionCount: -1 } });
      await versions.deleteOne({ _id: orphan });
      await db.versions.replaceOne({ _id: snapshot!._id }, snapshot!);
      await db.db.collection("question_banks").deleteOne({ _id: bad });
      await initializeDatabase(db.db);
    }
    expect((await verifyDatabase(db.db)).ok).toBe(true);
  });
  it("与升级前备份比对：发布快照被改为错误，正常业务更新只作提示", async () => {
    const dir = mkdtempSync(join(tmpdir(), "verify-baseline-"));
    try {
      for (const name of ["users", "surveys", "survey_versions", "responses"])
        writeFileSync(
          join(dir, `${name}.json`),
          BSON.EJSON.stringify(await db.db.collection(name).find({}).toArray(), {
            relaxed: false,
          }),
        );
      const clean = await verifyDatabase(db.db, { baselineDir: dir });
      expect(problems(clean)).toEqual([]);
      const snapshot = await db.versions.findOne({ _id: new ObjectId(survey.versionId) });
      const response = await db.responses.findOne({ surveyId: snapshot!.surveyId });
      await db.versions.updateOne(
        { _id: snapshot!._id },
        { $set: { "definition.description": "改写历史" } },
      );
      await db.responses.updateOne({ _id: response!._id }, { $set: { updatedAt: new Date() } });
      try {
        const report = await verifyDatabase(db.db, { baselineDir: dir });
        expect(problems(report, "baseline").join()).toContain("不可变发布快照被修改");
        expect(problems(report, "baseline_changes").join()).toContain(
          response!._id.toHexString(),
        );
        expect(report.checks.find((c) => c.id === "baseline_changes")!.level).toBe("warning");
      } finally {
        await db.versions.replaceOne({ _id: snapshot!._id }, snapshot!);
        await db.responses.replaceOne({ _id: response!._id }, response!);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
