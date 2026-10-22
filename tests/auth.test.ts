import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { MongoClient, ObjectId } from "mongodb";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import {
  passwordIssues,
  passwordRequirements,
} from "../packages/shared/src/auth.js";
import { connectDatabase, type Database } from "../apps/server/src/database.js";
import { createApp } from "../apps/server/src/app.js";
import { config } from "../apps/server/src/config.js";
import { initializeDatabase } from "../database/schema.js";

describe("注册密码的共享规则", () => {
  it.each([
    ["abc12345", ["PASSWORD_UPPERCASE_REQUIRED"]],
    ["ABC12345", ["PASSWORD_LOWERCASE_REQUIRED"]],
    ["Abcdefgh", ["PASSWORD_DIGIT_REQUIRED"]],
    ["Ab1", ["PASSWORD_TOO_SHORT"]],
    ["abcdefgh", ["PASSWORD_UPPERCASE_REQUIRED", "PASSWORD_DIGIT_REQUIRED"]],
    [
      "12345678",
      ["PASSWORD_UPPERCASE_REQUIRED", "PASSWORD_LOWERCASE_REQUIRED"],
    ],
    [
      "",
      [
        "PASSWORD_TOO_SHORT",
        "PASSWORD_UPPERCASE_REQUIRED",
        "PASSWORD_LOWERCASE_REQUIRED",
        "PASSWORD_DIGIT_REQUIRED",
      ],
    ],
    ["Valid123", []],
    [" Valid1 ", []],
  ])("密码 %j 只提示实际缺少项", (password, expected) => {
    expect(
      passwordIssues(password as string).map((issue) => issue.code),
    ).toEqual(expected);
  });
  it("拒绝超过128字符，但允许128字符边界", () => {
    expect(passwordIssues("Ab1" + "x".repeat(125))).toEqual([]);
    expect(passwordIssues("Ab1" + "x".repeat(126)).map((x) => x.code)).toEqual([
      "PASSWORD_TOO_LONG",
    ]);
  });
  it("前端逐项提示与后端校验共享同一判断", () => {
    expect(
      passwordRequirements("abc12345")
        .filter((r) => !r.met)
        .map((r) => r.id),
    ).toEqual(["uppercase"]);
  });
});

describe("登录先检查用户名，注册强制密码规则", () => {
  const origin = "http://localhost:3000";
  let d: Database, app: ReturnType<typeof createApp>;
  const username = `auth_${randomUUID().slice(0, 8)}`;
  const strong = "Valid-password-843!";
  const post = (path: string, body: object) =>
    request(app).post(`/api/v1/auth/${path}`).set("Origin", origin).send(body);
  beforeAll(async () => {
    const uri =
      process.env.MONGODB_TEST_URI ??
      "mongodb://127.0.0.1:27018/questionnaire_test?replicaSet=survey-rs";
    if (new MongoClient(uri).db().databaseName !== "questionnaire_test")
      throw new Error("拒绝操作非测试数据库");
    d = await connectDatabase(uri);
    await initializeDatabase(d.db);
    app = createApp(d, {
      ...config(),
      uri,
      origins: [origin],
      publicBaseUrl: origin,
    });
  });
  afterAll(async () => {
    await d?.client.close();
  });
  it("用户名不存在时即使密码较短也先提示创建账号", async () => {
    const r = await post("login", { username, password: "1" });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatchObject({
      code: "USER_NOT_FOUND",
      message: "该用户名尚未注册，请先创建账号",
    });
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
  it.each([
    ["abc12345", ["PASSWORD_UPPERCASE_REQUIRED"]],
    ["ABC12345", ["PASSWORD_LOWERCASE_REQUIRED"]],
    ["Abcdefgh", ["PASSWORD_DIGIT_REQUIRED"]],
    ["Ab1", ["PASSWORD_TOO_SHORT"]],
    ["abcdefgh", ["PASSWORD_UPPERCASE_REQUIRED", "PASSWORD_DIGIT_REQUIRED"]],
  ])("直接调用注册接口也拒绝不符合规则的密码 %s", async (password, codes) => {
    const name = `weak_${randomUUID().slice(0, 8)}`;
    const r = await post("register", { username: name, password });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("PASSWORD_INVALID");
    expect(
      r.body.error.fieldErrors.map((e: { code: string }) => e.code),
    ).toEqual(codes);
    expect(await d.users.findOne({ usernameNormalized: name })).toBeNull();
    expect(JSON.stringify(r.body)).not.toContain(password);
  });
  it("合规密码可注册，用户名不区分大小写，错误密码单独提示", async () => {
    await post("register", { username, password: strong }).expect(201);
    const duplicate = await post("register", {
      username: username.toUpperCase(),
      password: strong,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("USERNAME_TAKEN");
    const bad = await post("login", { username, password: "x" });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatchObject({
      code: "PASSWORD_INCORRECT",
      message: "密码错误，请重新输入",
    });
    const good = await post("login", {
      username: username.toUpperCase(),
      password: strong,
    });
    expect(good.status).toBe(200);
    expect(good.headers["set-cookie"]).toBeDefined();
  });
  it("旧账号密码仍可登录，不用注册新规则锁住已有账号", async () => {
    const name = `legacy_${randomUUID().slice(0, 8)}`;
    await d.users.insertOne({
      _id: new ObjectId(),
      schemaVersion: 1,
      username: name,
      usernameNormalized: name,
      passwordHash: await argon2.hash("oldpass1", { type: argon2.argon2id }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(
      (await post("login", { username: name, password: "oldpass1" })).status,
    ).toBe(200);
  });
});
