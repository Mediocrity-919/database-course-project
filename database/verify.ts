// Read-only consistency audit for the questionnaire database.
// It never writes: only listCollections / listIndexes / find / countDocuments.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BSON, type Db, type Document, type ObjectId } from "mongodb";
import { validators } from "./schema.js";
import {
  validateDefinition,
  type Definition,
  type Question,
} from "../packages/shared/src/domain.js";
import { libraryContent, sameCore } from "../packages/shared/src/library.js";

export type Level = "error" | "warning";
export interface Check {
  id: string;
  title: string;
  level: Level;
  checked: number;
  problems: string[];
}
export interface VerifyReport {
  database: string;
  generatedAt: string;
  counts: Record<string, number>;
  checks: Check[];
  errors: number;
  warnings: number;
  ok: boolean;
}

/** Index specs created by initializeDatabase; key order matters. */
export const expectedIndexes: {
  collection: string;
  key: Document;
  unique?: boolean;
  ttl?: boolean;
  partial?: boolean;
}[] = [
  { collection: "users", key: { usernameNormalized: 1 }, unique: true },
  { collection: "sessions", key: { tokenHash: 1 }, unique: true },
  { collection: "sessions", key: { expiresAt: 1 }, ttl: true },
  { collection: "sessions", key: { userId: 1 } },
  { collection: "surveys", key: { publicId: 1 }, unique: true },
  { collection: "surveys", key: { ownerId: 1, updatedAt: -1, _id: -1 } },
  { collection: "surveys", key: { "draft.questions.source.versionId": 1 } },
  {
    collection: "survey_versions",
    key: { surveyId: 1, versionNumber: 1 },
    unique: true,
  },
  {
    collection: "survey_versions",
    key: { "definition.questions.source.versionId": 1 },
  },
  {
    collection: "responses",
    key: { surveyId: 1, participantKey: 1, clientAttemptId: 1 },
    unique: true,
  },
  {
    collection: "responses",
    key: { surveyId: 1, participantKey: 1 },
    unique: true,
    partial: true,
  },
  {
    collection: "responses",
    key: {
      surveyId: 1,
      status: 1,
      surveyVersionId: 1,
      submittedAt: -1,
      _id: -1,
    },
  },
  {
    collection: "responses",
    key: { surveyId: 1, participantKey: 1, status: 1, updatedAt: -1 },
  },
  { collection: "question_banks", key: { ownerId: 1, updatedAt: -1 } },
  { collection: "question_families", key: { ownerId: 1, updatedAt: -1 } },
  {
    collection: "question_families",
    key: { sharedWithUserIds: 1, updatedAt: -1 },
  },
  { collection: "question_families", key: { bankIds: 1 } },
  {
    collection: "question_versions",
    key: { familyId: 1, versionNumber: 1 },
    unique: true,
  },
];

const LEGACY = ["users", "surveys", "survey_versions", "responses"];
const hex = (id: unknown) =>
  id && typeof (id as ObjectId).toHexString === "function"
    ? (id as ObjectId).toHexString()
    : String(id);
/** Normalises a value through BSON so JS numbers compare like stored ones. */
const canonical = (value: unknown) =>
  BSON.EJSON.stringify(
    BSON.deserialize(BSON.serialize({ value: value as Document })),
    { relaxed: true },
  );
const docHash = (doc: Document) =>
  BSON.EJSON.stringify(doc, { relaxed: false });

export async function verifyDatabase(
  db: Db,
  options: { baselineDir?: string } = {},
): Promise<VerifyReport> {
  const checks: Check[] = [];
  const check = (id: string, title: string, level: Level = "error") => {
    const c: Check = { id, title, level, checked: 0, problems: [] };
    checks.push(c);
    return c;
  };
  const all = async (name: string) =>
    db.collection(name).find({}).toArray() as Promise<Document[]>;

  // 1. Collections and validators
  const infos = await db.listCollections().toArray();
  const c1 = check("collections", "八个集合存在，validator与schema.ts一致且为strict/error");
  for (const [name, validator] of Object.entries(validators)) {
    c1.checked++;
    const info = infos.find((x) => x.name === name) as Document | undefined;
    if (!info) {
      c1.problems.push(`${name}: 集合不存在（请运行 npm run db:init）`);
      continue;
    }
    const o = info.options ?? {};
    if (o.validationLevel !== "strict" || o.validationAction !== "error")
      c1.problems.push(
        `${name}: validationLevel=${o.validationLevel} validationAction=${o.validationAction}`,
      );
    if (canonical(o.validator) !== canonical(validator))
      c1.problems.push(`${name}: 已部署validator与schema.ts不一致（请运行 npm run db:init）`);
  }

  // 2. Indexes
  const c2 = check("indexes", "唯一索引、TTL、部分唯一索引及查询索引齐全");
  for (const spec of expectedIndexes) {
    c2.checked++;
    if (!infos.some((x) => x.name === spec.collection)) {
      c2.problems.push(`${spec.collection}: 集合不存在`);
      continue;
    }
    const list = await db.collection(spec.collection).indexes();
    const found = list.find(
      (i) => JSON.stringify(i.key) === JSON.stringify(spec.key),
    );
    const label = `${spec.collection} ${JSON.stringify(spec.key)}`;
    if (!found) {
      c2.problems.push(`${label}: 缺少索引`);
      continue;
    }
    if (!!spec.unique !== !!found.unique)
      c2.problems.push(`${label}: unique=${!!found.unique}，应为${!!spec.unique}`);
    if (spec.ttl && found.expireAfterSeconds !== 0)
      c2.problems.push(`${label}: TTL expireAfterSeconds 应为0`);
    if (
      spec.partial &&
      canonical(found.partialFilterExpression) !==
        canonical({ status: "submitted", repeatAllowed: false })
    )
      c2.problems.push(`${label}: 部分索引条件不正确`);
  }

  // 3. Every stored document satisfies the current validator
  const c3 = check("documents", "所有已存文档满足当前validator（含二期收紧后的规则）");
  const counts: Record<string, number> = {};
  for (const [name, validator] of Object.entries(validators)) {
    if (!infos.some((x) => x.name === name)) continue;
    const coll = db.collection(name);
    counts[name] = await coll.countDocuments({});
    c3.checked += counts[name];
    const bad = await coll
      .find({ $nor: [validator] }, { projection: { _id: 1 } })
      .limit(20)
      .toArray();
    for (const d of bad) c3.problems.push(`${name} ${hex(d._id)}: 不满足validator`);
  }

  const users = await all("users"),
    surveys = await all("surveys"),
    surveyVersions = await all("survey_versions"),
    responses = await all("responses"),
    banks = await all("question_banks"),
    families = await all("question_families"),
    itemVersions = await all("question_versions");
  const userIds = new Set(users.map((u) => hex(u._id)));
  const surveyById = new Map(surveys.map((s) => [hex(s._id), s]));
  const svById = new Map(surveyVersions.map((v) => [hex(v._id), v]));
  const bankById = new Map(banks.map((b) => [hex(b._id), b]));
  const familyById = new Map(families.map((f) => [hex(f._id), f]));
  const itemById = new Map(itemVersions.map((v) => [hex(v._id), v]));

  // 4. Users
  const c4 = check("users", "用户名规范化字段一致（唯一性由唯一索引保证）");
  for (const u of users) {
    c4.checked++;
    if (u.usernameNormalized !== String(u.username).toLowerCase())
      c4.problems.push(`users ${hex(u._id)}: usernameNormalized与username不一致`);
  }

  // 5. Surveys and their published snapshots
  const c5 = check("surveys", "问卷状态、草稿、发布入口、标题冗余及归属一致");
  for (const s of surveys) {
    c5.checked++;
    const id = `surveys ${hex(s._id)}`;
    if (!userIds.has(hex(s.ownerId))) c5.problems.push(`${id}: ownerId不存在`);
    if (s.status === "draft") {
      if (!s.draft) c5.problems.push(`${id}: 草稿状态但draft为空`);
      if (s.activeVersionId) c5.problems.push(`${id}: 草稿状态却有activeVersionId`);
      if (s.draft && s.title !== s.draft.title)
        c5.problems.push(`${id}: title冗余与草稿标题不一致`);
      continue;
    }
    if (s.draft) c5.problems.push(`${id}: 已发布/关闭的问卷仍保存draft`);
    const v = svById.get(hex(s.activeVersionId));
    if (!v) {
      c5.problems.push(`${id}: activeVersionId指向的发布版本不存在`);
      continue;
    }
    if (hex(v.surveyId) !== hex(s._id))
      c5.problems.push(`${id}: activeVersionId属于其他问卷`);
    if (s.activeVersionNumber !== undefined && s.activeVersionNumber !== v.versionNumber)
      c5.problems.push(`${id}: activeVersionNumber与发布版本号不一致`);
    if (s.title !== v.definition?.title)
      c5.problems.push(`${id}: title冗余与发布标题不一致`);
    if (s.status === "closed" && !(s.closedAt instanceof Date))
      c5.problems.push(`${id}: closed但缺少closedAt`);
  }
  const c6 = check("survey_versions", "发布快照归属问卷存在、创建者为问卷所有者");
  for (const v of surveyVersions) {
    c6.checked++;
    const s = surveyById.get(hex(v.surveyId));
    if (!s) c6.problems.push(`survey_versions ${hex(v._id)}: 所属问卷不存在`);
    else if (hex(s.ownerId) !== hex(v.createdBy))
      c6.problems.push(`survey_versions ${hex(v._id)}: createdBy不是问卷所有者`);
  }
  const c7 = check(
    "definitions",
    "草稿与发布定义可被当前业务规则重新解析（跳转目标、选项、校验）",
    "warning",
  );
  const definitions: { where: string; def: Definition }[] = [];
  for (const s of surveys)
    if (s.draft) {
      c7.checked++;
      definitions.push({
        where: `surveys ${hex(s._id)} draft`,
        def: s.draft as Definition,
      });
      try {
        validateDefinition(s.draft);
      } catch (e) {
        c7.problems.push(`surveys ${hex(s._id)}: 草稿无法通过当前校验：${(e as Error).message}`);
      }
    }
  for (const v of surveyVersions) {
    c7.checked++;
    definitions.push({
      where: `survey_versions ${hex(v._id)}`,
      def: v.definition as Definition,
    });
    try {
      validateDefinition(v.definition, true);
    } catch (e) {
      c7.problems.push(`survey_versions ${hex(v._id)}: 发布定义无法通过当前校验：${(e as Error).message}`);
    }
  }

  // 6. Responses
  const c8 = check("responses", "答卷引用的问卷/发布版本、题目ID、题型与冻结策略一致");
  for (const r of responses) {
    c8.checked++;
    const id = `responses ${hex(r._id)}`;
    const v = svById.get(hex(r.surveyVersionId));
    if (!surveyById.has(hex(r.surveyId))) c8.problems.push(`${id}: 问卷不存在`);
    if (!v) {
      c8.problems.push(`${id}: 发布版本不存在`);
      continue;
    }
    if (hex(v.surveyId) !== hex(r.surveyId))
      c8.problems.push(`${id}: surveyVersionId不属于surveyId`);
    const settings = v.definition?.settings ?? {};
    if (r.repeatAllowed !== !!settings.allowMultipleSubmissions)
      c8.problems.push(`${id}: repeatAllowed与发布设置不一致`);
    if (r.isAnonymous && settings.allowAnonymous === false)
      c8.problems.push(`${id}: 问卷不允许匿名却存在匿名答卷`);
    if (!r.isAnonymous && r.respondentId && !userIds.has(hex(r.respondentId)))
      c8.problems.push(`${id}: respondentId不存在`);
    if (r.editDraft && r.status !== "submitted")
      c8.problems.push(`${id}: 未提交答卷不应有editDraft`);
    const types = new Map<string, string>(
      (v.definition?.questions ?? []).map((q: Question) => [q.id, q.type]),
    );
    const lists: Document[][] = [r.answers ?? [], r.editDraft?.answers ?? []];
    for (const list of lists)
      for (const a of list) {
        if (!types.has(a.questionId))
          c8.problems.push(`${id}: 答案题目${a.questionId}不在绑定版本中`);
        else if (types.get(a.questionId) !== a.questionType)
          c8.problems.push(`${id}: 答案题型与绑定版本不一致`);
      }
    for (const q of r.visitedQuestionIds ?? [])
      if (!types.has(q)) c8.problems.push(`${id}: visitedQuestionIds含不存在的题目`);
  }

  // 7. Question banks
  const c9 = check("question_banks", "题库所有者存在");
  for (const b of banks) {
    c9.checked++;
    if (!userIds.has(hex(b.ownerId)))
      c9.problems.push(`question_banks ${hex(b._id)}: ownerId不存在`);
  }

  // 8. Families: version chain, latest pointer, sharing and bank ownership
  const c10 = check(
    "question_families",
    "题目系列：版本号1..n连续、versionCount、latest指针、共享用户与题库归属一致",
  );
  const byFamily = new Map<string, Document[]>();
  for (const v of itemVersions) {
    const k = hex(v.familyId);
    byFamily.set(k, [...(byFamily.get(k) ?? []), v]);
  }
  for (const f of families) {
    c10.checked++;
    const id = `question_families ${hex(f._id)}`;
    if (!userIds.has(hex(f.ownerId))) c10.problems.push(`${id}: ownerId不存在`);
    const list = (byFamily.get(hex(f._id)) ?? []).sort(
      (a, b) => a.versionNumber - b.versionNumber,
    );
    if (!list.length) {
      c10.problems.push(`${id}: 没有任何版本`);
      continue;
    }
    if (f.versionCount !== list.length)
      c10.problems.push(`${id}: versionCount=${f.versionCount}，实际版本${list.length}个`);
    list.forEach((v, i) => {
      if (v.versionNumber !== i + 1)
        c10.problems.push(`${id}: 版本号不连续（第${i + 1}个为v${v.versionNumber}）`);
    });
    const latest = itemById.get(hex(f.latestVersionId));
    if (!latest || hex(latest.familyId) !== hex(f._id))
      c10.problems.push(`${id}: latestVersionId不属于本系列`);
    else if (latest.versionNumber !== list.at(-1)!.versionNumber)
      c10.problems.push(`${id}: latestVersionId不是最大版本号`);
    for (const u of f.sharedWithUserIds ?? []) {
      if (!userIds.has(hex(u))) c10.problems.push(`${id}: 共享用户不存在`);
      if (hex(u) === hex(f.ownerId)) c10.problems.push(`${id}: 共享名单包含作者本人`);
    }
    for (const b of f.bankIds ?? []) {
      const bank = bankById.get(hex(b));
      if (!bank) c10.problems.push(`${id}: 归属题库不存在`);
      else if (hex(bank.ownerId) !== hex(f.ownerId))
        c10.problems.push(`${id}: 归属了他人的题库`);
    }
  }

  // 9. Item versions: immutable content, lineage
  const c11 = check(
    "question_versions",
    "题目版本：系列存在、作者一致、父版本/恢复来源存在且早于本版本、内容无跳转与来源",
  );
  for (const v of itemVersions) {
    c11.checked++;
    const id = `question_versions ${hex(v._id)}`;
    const f = familyById.get(hex(v.familyId));
    if (!f) {
      c11.problems.push(`${id}: 所属系列不存在（孤立版本）`);
      continue;
    }
    if (hex(v.createdBy) !== hex(f.ownerId))
      c11.problems.push(`${id}: createdBy不是系列作者`);
    if (v.parentVersionId) {
      const p = itemById.get(hex(v.parentVersionId));
      if (!p) c11.problems.push(`${id}: parentVersionId不存在`);
      else if (p.createdAt > v.createdAt)
        c11.problems.push(`${id}: 父版本晚于本版本创建`);
      else if (hex(p.familyId) === hex(v.familyId) && p.versionNumber >= v.versionNumber)
        c11.problems.push(`${id}: 同系列父版本号不小于本版本`);
    } else if (v.versionNumber > 1)
      c11.problems.push(`${id}: v${v.versionNumber}缺少parentVersionId`);
    if (v.restoredFromVersionId) {
      const src = itemById.get(hex(v.restoredFromVersionId));
      if (!src || hex(src.familyId) !== hex(v.familyId))
        c11.problems.push(`${id}: restoredFromVersionId不在同一系列`);
      else if (canonical(src.content) !== canonical(v.content))
        c11.problems.push(`${id}: 恢复版本内容与来源版本不一致`);
    }
    try {
      const clean = libraryContent(v.content);
      if (!sameCore(clean, v.content as Question))
        c11.problems.push(`${id}: 内容规范化后核心字段发生变化`);
    } catch (e) {
      c11.problems.push(`${id}: 内容不是合法题目：${(e as Error).message}`);
    }
  }

  // 10. Survey question sources point at real, unchanged library versions
  const c12 = check(
    "sources",
    "问卷题目source指向存在的题目版本，系列匹配且核心内容一致，同卷不重复引用",
  );
  for (const { where, def } of definitions) {
    const seen = new Set<string>();
    for (const q of def?.questions ?? []) {
      if (!q.source) continue;
      c12.checked++;
      const v = itemById.get(q.source.versionId);
      if (seen.has(q.source.versionId))
        c12.problems.push(`${where}: 重复引用版本${q.source.versionId}`);
      seen.add(q.source.versionId);
      if (!v) c12.problems.push(`${where}: 题目${q.id}引用的版本不存在`);
      else if (hex(v.familyId) !== q.source.familyId)
        c12.problems.push(`${where}: 题目${q.id}的familyId与版本不符`);
      else if (!sameCore(q, v.content as Question))
        c12.problems.push(`${where}: 题目${q.id}的核心内容与题库版本不一致`);
    }
  }

  // 11. Optional: compare legacy collections with a backup taken before upgrade
  if (options.baselineDir) {
    const c13 = check(
      "baseline",
      `与升级前备份比对：发布快照逐字节不变，旧用户/问卷/答卷无缺失（${options.baselineDir}）`,
    );
    const c14 = check(
      "baseline_changes",
      "备份后被正常业务更新过的旧文档（填写、修改、关闭等，仅供核对）",
      "warning",
    );
    for (const name of LEGACY) {
      const file = resolve(options.baselineDir, `${name}.json`);
      if (!existsSync(file)) {
        c13.problems.push(`${name}: 备份文件不存在`);
        continue;
      }
      const rows = BSON.EJSON.parse(readFileSync(file, "utf8"), {
        relaxed: false,
      }) as Document[];
      for (const old of rows) {
        c13.checked++;
        const now = await db.collection(name).findOne({ _id: old._id });
        if (!now) {
          c13.problems.push(`${name} ${hex(old._id)}: 备份中的文档已缺失`);
          continue;
        }
        if (docHash(now) === docHash(old)) continue;
        if (name === "survey_versions")
          c13.problems.push(`${name} ${hex(old._id)}: 不可变发布快照被修改`);
        else c14.problems.push(`${name} ${hex(old._id)}: 内容与备份不同`);
      }
    }
  }

  const errors = checks
    .filter((c) => c.level === "error")
    .reduce((n, c) => n + c.problems.length, 0);
  const warnings = checks
    .filter((c) => c.level === "warning")
    .reduce((n, c) => n + c.problems.length, 0);
  return {
    database: db.databaseName,
    generatedAt: new Date().toISOString(),
    counts,
    checks,
    errors,
    warnings,
    ok: errors === 0,
  };
}

/** Newest backup folder under .local/backups whose manifest names this database. */
export function latestBackup(database: string, root = ".local/backups") {
  if (!existsSync(root)) return undefined;
  return readdirSync(root)
    .sort()
    .reverse()
    .map((d) => resolve(root, d))
    .find((dir) => {
      try {
        return (
          JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8"))
            .database === database
        );
      } catch {
        return false;
      }
    });
}
