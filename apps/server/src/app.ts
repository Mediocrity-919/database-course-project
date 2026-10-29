import express, { type RequestHandler } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { ObjectId, MongoServerError } from "mongodb";
import argon2 from "argon2";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z, ZodError } from "zod";
import {
  answerSchema,
  DomainError,
  validateDefinition,
} from "../../../packages/shared/src/domain.js";
import type { Config } from "./config.js";
import type { Database } from "./database.js";
import { hash, objectId, publicSurvey, SurveyService } from "./service.js";
import { passwordIssues } from "../../../packages/shared/src/auth.js";
import { LibraryService, pageSchema, scopeSchema } from "./library.js";

const revisionSchema = z.object({ revision: z.number().int().positive() });
export function createApp(d: Database, cfg: Config) {
  const app = express(),
    service = new SurveyService(d, cfg);
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", ...cfg.origins],
          upgradeInsecureRequests: cfg.secure ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "2mb" }), cookieParser());
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && cfg.origins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      if (!origin || !cfg.origins.includes(origin))
        return res.status(403).end();
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-CSRF-Token",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      );
      return res.sendStatus(204);
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (!origin || !cfg.origins.includes(origin) || !req.is("application/json"))
    )
      return next(
        new DomainError("ORIGIN_INVALID", "请求来源或内容类型不允许", 403),
      );
    next();
  });
  const auth: RequestHandler = async (req, res, next) => {
    const token = req.cookies?.survey_session;
    const session =
      typeof token === "string"
        ? await d.sessions.findOne({
            tokenHash: hash(token),
            expiresAt: { $gt: new Date() },
          })
        : null;
    if (!session) throw new DomainError("LOGIN_REQUIRED", "请先登录", 401);
    const user = await d.users.findOne(
      { _id: session.userId },
      { projection: { passwordHash: 0 } },
    );
    if (!user) throw new DomainError("LOGIN_REQUIRED", "账号不存在", 401);
    res.locals.user = user;
    res.locals.session = session;
    if (!["GET", "HEAD"].includes(req.method)) {
      const csrf = Buffer.from(req.get("X-CSRF-Token") ?? ""),
        expected = Buffer.from(session.csrfToken);
      if (csrf.length !== expected.length || !timingSafeEqual(csrf, expected))
        throw new DomainError("CSRF_INVALID", "会话校验失败，请刷新页面", 403);
    }
    next();
  };
  const limits = rateLimit({
    windowMs: 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: { code: "RATE_LIMITED", message: "操作过于频繁，请稍后重试" },
    },
  });
  const credentialsSchema = z
    .object({
      username: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_]{3,32}$/, "用户名须为3～32位字母、数字或下划线"),
      password: z.string().max(1024, "密码输入过长"),
    })
    .strict();
  const api = express.Router();
  const library = new LibraryService(d);
  api.get("/question-banks", auth, async (_req, res) =>
    res.json({
      items: await library.banks
        .find({ ownerId: res.locals.user._id })
        .sort({ updatedAt: -1 })
        .toArray(),
    }),
  );
  api.post("/question-banks", auth, async (req, res) =>
    res.status(201).json(await library.saveBank(res.locals.user._id, req.body)),
  );
  api.put("/question-banks/:id", auth, async (req, res) =>
    res.json(
      await library.saveBank(
        res.locals.user._id,
        req.body,
        String(req.params.id),
      ),
    ),
  );
  api.get("/library/questions", auth, async (req, res) =>
    res.json(
      await library.list(
        res.locals.user._id,
        pageSchema.parse(req.query.page),
        req.query.bankId ? String(req.query.bankId) : undefined,
      ),
    ),
  );
  api.post("/library/questions", auth, async (req, res) =>
    res.status(201).json(await library.create(res.locals.user._id, req.body)),
  );
  api.get("/library/questions/:id", auth, async (req, res) =>
    res.json(
      await library.detail(
        String(req.params.id),
        res.locals.user._id,
        pageSchema.parse(req.query.page),
      ),
    ),
  );
  api.put("/library/questions/:id/access", auth, async (req, res) =>
    res.json(
      await library.configure(
        String(req.params.id),
        res.locals.user._id,
        req.body,
      ),
    ),
  );
  api.get("/library/versions/:id", auth, async (req, res) =>
    res.json(
      await library
        .version(String(req.params.id), res.locals.user._id)
        .then((x) => ({ version: x.version })),
    ),
  );
  api.post("/library/versions/:id/derive", auth, async (req, res) =>
    res
      .status(201)
      .json(
        await library.newVersion(
          String(req.params.id),
          res.locals.user._id,
          req.body,
        ),
      ),
  );
  api.post("/library/versions/:id/import", auth, async (req, res) =>
    res.json(
      await library.importVersion(String(req.params.id), res.locals.user._id),
    ),
  );
  api.get("/library/versions/:id/usage", auth, async (req, res) =>
    res.json(
      await library.usage(
        String(req.params.id),
        res.locals.user._id,
        scopeSchema.parse(req.query.scope),
      ),
    ),
  );
  api.get("/library/versions/:id/stats", auth, async (req, res) =>
    res.json(
      await library.stats(
        String(req.params.id),
        res.locals.user._id,
        pageSchema.parse(req.query.page),
        scopeSchema.parse(req.query.scope),
      ),
    ),
  );
  api.get("/health", async (_req, res) => {
    await d.db.command({ ping: 1 });
    res.json({ status: "ok" });
  });
  api.post("/auth/register", limits, async (req, res) => {
    const input = credentialsSchema.parse(req.body),
      now = new Date();
    if (
      await d.users.findOne(
        { usernameNormalized: input.username.toLowerCase() },
        { projection: { _id: 1 } },
      )
    )
      throw new DomainError("USERNAME_TAKEN", "用户名已被使用", 409);
    const issues = passwordIssues(input.password);
    if (issues.length)
      throw new DomainError(
        "PASSWORD_INVALID",
        issues.map((issue) => issue.message).join("；"),
        422,
        issues,
      );
    await d.users.insertOne({
      _id: new ObjectId(),
      schemaVersion: 1,
      username: input.username,
      usernameNormalized: input.username.toLowerCase(),
      passwordHash: await argon2.hash(input.password, {
        type: argon2.argon2id,
      }),
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ message: "注册成功，请登录" });
  });
  api.post("/auth/login", limits, async (req, res) => {
    const input = credentialsSchema.parse(req.body),
      user = await d.users.findOne({
        usernameNormalized: input.username.toLowerCase(),
      });
    if (!user)
      throw new DomainError(
        "USER_NOT_FOUND",
        "该用户名尚未注册，请先创建账号",
        404,
      );
    if (!(await argon2.verify(user.passwordHash, input.password)))
      throw new DomainError("PASSWORD_INCORRECT", "密码错误，请重新输入", 401);
    const token = randomBytes(32).toString("base64url"),
      csrfToken = randomBytes(32).toString("hex"),
      now = new Date();
    await d.sessions.insertOne({
      _id: new ObjectId(),
      schemaVersion: 1,
      userId: user._id,
      tokenHash: hash(token),
      csrfToken,
      createdAt: now,
      expiresAt: new Date(now.getTime() + cfg.sessionHours * 3600_000),
    });
    res.cookie("survey_session", token, {
      httpOnly: true,
      secure: cfg.secure,
      sameSite: "lax",
      path: "/",
      maxAge: cfg.sessionHours * 3600_000,
    });
    res.json({ user: { id: user._id, username: user.username }, csrfToken });
  });
  api.get("/auth/me", auth, (_req, res) =>
    res.json({
      user: { id: res.locals.user._id, username: res.locals.user.username },
      csrfToken: res.locals.session.csrfToken,
    }),
  );
  api.post("/auth/logout", auth, async (_req, res) => {
    await d.sessions.deleteOne({ _id: res.locals.session._id });
    res.clearCookie("survey_session", {
      path: "/",
      secure: cfg.secure,
      sameSite: "lax",
    });
    res.json({ message: "已退出登录" });
  });
  api.get("/surveys", auth, async (req, res) =>
    res.json(
      await service.list(
        res.locals.user._id,
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      ),
    ),
  );
  api.post("/surveys", auth, async (_req, res) =>
    res.status(201).json(await service.create(res.locals.user._id)),
  );
  api.get("/surveys/:id", auth, async (req, res) =>
    res.json(await service.detail(String(req.params.id), res.locals.user._id)),
  );
  api.put("/surveys/:id/draft", auth, async (req, res) => {
    const { revision } = revisionSchema.parse(req.body);
    res.json(
      await service.save(
        String(req.params.id),
        res.locals.user._id,
        revision,
        req.body.definition,
        req.body.deadlineAt,
      ),
    );
  });
  api.delete("/surveys/:id", auth, async (req, res) => {
    const s = await service.owned(String(req.params.id), res.locals.user._id);
    if (s.status !== "draft")
      throw new DomainError(
        "PUBLISHED_LOCKED",
        "已发布问卷请使用关闭功能",
        409,
      );
    const deleted = await d.surveys.deleteOne({
      _id: s._id,
      ownerId: s.ownerId,
      status: "draft",
      revision: s.revision,
    });
    if (!deleted.deletedCount)
      throw new DomainError(
        "REVISION_CONFLICT",
        "草稿状态已更新，请刷新后重试",
        409,
      );
    res.json({ message: "草稿已删除" });
  });
  api.post("/surveys/:id/publish", auth, async (req, res) =>
    res.json(
      await service.publish(
        String(req.params.id),
        res.locals.user._id,
        revisionSchema.parse(req.body).revision,
      ),
    ),
  );
  api.post("/surveys/:id/close", auth, async (req, res) =>
    res.json(await service.close(String(req.params.id), res.locals.user._id)),
  );
  api.patch("/surveys/:id/deadline", auth, async (req, res) =>
    res.json(
      await service.deadline(
        String(req.params.id),
        res.locals.user._id,
        req.body.deadlineAt,
      ),
    ),
  );
  api.post("/surveys/:id/copy", auth, async (req, res) => {
    const original = await service.detail(
        String(req.params.id),
        res.locals.user._id,
      ),
      def = structuredClone(original.definition);
    const ids = new Map<string, string>();
    for (const q of def.questions) ids.set(q.id, randomUUID());
    for (const q of def.questions) {
      // Option IDs are scoped to a question. A detached copy can still have the
      // same IDs as a library instance; never let its remapping change that instance.
      const options = new Map(
        (q.options ?? []).map((o) => [o.id, q.source ? o.id : randomUUID()]),
      );
      q.id = ids.get(q.id)!;
      for (const o of q.options ?? []) o.id = options.get(o.id)!;
      for (const r of q.logic.rules) {
        r.id = randomUUID();
        if (typeof r.when.value === "string")
          r.when.value = options.get(r.when.value)!;
        if (Array.isArray(r.when.value))
          r.when.value = r.when.value.map((x) => options.get(x)!);
        if (r.then.targetQuestionId)
          r.then.targetQuestionId = ids.get(r.then.targetQuestionId);
      }
      if (q.logic.defaultAction.targetQuestionId)
        q.logic.defaultAction.targetQuestionId = ids.get(
          q.logic.defaultAction.targetQuestionId,
        );
    }
    def.title = `${def.title.slice(0, 90)}（副本）`;
    res
      .status(201)
      .json(await service.create(res.locals.user._id, validateDefinition(def)));
  });
  api.get("/surveys/:id/share", auth, async (req, res) => {
    const s = await service.owned(String(req.params.id), res.locals.user._id);
    res.json({
      ...publicSurvey(s),
      url: `${cfg.publicBaseUrl}/survey/${s.publicId}`,
    });
  });
  api.get("/public/surveys/:publicId", async (req, res) => {
    const s = await service.byPublic(String(req.params.publicId)),
      v = await service.version(s);
    res.json({
      ...publicSurvey(s),
      description: v.definition.description,
      settings: v.definition.settings,
      questionCount: v.definition.questions.length,
    });
  });
  api.get("/public/surveys/:publicId/my-attempts", auth, async (req, res) =>
    res.json(
      await service.myAttempts(
        String(req.params.publicId),
        res.locals.user._id,
      ),
    ),
  );
  const attemptLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    legacyHeaders: false,
    standardHeaders: "draft-8",
  });
  api.post(
    "/public/surveys/:publicId/attempts",
    auth,
    attemptLimiter,
    async (req, res) => {
      const x = z
        .object({
          clientAttemptId: z.string().uuid(),
          isAnonymous: z.boolean(),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json(
          await service.start(
            String(req.params.publicId),
            res.locals.user._id,
            x.clientAttemptId,
            x.isAnonymous,
          ),
        );
    },
  );
  api.get("/attempts/:id", auth, async (req, res) =>
    res.json(
      await service.readAttempt(String(req.params.id), res.locals.user._id),
    ),
  );
  api.post("/attempts/:id/edit", auth, async (req, res) =>
    res.json(
      await service.beginEdit(
        String(req.params.id),
        res.locals.user._id,
        revisionSchema.parse(req.body).revision,
      ),
    ),
  );
  api.put("/attempts/:id/answers", auth, async (req, res) =>
    res.json(
      await service.saveAnswers(
        String(req.params.id),
        res.locals.user._id,
        revisionSchema.parse(req.body).revision,
        answerSchema.parse(req.body.answers),
      ),
    ),
  );
  api.post("/attempts/:id/submit", auth, attemptLimiter, async (req, res) => {
    const body = z
      .object({
        revision: z.number().int().positive(),
        answers: answerSchema,
        submissionId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    res.json(
      await service.submit(
        String(req.params.id),
        res.locals.user._id,
        body.revision,
        body.answers,
        body.submissionId,
      ),
    );
  });
  api.get("/surveys/:id/stats", auth, async (req, res) =>
    res.json(
      await service.statistics(
        String(req.params.id),
        res.locals.user._id,
        typeof req.query.versionId === "string"
          ? req.query.versionId
          : undefined,
      ),
    ),
  );
  api.get("/surveys/:id/questions/:qid/stats", auth, async (req, res) => {
    const stats = await service.statistics(
      String(req.params.id),
      res.locals.user._id,
    );
    const q = stats.questions.find((q) => q.id === req.params.qid);
    if (!q) throw new DomainError("NOT_FOUND", "题目不存在", 404);
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page ?? 1);
    res.json({
      ...q,
      ...(await service.values(
        String(req.params.id),
        res.locals.user._id,
        String(req.params.qid),
        page,
      )),
    });
  });
  api.get("/surveys/:id/responses", auth, async (req, res) => {
    const s = await service.owned(String(req.params.id), res.locals.user._id);
    const before =
      typeof req.query.cursor === "string"
        ? { _id: { $lt: objectId(req.query.cursor) } }
        : {};
    const rows = await d.responses
      .find(
        { surveyId: s._id, status: "submitted", ...before },
        {
          projection: {
            participantKey: 0,
            clientAttemptId: 0,
            submissionHash: 0,
            lastSubmissionId: 0,
            editDraft: 0,
          },
        },
      )
      .sort({ _id: -1 })
      .limit(21)
      .toArray();
    const more = rows.length > 20;
    rows.splice(20);
    res.json({ items: rows, nextCursor: more ? rows.at(-1)?._id : null });
  });
  app.use("/api/v1", api);
  app.use("/api", (_req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "接口不存在" } }),
  );
  const staticRoot = resolve("apps/web/dist");
  if (existsSync(staticRoot)) {
    app.use(express.static(staticRoot));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(staticRoot, "index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof DomainError)
        return res.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            fieldErrors: error.fieldErrors,
          },
        });
      if (error instanceof ZodError)
        return res.status(422).json({
          error: {
            code: "INPUT_INVALID",
            message: error.issues.map((x) => x.message).join("；"),
          },
        });
      if (error instanceof MongoServerError && error.code === 11000)
        return res.status(409).json({
          error: {
            code: error.keyPattern?.usernameNormalized
              ? "USERNAME_TAKEN"
              : "ALREADY_SUBMITTED",
            message: error.keyPattern?.usernameNormalized
              ? "用户名已被使用"
              : "你已提交过此问卷，请修改原答卷",
          },
        });
      if ((error as { type?: string }).type === "entity.too.large")
        return res
          .status(413)
          .json({ error: { code: "TOO_LARGE", message: "请求体过大" } });
      if (error instanceof SyntaxError)
        return res
          .status(400)
          .json({ error: { code: "INVALID_JSON", message: "JSON 格式错误" } });
      console.error(
        "API error:",
        error instanceof Error ? error.message : "unknown",
      );
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "服务暂时不可用，请稍后重试",
        },
      });
    },
  );
  return app;
}
