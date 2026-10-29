import { ObjectId, type ClientSession, type Document } from "mongodb";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DomainError,
  type Definition,
  type Question,
} from "../../../packages/shared/src/domain.js";
import {
  libraryContent,
  sameCore,
} from "../../../packages/shared/src/library.js";
import type { Database } from "./database.js";
import { objectId } from "./service.js";

export interface Family {
  _id: ObjectId;
  schemaVersion: 1;
  ownerId: ObjectId;
  latestVersionId: ObjectId;
  versionCount: number;
  revision: number;
  bankIds: ObjectId[];
  sharedWithUserIds: ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}
export interface ItemVersion {
  _id: ObjectId;
  schemaVersion: 1;
  familyId: ObjectId;
  versionNumber: number;
  parentVersionId: ObjectId | null;
  restoredFromVersionId: ObjectId | null;
  content: Question;
  createdBy: ObjectId;
  createdAt: Date;
}
export interface Bank {
  _id: ObjectId;
  schemaVersion: 1;
  ownerId: ObjectId;
  name: string;
  description: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}
const missing = (): never => {
  throw new DomainError("NOT_FOUND", "资源不存在或无权访问", 404);
};
const conflict = (): never => {
  throw new DomainError(
    "REVISION_CONFLICT",
    "内容已更新，请重新打开后再保存",
    409,
  );
};
export const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
export const scopeSchema = z.enum(["version", "family"]).default("version");
export type StatScope = z.infer<typeof scopeSchema>;
const bankInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1000).default(""),
  })
  .strict();
const versionInput = z
  .object({
    revision: z.number().int().positive(),
    content: z.unknown(),
    restore: z.boolean().default(false),
  })
  .strict();

export class LibraryService {
  families;
  versions;
  banks;
  constructor(public d: Database) {
    this.families = d.db.collection<Family>("question_families");
    this.versions = d.db.collection<ItemVersion>("question_versions");
    this.banks = d.db.collection<Bank>("question_banks");
  }
  async transaction<T>(fn: (session: ClientSession) => Promise<T>) {
    const session = this.d.client.startSession();
    try {
      return (await session.withTransaction(() => fn(session), {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      }))!;
    } finally {
      await session.endSession();
    }
  }
  async family(
    id: string,
    user: ObjectId,
    owned = false,
    session?: ClientSession,
  ) {
    return (
      (await this.families.findOne(
        {
          _id: objectId(id),
          ...(owned
            ? { ownerId: user }
            : { $or: [{ ownerId: user }, { sharedWithUserIds: user }] }),
        },
        { session },
      )) ?? missing()
    );
  }
  async version(id: string, user: ObjectId) {
    const version =
      (await this.versions.findOne({ _id: objectId(id) })) ?? missing();
    const family = await this.family(version.familyId.toHexString(), user);
    return { version, family };
  }
  async list(user: ObjectId, page: number, bankId?: string) {
    const filter: Document = {
      $or: [{ ownerId: user }, { sharedWithUserIds: user }],
    };
    if (bankId) {
      if (!(await this.banks.findOne({ _id: objectId(bankId), ownerId: user })))
        missing();
      filter.bankIds = objectId(bankId);
      filter.ownerId = user;
    }
    const rows = await this.families
      .find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * 20)
      .limit(21)
      .toArray();
    const hasMore = rows.length > 20;
    rows.splice(20);
    const items = await Promise.all(
      rows.map(async (f) => ({
        _id: f._id,
        revision: f.revision,
        bankIds: f.ownerId.equals(user) ? f.bankIds : [],
        owned: f.ownerId.equals(user),
        versionCount: f.versionCount,
        latest: await this.versions.findOne({ _id: f.latestVersionId }),
        owner:
          (
            await this.d.users.findOne(
              { _id: f.ownerId },
              { projection: { username: 1 } },
            )
          )?.username ?? "用户",
      })),
    );
    return { items, hasMore, page };
  }
  async create(user: ObjectId, input: unknown) {
    const p = z
      .object({ content: z.unknown(), fromVersionId: z.string().optional() })
      .strict()
      .parse(input);
    if (p.fromVersionId) await this.version(p.fromVersionId, user);
    const content = libraryContent(p.content),
      now = new Date(),
      fid = new ObjectId(),
      vid = new ObjectId();
    const f: Family = {
      _id: fid,
      schemaVersion: 1,
      ownerId: user,
      latestVersionId: vid,
      versionCount: 1,
      revision: 1,
      bankIds: [],
      sharedWithUserIds: [],
      createdAt: now,
      updatedAt: now,
    };
    const v: ItemVersion = {
      _id: vid,
      schemaVersion: 1,
      familyId: fid,
      versionNumber: 1,
      parentVersionId: p.fromVersionId ? objectId(p.fromVersionId) : null,
      restoredFromVersionId: null,
      content,
      createdBy: user,
      createdAt: now,
    };
    await this.transaction(async (session) => {
      await this.families.insertOne(f, { session });
      await this.versions.insertOne(v, { session });
    });
    return { family: f, version: v };
  }
  async detail(id: string, user: ObjectId, page: number) {
    const f = await this.family(id, user);
    const owned = f.ownerId.equals(user);
    const versions = await this.versions
      .find({ familyId: f._id })
      .sort({ versionNumber: -1 })
      .skip((page - 1) * 20)
      .limit(21)
      .toArray();
    const hasMore = versions.length > 20;
    versions.splice(20);
    const sharedWith = owned
      ? await this.d.users
          .find(
            { _id: { $in: f.sharedWithUserIds } },
            { projection: { username: 1 } },
          )
          .toArray()
      : [];
    return {
      family: {
        ...f,
        sharedWithUserIds: undefined,
        bankIds: owned ? f.bankIds : [],
      },
      owned,
      sharedWith,
      versions,
      hasMore,
      page,
    };
  }
  async newVersion(id: string, user: ObjectId, input: unknown) {
    const p = versionInput.parse(input);
    const { version: base } = await this.version(id, user);
    const content = p.restore ? base.content : libraryContent(p.content);
    return this.transaction(async (session) => {
      const f = await this.family(
        base.familyId.toHexString(),
        user,
        true,
        session,
      );
      if (f.revision !== p.revision) conflict();
      const now = new Date(),
        v: ItemVersion = {
          _id: new ObjectId(),
          schemaVersion: 1,
          familyId: f._id,
          versionNumber: f.versionCount + 1,
          parentVersionId: p.restore ? f.latestVersionId : base._id,
          restoredFromVersionId: p.restore ? base._id : null,
          content,
          createdBy: user,
          createdAt: now,
        };
      const r = await this.families.updateOne(
        { _id: f._id, revision: p.revision },
        {
          $set: { latestVersionId: v._id, updatedAt: now },
          $inc: { revision: 1, versionCount: 1 },
        },
        { session },
      );
      if (!r.modifiedCount) conflict();
      await this.versions.insertOne(v, { session });
      return v;
    });
  }
  async configure(id: string, user: ObjectId, input: unknown) {
    const p = z
      .object({
        revision: z.number().int().positive(),
        usernames: z.array(z.string().trim().min(3).max(32)).max(50),
        bankIds: z.array(z.string()).max(20),
      })
      .strict()
      .parse(input);
    const names = [...new Set(p.usernames.map((x) => x.toLowerCase()))],
      bankIds = [...new Set(p.bankIds)].map(objectId);
    const users = await this.d.users
      .find({ usernameNormalized: { $in: names } })
      .toArray();
    if (users.length !== names.length)
      throw new DomainError("USER_NOT_FOUND", "共享用户名中存在未注册账号");
    if (
      (await this.banks.countDocuments({
        _id: { $in: bankIds },
        ownerId: user,
      })) !== bankIds.length
    )
      missing();
    await this.family(id, user, true);
    const f = await this.families.findOneAndUpdate(
      { _id: objectId(id), ownerId: user, revision: p.revision },
      {
        $set: {
          sharedWithUserIds: users
            .map((x) => x._id)
            .filter((x) => !x.equals(user)),
          bankIds,
          updatedAt: new Date(),
        },
        $inc: { revision: 1 },
      },
      { returnDocument: "after" },
    );
    return f ?? conflict();
  }
  async saveBank(user: ObjectId, input: unknown, id?: string) {
    if (!id) {
      const p = bankInput.parse(input),
        now = new Date();
      const b: Bank = {
        _id: new ObjectId(),
        schemaVersion: 1,
        ownerId: user,
        ...p,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.banks.insertOne(b);
      return b;
    }
    const p = bankInput
      .extend({ revision: z.number().int().positive() })
      .parse(input);
    if (!(await this.banks.findOne({ _id: objectId(id), ownerId: user })))
      missing();
    return (
      (await this.banks.findOneAndUpdate(
        { _id: objectId(id), ownerId: user, revision: p.revision },
        {
          $set: {
            name: p.name,
            description: p.description,
            updatedAt: new Date(),
          },
          $inc: { revision: 1 },
        },
        { returnDocument: "after" },
      )) ?? conflict()
    );
  }
  async importVersion(id: string, user: ObjectId) {
    const { version: v } = await this.version(id, user);
    return {
      ...v.content,
      id: randomUUID(),
      source: {
        familyId: v.familyId.toHexString(),
        versionId: v._id.toHexString(),
      },
    };
  }
  async validateSources(
    def: Definition,
    user: ObjectId,
    previous?: Definition,
    session?: ClientSession,
  ) {
    for (const q of def.questions)
      if (q.source) {
        const v = await this.versions.findOne(
          {
            _id: objectId(q.source.versionId),
            familyId: objectId(q.source.familyId),
          },
          { session },
        );
        if (!v || !sameCore(q, v.content))
          throw new DomainError(
            "SOURCE_MISMATCH",
            "题库版本内容不能直接修改，请创建新版本或解除关联",
          );
        const existing = previous?.questions.some(
          (old) =>
            old.source?.versionId === q.source!.versionId &&
            old.source?.familyId === q.source!.familyId,
        );
        if (!existing)
          await this.family(q.source.familyId, user, false, session);
      }
  }
  /** Versions considered by usage/statistics: the chosen version, or every version of its family. */
  async scopeVersions(v: ItemVersion, scope: StatScope) {
    return scope === "family"
      ? await this.versions
          .find({ familyId: v.familyId })
          .sort({ versionNumber: -1 })
          .toArray()
      : [v];
  }
  async usage(id: string, user: ObjectId, scope: StatScope = "version") {
    id = objectId(id).toHexString();
    const { version: v, family: f } = await this.version(id, user),
      author = f.ownerId.equals(user);
    const scoped = await this.scopeVersions(v, scope),
      ids = scoped.map((x) => x._id.toHexString()),
      numbers = new Map<string, number>(
        scoped.map((x) => [x._id.toHexString(), x.versionNumber]),
      );
    const published = await this.d.versions
      .find({ "definition.questions.source.versionId": { $in: ids } })
      .toArray();
    const drafts = await this.d.surveys
      .find({
        status: "draft",
        "draft.questions.source.versionId": { $in: ids },
      })
      .toArray();
    const rows = await this.d.surveys
      .find({ _id: { $in: published.map((x) => x.surveyId) } })
      .toArray();
    const seen = new Set<string>();
    const visible = [...drafts, ...rows].filter((s) => {
      const key = s._id.toHexString();
      if (seen.has(key)) return false;
      seen.add(key);
      return author || s.ownerId.equals(user);
    });
    return {
      items: visible.map((s) => {
        const definition =
          s.draft ??
          published.find((x) => x._id.equals(s.activeVersionId!))?.definition;
        const own = s.ownerId.equals(user),
          disclose = own || !!definition?.settings.shareLibraryStatistics;
        return {
          id: own ? s._id : undefined,
          title: disclose ? s.title : "其他用户的问卷（未授权展示名称）",
          status: s.status,
          owned: own,
          statisticsIncluded:
            own || !!definition?.settings.shareLibraryStatistics,
          versionNumbers: [
            ...new Set(
              (definition?.questions ?? []).flatMap((q): number[] =>
                q.source && numbers.has(q.source.versionId)
                  ? [numbers.get(q.source.versionId)!]
                  : [],
              ),
            ),
          ].sort((a, b) => a - b),
        };
      }),
      versionId: v._id,
      scope,
    };
  }
  /**
   * Cross-survey statistics. scope=version counts one exact version;
   * scope=family adds every version of the same question family whose type
   * equals the chosen version (answers of other types are not comparable).
   */
  async stats(
    id: string,
    user: ObjectId,
    page: number,
    scope: StatScope = "version",
  ) {
    id = objectId(id).toHexString();
    const { version: v, family: f } = await this.version(id, user);
    const scoped = await this.scopeVersions(v, scope),
      included = scoped.filter((x) => x.content.type === v.content.type),
      excludedVersions = scoped
        .filter((x) => x.content.type !== v.content.type)
        .map((x) => ({
          versionId: x._id,
          versionNumber: x.versionNumber,
          type: x.content.type,
        })),
      ids = new Set(included.map((x) => x._id.toHexString()));
    const matches = await this.d.versions
      .find({ "definition.questions.source.versionId": { $in: [...ids] } })
      .toArray();
    const surveys = await this.d.surveys
      .find({ _id: { $in: matches.map((x) => x.surveyId) } })
      .toArray();
    const eligible = matches.filter((x) =>
      surveys.some(
        (s) =>
          s._id.equals(x.surveyId) &&
          (s.ownerId.equals(user) ||
            (f.ownerId.equals(user) &&
              x.definition.settings.shareLibraryStatistics)),
      ),
    );
    const own = surveys.filter((s) => s.ownerId.equals(user)).map((s) => s._id);
    // survey version + question instance -> library version it was imported from
    const instanceVersion = new Map<string, string>();
    const ors = eligible.flatMap((x) =>
      x.definition.questions
        .filter((q) => q.source && ids.has(q.source.versionId))
        .map((q) => {
          instanceVersion.set(
            `${x._id.toHexString()}:${q.id}`,
            q.source!.versionId,
          );
          return { surveyVersionId: x._id, "answers.questionId": q.id };
        }),
    );
    // A reused option ID may have changed meaning. Merge only identical ID + label,
    // and resolve each answer using its immutable question version.
    const optionKey = (id: string, label: string) =>
      JSON.stringify([id, label]);
    const versionOptionKeys = new Map<string, string>();
    const optionMap = new Map<
      string,
      {
        key: string;
        id: string;
        label: string;
        order: number;
        versionNumbers: number[];
      }
    >();
    for (const x of included)
      for (const o of [...(x.content.options ?? [])].sort(
        (a, b) => a.order - b.order,
      )) {
        const key = optionKey(o.id, o.label);
        versionOptionKeys.set(`${x._id.toHexString()}:${o.id}`, key);
        const known = optionMap.get(key);
        if (known) known.versionNumbers.push(x.versionNumber);
        else
          optionMap.set(key, {
            key,
            id: o.id,
            label: o.label,
            order: optionMap.size + 1,
            versionNumbers: [x.versionNumber],
          });
      }
    const optionList = [...optionMap.values()].map((o) => ({
      ...o,
      versionNumbers: o.versionNumbers.sort((a, b) => a - b),
    }));
    const versionRows = (counts: Map<string, number>) =>
      included.map((x) => ({
        versionId: x._id,
        versionNumber: x.versionNumber,
        title: x.content.title,
        answerCount: counts.get(x._id.toHexString()) ?? 0,
      }));
    const empty = {
      scope,
      type: v.content.type,
      answerCount: 0,
      average: null,
      min: null,
      max: null,
      distribution: [],
      options: optionList.map((o) => ({ ...o, count: 0 })),
      texts: [],
      hasMore: false,
      surveyCount: eligible.length,
      versions: versionRows(new Map()),
      excludedVersions,
    };
    if (!ors.length) return empty;
    const base: Document[] = [
      {
        $match: {
          // surveyId first so the existing statistics index can be used.
          surveyId: { $in: eligible.map((x) => x.surveyId) },
          status: "submitted",
          surveyVersionId: { $in: eligible.map((x) => x._id) },
        },
      },
      { $unwind: "$answers" },
      { $match: { $or: ors } },
    ];
    const [result] = await this.d.responses
      .aggregate([
        ...base,
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  average: { $avg: "$answers.value" },
                  min: { $min: "$answers.value" },
                  max: { $max: "$answers.value" },
                },
              },
            ],
            perInstance: [
              {
                $group: {
                  _id: {
                    surveyVersionId: "$surveyVersionId",
                    questionId: "$answers.questionId",
                  },
                  count: { $sum: 1 },
                },
              },
            ],
            options: v.content.type.includes("choice")
              ? [
                  { $unwind: "$answers.value" },
                  {
                    $group: {
                      _id: {
                        surveyVersionId: "$surveyVersionId",
                        questionId: "$answers.questionId",
                        optionId: "$answers.value",
                      },
                      count: { $sum: 1 },
                    },
                  },
                ]
              : [{ $match: { _id: null } }],
            distribution:
              v.content.type === "number"
                ? [
                    {
                      $bucketAuto: {
                        groupBy: "$answers.value",
                        buckets: 10,
                        output: { count: { $sum: 1 } },
                      },
                    },
                  ]
                : [{ $match: { _id: null } }],
            texts: [
              {
                $match: {
                  surveyId: { $in: own },
                  "answers.questionType": "text",
                },
              },
              { $sort: { submittedAt: -1, _id: -1 } },
              { $skip: (page - 1) * 20 },
              { $limit: 21 },
              { $project: { _id: 0, value: "$answers.value" } },
            ],
          },
        },
      ])
      .toArray();
    const n = result.summary[0];
    const optionCounts = new Map<string, number>();
    for (const row of result.options as {
      _id: { surveyVersionId: ObjectId; questionId: string; optionId: string };
      count: number;
    }[]) {
      const versionId = instanceVersion.get(
        `${row._id.surveyVersionId.toHexString()}:${row._id.questionId}`,
      );
      const key = versionOptionKeys.get(`${versionId}:${row._id.optionId}`);
      if (key) optionCounts.set(key, (optionCounts.get(key) ?? 0) + row.count);
    }
    const perVersion = new Map<string, number>();
    for (const row of result.perInstance as {
      _id: { surveyVersionId: ObjectId; questionId: string };
      count: number;
    }[]) {
      const key = instanceVersion.get(
        `${row._id.surveyVersionId.toHexString()}:${row._id.questionId}`,
      );
      if (key) perVersion.set(key, (perVersion.get(key) ?? 0) + row.count);
    }
    return {
      ...empty,
      answerCount: n?.count ?? 0,
      average: v.content.type === "number" ? (n?.average ?? null) : null,
      min: v.content.type === "number" ? (n?.min ?? null) : null,
      max: v.content.type === "number" ? (n?.max ?? null) : null,
      distribution: result.distribution,
      options: optionList.map((o) => ({
        ...o,
        count: optionCounts.get(o.key) ?? 0,
      })),
      texts: result.texts.slice(0, 20),
      hasMore: result.texts.length > 20,
      versions: versionRows(perVersion),
    };
  }
}
