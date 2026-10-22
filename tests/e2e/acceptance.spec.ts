import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { makeQuestion } from "../../database/seed.js";
import {
  emptyDefinition,
  type Question,
} from "../../packages/shared/src/domain.js";

const base = process.env.PLAYWRIGHT_TEST_ORIGIN ?? "http://127.0.0.1:3010";
let csrf = "";
let cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];
async function api(
  request: APIRequestContext,
  path: string,
  method = "GET",
  data?: unknown,
) {
  const response = await request.fetch(base + "/api/v1" + path, {
    method,
    data,
    headers: { Origin: base, "X-CSRF-Token": csrf },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function createSurvey(
  request: APIRequestContext,
  questions: Question[],
  publish = true,
) {
  const s = await api(request, "/surveys", "POST", {});
  const definition = emptyDefinition();
  definition.title = `验收回归_${randomUUID().slice(0, 8)}`;
  definition.questions = questions;
  const saved = await api(request, `/surveys/${s._id}/draft`, "PUT", {
    revision: 1,
    definition,
    deadlineAt: null,
  });
  if (publish)
    await api(request, `/surveys/${s._id}/publish`, "POST", {
      revision: saved.revision,
    });
  return s;
}
test.beforeAll(async ({ request }) => {
  const credentials = {
    username: `accept_${Date.now().toString(36)}`,
    password: "Acceptance-check-843!",
  };
  await api(request, "/auth/register", "POST", credentials);
  csrf = (await api(request, "/auth/login", "POST", credentials)).csrfToken;
  cookies = (await request.storageState()).cookies;
});
test.beforeEach(async ({ context }) => {
  await context.addCookies(cookies);
});

test("文本恰好2字符：输入表情不截断，超限可修正并提交", async ({
  page,
  context,
}) => {
  const q = makeQuestion("text", "两个字符", 1);
  q.validation = { minLength: 2, maxLength: 2 };
  const s = await createSurvey(context.request, [q]);
  await page.goto(`/survey/${s.publicId}`);
  await page.getByRole("button", { name: "开始填写", exact: true }).click();
  const input = page.getByLabel("两个字符", { exact: true });
  await input.focus();
  await page.keyboard.insertText("😀");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请输入 2～2 个字符");
  await input.focus();
  await page.keyboard.insertText("𠀀");
  await expect(input).toHaveValue("😀𠀀");
  await expect(
    page.getByText("已填写 2 / 2 个字符（不计首尾空白）"),
  ).toBeVisible();
  await page.keyboard.insertText("好");
  await expect(input).toHaveValue("😀𠀀好");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请输入 2～2 个字符");
  await input.fill(" 😀𠀀 ");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByText("已填写 2 / 2 个字符（不计首尾空白）"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  mkdirSync(".local/qa", { recursive: true });
  await page.screenshot({
    path: ".local/qa/unicode-length-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page).toHaveURL(/complete/);
  const responses = await api(context.request, `/surveys/${s._id}/responses`);
  expect(responses.items).toHaveLength(1);
  expect(responses.items[0].answers[0].value).toBe("😀𠀀");
});

for (const length of [1001, 2000]) {
  test(`${length}个表情可完整输入并提交，2001字符超限可修正`, async ({
    page,
    context,
  }) => {
    const q = makeQuestion("text", "长文本", 1);
    q.validation = { maxLength: 2000 };
    const s = await createSurvey(context.request, [q]);
    await page.goto(`/survey/${s.publicId}`);
    await page.getByRole("button", { name: "开始填写", exact: true }).click();
    const input = page.getByLabel("长文本", { exact: true });
    await input.focus();
    await page.keyboard.insertText("😀".repeat(2001));
    await expect(input).toHaveValue("😀".repeat(2001));
    await page.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(
      "请输入 0～2000 个字符",
    );
    await input.fill("");
    await page.keyboard.insertText("😀".repeat(length));
    await expect(input).toHaveValue("😀".repeat(length));
    await expect(
      page.getByText(`已填写 ${length} / 2000 个字符（不计首尾空白）`),
    ).toBeVisible();
    await page.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(page).toHaveURL(/complete/);
    const responses = await api(context.request, `/surveys/${s._id}/responses`);
    expect(responses.items[0].answers[0].value).toBe("😀".repeat(length));
  });
}

for (const anonymous of [false, true]) {
  test(`恢复${anonymous ? "匿名" : "实名"}草稿时页面与数据库身份一致`, async ({
    page,
    context,
  }) => {
    const s = await createSurvey(context.request, [
      makeQuestion("text", "你的回答", 1),
    ]);
    await page.goto(`/survey/${s.publicId}`);
    await page.getByLabel("以匿名方式提交").setChecked(anonymous);
    await page.getByRole("button", { name: "开始填写", exact: true }).click();
    await expect(page.getByLabel("你的回答")).toBeVisible();
    const attemptUrl = page.url();
    await page.getByRole("link", { name: "← 返回问卷简介" }).click();
    const choice = page.getByLabel("以匿名方式提交");
    await expect(choice).toBeDisabled();
    if (anonymous) await expect(choice).toBeChecked();
    else await expect(choice).not.toBeChecked();
    await expect(
      page.getByText(
        `继续填写将沿用这份草稿的${anonymous ? "匿名" : "实名"}设置。`,
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "继续填写", exact: true }).click();
    await expect(page).toHaveURL(attemptUrl);
    await page.getByLabel("你的回答").fill("身份设置应保持一致");
    await page.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(page).toHaveURL(/complete/);
    const responses = await api(context.request, `/surveys/${s._id}/responses`);
    expect(responses.items).toHaveLength(1);
    expect(responses.items[0].isAnonymous).toBe(anonymous);
    expect(responses.items[0].respondentId === null).toBe(anonymous);
    expect(responses.items[0].participantKey).toBeUndefined();
  });
}

for (const action of ["保存", "预览", "发布问卷"]) {
  test(`${action}等待期间的新编辑保留，必须再次保存后生效`, async ({
    page,
    context,
  }) => {
    const s = await createSurvey(
      context.request,
      [makeQuestion("text", "你的回答", 1)],
      false,
    );
    const editPath = `/surveys/${s._id}/edit`;
    await page.goto(editPath);
    await page.getByLabel("问卷标题", { exact: true }).fill("请求发出时的标题");
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let captured!: () => void;
    const ready = new Promise<void>((resolve) => {
      captured = resolve;
    });
    await page.route(`**/api/v1/surveys/${s._id}/draft`, async (route) => {
      const response = await route.fetch();
      captured();
      await paused;
      await route.fulfill({ response });
    });
    if (action === "发布问卷") page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: action, exact: true }).click();
    await ready;
    try {
      await page
        .getByLabel("问卷标题", { exact: true })
        .fill("等待期间新修改的标题");
      await page
        .getByLabel("题目标题", { exact: true })
        .fill("等待期间新修改的题目");
      await page
        .getByLabel("截止时间", { exact: true })
        .fill("2099-01-01T12:00");
    } finally {
      release();
    }
    await expect(page.getByRole("alert")).toContainText("新增修改尚未保存");
    await expect(
      page.getByText("有未保存的修改", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("问卷标题", { exact: true })).toHaveValue(
      "等待期间新修改的标题",
    );
    await expect(page).toHaveURL(base + editPath);
    expect((await api(context.request, `/surveys/${s._id}`)).status).toBe(
      "draft",
    );
    await page.unroute(`**/api/v1/surveys/${s._id}/draft`);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("问卷标题", { exact: true })).toHaveValue(
      "等待期间新修改的标题",
    );
    await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
      "等待期间新修改的题目",
    );
    await expect(page.getByLabel("截止时间", { exact: true })).toHaveValue(
      "2099-01-01T12:00",
    );
  });
}

test("上一题保存当前有效答案，刷新后仍可恢复", async ({ page, context }) => {
  const questions = [
    makeQuestion("text", "第一题", 1),
    makeQuestion("text", "第二题", 2),
  ];
  const s = await createSurvey(context.request, questions);
  await page.goto(`/survey/${s.publicId}`);
  await page.getByRole("button", { name: "开始填写", exact: true }).click();
  await page.getByLabel("第一题").fill("第一题答案");
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await page.getByLabel("第二题").fill("返回前题也应保存的答案");
  await page.getByRole("button", { name: "上一题", exact: true }).click();
  await expect(page.getByLabel("第一题")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await expect(page.getByLabel("第二题")).toHaveValue("返回前题也应保存的答案");
});

for (const type of ["text", "number", "multiple_choice"] as const) {
  test(`${type}未完成输入返回前题后仍能进入原题修正`, async ({
    page,
    context,
  }) => {
    const second = makeQuestion(type, "第二题", 2);
    if (type === "text") second.validation.minLength = 3;
    if (type === "multiple_choice") second.validation.minSelections = 2;
    const s = await createSurvey(context.request, [
      makeQuestion("text", "第一题", 1),
      second,
    ]);
    await page.goto(`/survey/${s.publicId}`);
    await page.getByRole("button", { name: "开始填写", exact: true }).click();
    await page.getByLabel("第一题").fill("第一题有效答案");
    await page.getByRole("button", { name: "保存并继续", exact: true }).click();
    if (type === "multiple_choice") await page.getByLabel("选项 A").check();
    else await page.getByLabel("第二题").fill(type === "text" ? "短" : "-1");
    await page.getByRole("button", { name: "上一题", exact: true }).click();
    await expect(page.getByLabel("第一题")).toBeVisible();
    await expect(page.getByText(/未完成输入暂留页面/)).toBeVisible();
    if (type === "text") {
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      mkdirSync(".local/qa", { recursive: true });
      await page.screenshot({
        path: ".local/qa/acceptance-unfinished-mobile.png",
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "保存并继续", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "第二题", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (type === "multiple_choice") {
      await expect(page.getByLabel("选项 A")).toBeChecked();
      await page.getByLabel("选项 B").check();
    } else {
      await expect(page.getByLabel("第二题")).toHaveValue(
        type === "text" ? "短" : "-1",
      );
      await page
        .getByLabel("第二题")
        .fill(type === "text" ? "修正后的合规答案" : "20");
    }
    await page.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(page).toHaveURL(/complete/);
    const stats = await api(context.request, `/surveys/${s._id}/stats`);
    expect(stats.totalSubmissions).toBe(1);
    expect(stats.questions[1].answeredCount).toBe(1);
  });
}

for (const editing of [false, true]) {
  test(`${editing ? "修改原答卷" : "首次提交"}响应丢失后用同一请求重试成功`, async ({
    page,
    context,
  }) => {
    const s = await createSurvey(context.request, [
      makeQuestion("text", "你的回答", 1),
    ]);
    await page.goto(`/survey/${s.publicId}`);
    await page.getByRole("button", { name: "开始填写", exact: true }).click();
    await page.getByLabel("你的回答").fill("首次答案");
    if (editing) {
      await page.getByRole("button", { name: "确认提交", exact: true }).click();
      await page
        .getByRole("button", { name: "修改我的答案", exact: true })
        .click();
      await page.getByLabel("你的回答").fill("修改后的答案");
    }
    const attemptId = page.url().split("/").at(-1)!;
    const payloads: unknown[] = [];
    let draftSaves = 0;
    page.on("request", (req) => {
      if (req.method() === "PUT" && req.url().endsWith("/answers"))
        draftSaves++;
    });
    await page.route("**/api/v1/attempts/*/submit", async (route) => {
      payloads.push(route.request().postDataJSON());
      if (payloads.length === 1) {
        const committed = await route.fetch();
        expect(committed.ok()).toBe(true);
        await route.abort("failed");
      } else if (!editing && payloads.length === 2) {
        await route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "RATE_LIMITED",
              message: "操作过于频繁，请稍后重试",
            },
          }),
        });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "重试提交", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("你的回答")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "上一题", exact: true }),
    ).toBeDisabled();
    // Retrying an already committed edit remains successful after collection closes.
    if (editing)
      await api(context.request, `/surveys/${s._id}/close`, "POST", {});
    await page.getByRole("button", { name: "重试提交", exact: true }).click();
    if (!editing) {
      await expect(page.getByRole("alert")).toContainText("操作过于频繁");
      await expect(page.getByLabel("你的回答")).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "重试提交", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "重试提交", exact: true }).click();
    }
    await expect(page).toHaveURL(
      `${base}/survey/${s.publicId}/complete/${attemptId}`,
    );
    expect(payloads).toHaveLength(editing ? 2 : 3);
    for (const payload of payloads) expect(payload).toEqual(payloads[0]);
    expect(draftSaves).toBe(0);
    const stats = await api(context.request, `/surveys/${s._id}/stats`);
    const record = await api(context.request, `/attempts/${attemptId}`);
    expect(stats.totalSubmissions).toBe(1);
    expect(stats.uniqueRespondents).toBe(1);
    expect(record.attempt.editCount).toBe(editing ? 1 : 0);
    expect(record.attempt.answers[0].value).toBe(
      editing ? "修改后的答案" : "首次答案",
    );
  });
}

test("保存响应丢失后核对服务器内容恢复进度，保存期间输入锁定", async ({
  page,
  context,
}) => {
  const s = await createSurvey(context.request, [
    makeQuestion("text", "第一题", 1),
    makeQuestion("text", "第二题", 2),
  ]);
  await page.goto(`/survey/${s.publicId}`);
  await page.getByRole("button", { name: "开始填写", exact: true }).click();
  await page.getByLabel("第一题").fill("需要恢复确认的答案");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const ready = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route("**/api/v1/attempts/*/answers", async (route) => {
    await route.fetch();
    captured();
    await held;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await ready;
  try {
    await expect(page.getByLabel("第一题")).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByLabel("第二题")).toBeVisible();
  await page.unroute("**/api/v1/attempts/*/answers");
  await page.getByLabel("第二题").fill("第二题答案");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page).toHaveURL(/complete/);
});
