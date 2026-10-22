import { ObjectId, BSON, type ClientSession } from "mongodb";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  DomainError,
  emptyDefinition,
  replayPath,
  validateDefinition,
  type Answer,
  type Definition,
} from "../../../packages/shared/src/domain.js";
import type { Database } from "./database.js";
import type { Config } from "./config.js";
import type { Response, Survey, Version } from "./models.js";

export const objectId = (value: string) => {
  if (!/^[a-f\d]{24}$/i.test(value))
    throw new DomainError("INVALID_ID", "资源标识格式错误", 400);
  return new ObjectId(value);
};
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const notFound = (): never => {
  throw new DomainError("NOT_FOUND", "资源不存在或无权访问", 404);
};
const conflict = (): never => {
  throw new DomainError("REVISION_CONFLICT", "内容已更新，请刷新后重试", 409);
};
const sizeCheck = (value: object) => {
  if (BSON.calculateObjectSize(value) > 1024 * 1024)
    throw new DomainError("TOO_LARGE", "数据超过 1 MiB 限制", 422);
};
export function parseDeadline(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(value))
    throw new DomainError("DEADLINE_INVALID", "截止时间必须包含时区", 422);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
    throw new DomainError("DEADLINE_INVALID", "截止时间必须在未来", 422);
  return date;
}
export function assertOpen(s: Survey) {
  if (
    s.status !== "published" ||
    (s.deadlineAt && s.deadlineAt.getTime() <= Date.now())
  )
    throw new DomainError("SURVEY_CLOSED", "问卷已关闭或已截止", 410);
}
export function publicSurvey(s: Survey) {
  return {
    id: s._id,
    publicId: s.publicId,
    title: s.title,
    status: s.status,
    effectiveStatus:
      s.status === "published" &&
      s.deadlineAt &&
      s.deadlineAt.getTime() <= Date.now()
        ? "expired"
        : s.status,
    deadlineAt: s.deadlineAt,
    publishedAt: s.publishedAt,
  };
}

export class SurveyService {
  constructor(
    public d: Database,
    public cfg: Config,
  ) {}
  key(surveyId: ObjectId, userId: ObjectId) {
    return createHmac("sha256", this.cfg.hmacKey)
      .update(`${surveyId.toHexString()}:${userId.toHexString()}`)
      .digest("hex");
  }
  async transaction<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const s = this.d.client.startSession();
    try {
      return (await s.withTransaction(() => fn(s), {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 10000,
      }))!;
    } finally {
      await s.endSession();
    }
  }
  async owned(id: string, userId: ObjectId, session?: ClientSession) {
    return (
      (await this.d.surveys.findOne(
        { _id: objectId(id), ownerId: userId },
        { session },
      )) ?? notFound()
    );
  }
  async byPublic(id: string) {
    return (
      (await this.d.surveys.findOne({
        publicId: id,
        status: { $ne: "draft" },
      })) ?? notFound()
    );
  }
  async version(s: Survey, session?: ClientSession) {
    if (!s.activeVersionId) return notFound();
    return (
      (await this.d.versions.findOne(
        { _id: s.activeVersionId, surveyId: s._id },
        { session },
      )) ?? notFound()
    );
  }
  async list(userId: ObjectId, cursor?: string) {
    let before: object = {};
    if (cursor) {
      try {
        const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
        const time = new Date(c.time);
        if (!Number.isFinite(time.getTime())) throw Error();
        before = {
          $or: [
            { updatedAt: { $lt: time } },
            { updatedAt: time, _id: { $lt: objectId(c.id) } },
          ],
        };
      } catch {
        throw new DomainError("CURSOR_INVALID", "分页游标无效", 400);
      }
    }
    const items = await this.d.surveys
      .find({ ownerId: userId, ...before }, { projection: { draft: 0 } })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(21)
      .toArray();
    const more = items.length > 20;
    items.splice(20);
    const counts = await this.d.responses
      .aggregate([
        {
          $match: {
            surveyId: { $in: items.map((x) => x._id) },
            status: "submitted",
          },
        },
        {
          $group: {
            _id: { surveyId: "$surveyId", participant: "$participantKey" },
            count: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: "$_id.surveyId",
            totalSubmissions: { $sum: "$count" },
            uniqueRespondents: { $sum: 1 },
          },
        },
      ])
      .toArray();
    const last = items.at(-1);
    return {
      items: items.map((s) => ({
        ...s,
        ...publicSurvey(s),
        totalSubmissions:
          counts.find((c) => c._id.equals(s._id))?.totalSubmissions ?? 0,
        uniqueRespondents:
          counts.find((c) => c._id.equals(s._id))?.uniqueRespondents ?? 0,
      })),
      nextCursor:
        more && last
          ? Buffer.from(
              JSON.stringify({ time: last.updatedAt, id: last._id }),
            ).toString("base64url")
          : null,
    };
  }
  async create(userId: ObjectId, definition?: Definition) {
    const now = new Date(),
      draft = definition ?? emptyDefinition();
    const s: Survey = {
      _id: new ObjectId(),
      schemaVersion: 1,
      ownerId: userId,
      publicId: randomBytes(16).toString("base64url"),
      title: draft.title,
      status: "draft",
      deadlineAt: null,
      draft,
      activeVersionId: null,
      activeVersionNumber: 0,
      revision: 1,
      submissionGateSeq: 0,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      closedAt: null,
    };
    await this.d.surveys.insertOne(s);
    return s;
  }
  async detail(id: string, userId: ObjectId) {
    const s = await this.owned(id, userId);
    return {
      ...s,
      definition: s.draft ?? (await this.version(s)).definition,
      ...publicSurvey(s),
    };
  }
  async save(
    id: string,
    userId: ObjectId,
    revision: number,
    input: unknown,
    deadline: unknown,
  ) {
    const definition = validateDefinition(input);
    sizeCheck(definition);
    const deadlineAt = parseDeadline(deadline);
    const s = await this.d.surveys.findOneAndUpdate(
      { _id: objectId(id), ownerId: userId, status: "draft", revision },
      {
        $set: {
          draft: definition,
          title: definition.title,
          deadlineAt,
          updatedAt: new Date(),
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
    if (!s) {
      await this.owned(id, userId);
      return conflict();
    }
    return s;
  }
  async publish(id: string, userId: ObjectId, revision: number) {
    return this.transaction(async (session) => {
      const s = await this.owned(id, userId, session);
      if (s.status === "published") {
        const v = await this.version(s, session);
        if (v.sourceDraftRevision === revision)
          return { ...publicSurvey(s), versionId: v._id, revision: s.revision };
        return conflict();
      }
      if (s.status !== "draft" || s.revision !== revision) return conflict();
      const definition = validateDefinition(s.draft, true);
      sizeCheck(definition);
      if (s.deadlineAt && s.deadlineAt <= new Date())
        throw new DomainError("DEADLINE_INVALID", "截止时间已过");
      const v: Version = {
        _id: new ObjectId(),
        schemaVersion: 1,
        surveyId: s._id,
        versionNumber: 1,
        sourceDraftRevision: revision,
        definition,
        createdBy: userId,
        publishedAt: new Date(),
      };
      await this.d.versions.insertOne(v, { session });
      const updated = await this.d.surveys.findOneAndUpdate(
        { _id: s._id, ownerId: userId, status: "draft", revision },
        {
          $set: {
            status: "published",
            activeVersionId: v._id,
            activeVersionNumber: 1,
            draft: null,
            publishedAt: v.publishedAt,
            updatedAt: v.publishedAt,
          },
          $inc: { revision: 1 },
        },
        { session, returnDocument: "after" },
      );
      if (!updated) return conflict();
      return {
        ...publicSurvey(updated),
        versionId: v._id,
        revision: updated.revision,
      };
    });
  }
  async close(id: string, userId: ObjectId) {
    const s = await this.owned(id, userId);
    if (s.status === "draft")
      throw new DomainError("NOT_PUBLISHED", "草稿尚未发布");
    if (s.status === "closed") return publicSurvey(s);
    const updated = await this.d.surveys.findOneAndUpdate(
      { _id: s._id, ownerId: userId, status: "published" },
      {
        $set: { status: "closed", closedAt: new Date(), updatedAt: new Date() },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
    return publicSurvey(updated ?? (await this.owned(id, userId)));
  }
  async deadline(id: string, userId: ObjectId, value: unknown) {
    const deadlineAt = parseDeadline(value);
    const s = await this.d.surveys.findOneAndUpdate(
      { _id: objectId(id), ownerId: userId, status: { $ne: "closed" } },
      { $set: { deadlineAt, updatedAt: new Date() }, $inc: { revision: 1 } },
      { returnDocument: "after" },
    );
    if (!s) {
      await this.owned(id, userId);
      throw new DomainError("SURVEY_CLOSED", "已关闭问卷不能调整截止时间", 410);
    }
    return { ...publicSurvey(s), revision: s.revision };
  }
  async attempt(id: string, userId: ObjectId, session?: ClientSession) {
    const r = await this.d.responses.findOne(
      { _id: objectId(id) },
      { session },
    );
    if (!r || r.participantKey !== this.key(r.surveyId, userId))
      return notFound();
    return r;
  }
  viewAttempt(r: Response) {
    return {
      id: r._id,
      surveyId: r.surveyId,
      surveyVersionId: r.surveyVersionId,
      status: r.status,
      isAnonymous: r.isAnonymous,
      repeatAllowed: r.repeatAllowed,
      answers: r.editDraft?.answers ?? r.answers,
      visitedQuestionIds: r.visitedQuestionIds,
      revision: r.revision,
      isEditing: !!r.editDraft,
      editCount: r.editCount,
      submittedAt: r.submittedAt,
      lastSubmittedAt: r.lastSubmittedAt,
    };
  }
  async readAttempt(id: string, userId: ObjectId) {
    const r = await this.attempt(id, userId);
    const s = (await this.d.surveys.findOne({ _id: r.surveyId })) ?? notFound();
    const v =
      (await this.d.versions.findOne({
        _id: r.surveyVersionId,
        surveyId: s._id,
      })) ?? notFound();
    return {
      attempt: this.viewAttempt(r),
      definition: v.definition,
      survey: publicSurvey(s),
    };
  }
  async myAttempts(publicId: string, userId: ObjectId) {
    const s = await this.byPublic(publicId);
    return {
      items: (
        await this.d.responses
          .find({ surveyId: s._id, participantKey: this.key(s._id, userId) })
          .sort({ updatedAt: -1 })
          .limit(50)
          .toArray()
      ).map((r) => this.viewAttempt(r)),
    };
  }
  async start(
    publicId: string,
    userId: ObjectId,
    clientAttemptId: string,
    isAnonymous: boolean,
  ) {
    const s = await this.byPublic(publicId);
    const participantKey = this.key(s._id, userId);
    const existing = await this.d.responses.findOne({
      surveyId: s._id,
      participantKey,
      clientAttemptId,
    });
    if (existing) return this.readAttempt(existing._id.toHexString(), userId);
    assertOpen(s);
    const v = await this.version(s);
    const settings = v.definition.settings;
    if (isAnonymous && !settings.allowAnonymous)
      throw new DomainError("ANONYMOUS_DISABLED", "此问卷不允许匿名提交");
    if (!settings.allowMultipleSubmissions) {
      const old = await this.d.responses.findOne({
        surveyId: s._id,
        participantKey,
        status: "submitted",
      });
      if (old)
        throw new DomainError(
          "ALREADY_SUBMITTED",
          "你已经提交过，可从原答卷修改答案",
          409,
        );
    }
    const now = new Date();
    const r: Response = {
      _id: new ObjectId(),
      schemaVersion: 1,
      surveyId: s._id,
      surveyVersionId: v._id,
      participantKey,
      clientAttemptId,
      status: "in_progress",
      isAnonymous,
      respondentId: isAnonymous ? null : userId,
      repeatAllowed: settings.allowMultipleSubmissions,
      answers: [],
      visitedQuestionIds: [],
      revision: 1,
      submissionHash: null,
      lastSubmissionId: null,
      editDraft: null,
      editCount: 0,
      startedAt: now,
      updatedAt: now,
      acceptedAt: null,
      submittedAt: null,
      lastSubmittedAt: null,
    };
    try {
      await this.d.responses.insertOne(r);
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      const old = await this.d.responses.findOne({
        surveyId: s._id,
        participantKey,
        clientAttemptId,
      });
      if (!old) throw e;
      return this.readAttempt(old._id.toHexString(), userId);
    }
    return this.readAttempt(r._id.toHexString(), userId);
  }
  async beginEdit(id: string, userId: ObjectId, revision: number) {
    const r = await this.attempt(id, userId);
    const s = (await this.d.surveys.findOne({ _id: r.surveyId })) ?? notFound();
    assertOpen(s);
    const v = await this.version(s);
    if (
      r.status !== "submitted" ||
      !v.definition.settings.allowEditAfterSubmission ||
      r.repeatAllowed
    )
      throw new DomainError("EDIT_DISABLED", "此答卷不允许提交后修改", 409);
    if (r.editDraft) return this.readAttempt(id, userId);
    if (r.revision !== revision) return conflict();
    const changed = await this.d.responses.updateOne(
      { _id: r._id, revision, status: "submitted", editDraft: null },
      {
        $set: { editDraft: { answers: r.answers }, updatedAt: new Date() },
        $inc: { revision: 1 },
      },
    );
    if (!changed.matchedCount) return conflict();
    return this.readAttempt(id, userId);
  }
  async saveAnswers(
    id: string,
    userId: ObjectId,
    revision: number,
    input: Answer[],
  ) {
    const r = await this.attempt(id, userId);
    const s = (await this.d.surveys.findOne({ _id: r.surveyId })) ?? notFound();
    assertOpen(s);
    const v =
      (await this.d.versions.findOne({ _id: r.surveyVersionId })) ?? notFound();
    if (r.status === "submitted" && !r.editDraft)
      throw new DomainError("EDIT_NOT_STARTED", "请先进入修改答案模式", 409);
    const { answers, visitedQuestionIds } = replayPath(
      v.definition,
      input,
      false,
    );
    sizeCheck({ answers });
    const filter = {
      _id: r._id,
      revision,
      ...(r.status === "submitted"
        ? { status: "submitted" as const, editDraft: { $ne: null } }
        : { status: "in_progress" as const }),
    };
    const changed = await this.d.responses.findOneAndUpdate(
      filter,
      {
        $set:
          r.status === "submitted"
            ? { "editDraft.answers": answers, updatedAt: new Date() }
            : { answers, visitedQuestionIds, updatedAt: new Date() },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
    if (!changed) return conflict();
    return this.viewAttempt(changed);
  }
  async submit(
    id: string,
    userId: ObjectId,
    revision: number,
    input: Answer[],
    submissionId: string,
  ) {
    return this.transaction(async (session) => {
      const r = await this.attempt(id, userId, session);
      const v =
        (await this.d.versions.findOne(
          { _id: r.surveyVersionId, surveyId: r.surveyId },
          { session },
        )) ?? notFound();
      const normalized = replayPath(v.definition, input, true);
      sizeCheck(normalized);
      const submissionHash = hash(
        JSON.stringify({
          versionId: r.surveyVersionId.toHexString(),
          isAnonymous: r.isAnonymous,
          answers: normalized.answers,
        }),
      );
      if (r.lastSubmissionId === submissionId) {
        if (r.submissionHash !== submissionHash)
          throw new DomainError(
            "IDEMPOTENCY_CONFLICT",
            "同一提交请求不能携带不同答案",
            409,
          );
        return this.viewAttempt(r);
      }
      if (r.revision !== revision) return conflict();
      const editing = r.status === "submitted";
      if (
        editing &&
        (!r.editDraft ||
          !v.definition.settings.allowEditAfterSubmission ||
          r.repeatAllowed)
      )
        throw new DomainError("ALREADY_SUBMITTED", "答卷已经提交", 409);
      const now = new Date();
      const gate = await this.d.surveys.updateOne(
        {
          _id: r.surveyId,
          status: "published",
          activeVersionId: r.surveyVersionId,
          $or: [{ deadlineAt: null }, { deadlineAt: { $gt: now } }],
        },
        { $inc: { submissionGateSeq: 1 } },
        { session },
      );
      if (!gate.matchedCount)
        throw new DomainError("SURVEY_CLOSED", "问卷已关闭或已截止", 410);
      const changed = await this.d.responses.findOneAndUpdate(
        { _id: r._id, revision },
        {
          $set: {
            ...normalized,
            status: "submitted",
            repeatAllowed: v.definition.settings.allowMultipleSubmissions,
            editDraft: null,
            submissionHash,
            lastSubmissionId: submissionId,
            acceptedAt: now,
            submittedAt: r.submittedAt ?? now,
            lastSubmittedAt: now,
            updatedAt: now,
          },
          $inc: { revision: 1, editCount: editing ? 1 : 0 },
        },
        { session, returnDocument: "after" },
      );
      if (!changed) return conflict();
      return this.viewAttempt(changed);
    });
  }
  async statistics(id: string, userId: ObjectId, versionId?: string) {
    const s = await this.owned(id, userId);
    const v = versionId
      ? await this.d.versions.findOne({
          _id: objectId(versionId),
          surveyId: s._id,
        })
      : await this.version(s);
    if (!v) return notFound();
    const [stats] = await this.d.responses
      .aggregate([
        {
          $match: {
            surveyId: s._id,
            surveyVersionId: v._id,
            status: "submitted",
          },
        },
        {
          $facet: {
            total: [
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  people: { $addToSet: "$participantKey" },
                },
              },
              { $project: { _id: 0, count: 1, people: { $size: "$people" } } },
            ],
            answered: [
              { $unwind: "$answers" },
              {
                $group: {
                  _id: "$answers.questionId",
                  count: { $sum: 1 },
                  people: { $addToSet: "$participantKey" },
                  average: {
                    $avg: {
                      $cond: [
                        { $eq: ["$answers.questionType", "number"] },
                        "$answers.value",
                        null,
                      ],
                    },
                  },
                },
              },
              {
                $project: {
                  count: 1,
                  people: { $size: "$people" },
                  average: 1,
                },
              },
            ],
            visited: [
              { $unwind: "$visitedQuestionIds" },
              { $group: { _id: "$visitedQuestionIds", count: { $sum: 1 } } },
            ],
            options: [
              { $unwind: "$answers" },
              {
                $match: {
                  "answers.questionType": {
                    $in: ["single_choice", "multiple_choice"],
                  },
                },
              },
              {
                $project: {
                  qid: "$answers.questionId",
                  participantKey: 1,
                  values: {
                    $cond: [
                      { $isArray: "$answers.value" },
                      "$answers.value",
                      ["$answers.value"],
                    ],
                  },
                },
              },
              { $unwind: "$values" },
              {
                $group: {
                  _id: { questionId: "$qid", optionId: "$values" },
                  count: { $sum: 1 },
                  people: { $addToSet: "$participantKey" },
                },
              },
              { $project: { count: 1, people: { $size: "$people" } } },
            ],
          },
        },
      ])
      .toArray();
    const total = stats.total[0] ?? { count: 0, people: 0 };
    return {
      survey: publicSurvey(s),
      versionId: v._id,
      totalSubmissions: total.count,
      uniqueRespondents: total.people,
      definition: v.definition,
      questions: v.definition.questions
        .sort((a, b) => a.order - b.order)
        .map((q) => {
          const a = stats.answered.find((x: any) => x._id === q.id),
            visited =
              stats.visited.find((x: any) => x._id === q.id)?.count ?? 0;
          return {
            id: q.id,
            title: q.title,
            type: q.type,
            arrivedCount: visited,
            answeredCount: a?.count ?? 0,
            uniqueRespondents: a?.people ?? 0,
            skippedCount: total.count - visited,
            unansweredCount: visited - (a?.count ?? 0),
            average: a?.average ?? null,
            options:
              q.options?.map((o) => {
                const c = stats.options.find(
                  (x: any) =>
                    x._id.questionId === q.id && x._id.optionId === o.id,
                );
                return {
                  id: o.id,
                  label: o.label,
                  count: c?.count ?? 0,
                  uniqueRespondents: c?.people ?? 0,
                };
              }) ?? [],
          };
        }),
    };
  }
  async values(id: string, userId: ObjectId, questionId: string, page: number) {
    const s = await this.owned(id, userId);
    const v = await this.version(s);
    if (!v.definition.questions.some((q) => q.id === questionId))
      return notFound();
    const data = await this.d.responses
      .aggregate([
        {
          $match: {
            surveyId: s._id,
            surveyVersionId: v._id,
            status: "submitted",
            "answers.questionId": questionId,
          },
        },
        { $sort: { submittedAt: -1, _id: -1 } },
        { $skip: (page - 1) * 20 },
        { $limit: 21 },
        {
          $project: {
            _id: 1,
            isAnonymous: 1,
            submittedAt: 1,
            answer: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: "$answers",
                    as: "a",
                    cond: { $eq: ["$$a.questionId", questionId] },
                  },
                },
                0,
              ],
            },
          },
        },
      ])
      .toArray();
    const more = data.length > 20;
    return { items: data.slice(0, 20), hasMore: more, page };
  }
}
