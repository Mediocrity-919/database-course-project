import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function register(page: Page, prefix: string) {
  const username = `${prefix}_${Date.now().toString(36)}`;
  await page.goto("/register");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("Library-check-438!");
  await page.getByRole("button", { name: "注册并进入工作台" }).click();
  await expect(page).toHaveURL(/dashboard/);
  return username;
}
async function call(page: Page, path: string, body?: object, method = "POST") {
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const res = await page.request.fetch("/api/v1" + path, {
    method: body ? method : "GET",
    data: body,
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": me.csrfToken,
    },
  });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}
async function newItem(page: Page, title: string, type = "number") {
  await page.goto("/library");
  await page.getByRole("button", { name: "新建常用题", exact: true }).click();
  await page.getByLabel("常用题类型").selectOption(type);
  await page.getByLabel("常用题标题").fill(title);
  await page.getByRole("button", { name: "保存题目版本" }).click();
  await expect(
    page.getByRole("heading", { name: `v1 · ${title}`, exact: true }),
  ).toBeVisible();
}
async function pick(page: Page, title: string, n = 1, replace = false) {
  const label = replace ? "替换为题库中的版本" : "从题库选题";
  await page.getByRole("button", { name: label, exact: true }).click();
  const picker = page
    .locator(".library-picker")
    .filter({ has: page.getByRole("button", { name: label, exact: true }) });
  await picker
    .locator(".library-picker-content")
    .getByRole("button", { name: new RegExp(title + " · v") })
    .click();
  if (replace) page.once("dialog", (d) => d.accept());
  await picker
    .getByRole("button", { name: new RegExp(`^使用 v${n}：`) })
    .click();
}
test("题库完整流程：归属、复用两卷、跨卷统计、新旧版本、派生与恢复", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page, "libflow");
  await page.getByRole("link", { name: "我的题库", exact: true }).click();
  await page.getByLabel("题库名称", { exact: true }).fill("基础属性");
  await page.getByRole("button", { name: "创建题库", exact: true }).click();
  await expect(page.getByText("题库已创建", { exact: true })).toBeVisible();
  await page
    .getByLabel("选择题库", { exact: true })
    .selectOption({ label: "基础属性" });
  await page.getByLabel("题库名称", { exact: true }).fill("人口资料");
  await page.getByRole("button", { name: "保存题库名称和说明" }).click();
  await expect(
    page.getByRole("option", { name: "人口资料", exact: true }),
  ).toHaveCount(1);
  await newItem(page, "年龄（周岁）");
  await page.getByLabel("人口资料", { exact: true }).check();
  await page.getByRole("button", { name: "保存共享与归属" }).click();
  await expect(page.getByLabel("人口资料", { exact: true })).toBeChecked();
  await page
    .getByLabel("选择题库", { exact: true })
    .selectOption({ label: "人口资料" });
  await expect(page.locator(".library-card")).toHaveCount(1);
  for (const age of [20, 40]) {
    await page.goto("/new");
    await page.getByLabel("问卷标题", { exact: true }).fill(`年龄调查${age}`);
    await pick(page, "年龄（周岁）");
    await expect(page.getByLabel("题目标题", { exact: true })).toBeDisabled();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "发布问卷", exact: true }).click();
    const url = await page.getByLabel("问卷链接").inputValue();
    await page.goto(url);
    await page.getByRole("button", { name: "开始填写", exact: true }).click();
    await page.getByLabel("年龄（周岁）", { exact: true }).fill(String(age));
    await page.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "回答已收到，谢谢你。" }),
    ).toBeVisible();
  }
  await page.goto("/library");
  await page
    .locator(".library-card")
    .filter({ hasText: "年龄（周岁）" })
    .click();
  await expect(page.getByText("有效回答 2 份", { exact: true })).toBeVisible();
  await expect(page.getByText(/平均值 30/)).toBeVisible();
  await expect(
    page
      .locator(".library-statistics")
      .getByRole("link", { name: "年龄调查20" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "基于 v1 创建新版本", exact: true })
    .click();
  await page.getByLabel("常用题标题").fill("年龄（新版）");
  await page.getByRole("button", { name: "保存题目版本" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "v2 · 年龄（新版）" }),
  ).toBeVisible();
  await expect(page.getByText("有效回答 0 份", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "基于 v1 创建新版本", exact: true })
    .click();
  await page.getByLabel("常用题标题").fill("年龄（另一分支）");
  await page.getByRole("button", { name: "保存题目版本" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "v3 · 年龄（另一分支）" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "恢复 v1", exact: true }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "v4 · 年龄（周岁）" }),
  ).toBeVisible();
  await page
    .locator(".library-history")
    .filter({
      has: page.getByRole("heading", {
        name: "v1 · 年龄（周岁）",
        exact: true,
      }),
    })
    .getByRole("button", { name: "查看使用与统计" })
    .click();
  await expect(page.getByText("有效回答 2 份", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "全部版本合计", exact: true }).click();
  await expect(
    page.getByText("v1：2 份 · 年龄（周岁）", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("v2：0 份 · 年龄（新版）", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("有效回答 2 份", { exact: true })).toBeVisible();
  await expect(page.getByText(/平均值 30/)).toBeVisible();
  mkdirSync(".local/qa", { recursive: true });
  await page.screenshot({
    path: ".local/qa/stage2-library-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("手机HTTP题库选项、替换版本、解除关联和保存刷新", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page, "libmobile");
  await page
    .getByRole("navigation", { name: "手机导航" })
    .getByRole("link", { name: "我的题库" })
    .click();
  await page.getByRole("button", { name: "新建常用题", exact: true }).click();
  await page.getByLabel("常用题类型").selectOption("single_choice");
  await page.getByLabel("常用题标题").fill("午餐偏好");
  await page.getByLabel("选项 1", { exact: true }).click();
  await page.keyboard.insertText("米饭");
  await expect(page.getByLabel("选项 1", { exact: true })).toHaveValue("米饭");
  await page.getByLabel("选项 2", { exact: true }).fill("面条");
  await page.getByRole("button", { name: "保存题目版本" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "v1 · 午餐偏好" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "基于 v1 创建新版本", exact: true })
    .click();
  await page.getByLabel("常用题标题").fill("午餐新版");
  await page.getByRole("button", { name: "保存题目版本" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "v2 · 午餐新版" }),
  ).toBeVisible();
  await page.goto("/new");
  await page.getByLabel("问卷标题", { exact: true }).fill("手机题库问卷");
  await pick(page, "午餐新版", 1);
  await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
    "午餐偏好",
  );
  await pick(page, "午餐新版", 2, true);
  await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
    "午餐新版",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "解除关联并编辑副本" }).click();
  await expect(page.getByLabel("题目标题", { exact: true })).toBeEnabled();
  await page.getByLabel("题目标题", { exact: true }).fill("本问卷独立题");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
    "本问卷独立题",
  );
  const id = page.url().match(/surveys\/([^/]+)/)![1],
    detail = await call(page, `/surveys/${id}`);
  expect(detail.definition.questions[0].source).toBeUndefined();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".local/qa/stage2-editor-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("共享题目的双方使用、接收方只读及另存副本", async ({
  page,
  browser,
  baseURL,
}) => {
  await register(page, "libshare");
  await newItem(page, "共享学习小时");
  const second = await browser.newContext({ baseURL }),
    recipient = await second.newPage();
  try {
    const name = await register(recipient, "libreceiver");
    await page.getByLabel("共享给这些用户名（逗号分隔）").fill(name);
    await page.getByRole("button", { name: "保存共享与归属" }).click();
    await expect(
      page.getByRole("button", { name: "保存共享与归属" }),
    ).toBeEnabled();
    await recipient.goto("/library");
    await recipient
      .locator(".library-card")
      .filter({ hasText: "共享学习小时" })
      .click();
    await expect(
      recipient.getByRole("button", { name: "基于 v1 创建新版本" }),
    ).toHaveCount(0);
    await expect(
      recipient.getByRole("button", { name: "另存为我的题目", exact: true }),
    ).toBeVisible();
    await recipient.goto("/new");
    await recipient
      .getByLabel("问卷标题", { exact: true })
      .fill("接收方引用问卷");
    await pick(recipient, "共享学习小时");
    await recipient.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      recipient.getByText("草稿已保存", { exact: true }),
    ).toBeVisible();
    await page.goto("/new");
    await pick(page, "共享学习小时");
    await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
      "共享学习小时",
    );
    await recipient.goto("/library");
    await recipient
      .locator(".library-card")
      .filter({ hasText: "共享学习小时" })
      .click();
    await recipient
      .getByRole("button", { name: "另存为我的题目", exact: true })
      .click();
    await recipient.getByLabel("常用题标题").fill("我的独立小时题");
    await recipient.getByRole("button", { name: "保存题目版本" }).click();
    await expect(
      recipient.getByRole("heading", {
        exact: true,
        name: "v1 · 我的独立小时题",
      }),
    ).toBeVisible();
    await expect(
      recipient.getByRole("button", { name: "基于 v1 创建新版本" }),
    ).toBeVisible();
  } finally {
    await second.close();
  }
});

test("编辑器内修改题库题：选择生成新版本并替换，原版本保持", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await register(page, "libedit");
  await newItem(page, "睡眠时长");
  await page.goto("/new");
  await page.getByLabel("问卷标题", { exact: true }).fill("睡眠调查");
  await pick(page, "睡眠时长");
  await page
    .getByRole("button", { name: "修改内容并保存为题库新版本", exact: true })
    .click();
  await page.getByLabel("常用题标题").fill("睡眠时长（小时）");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "保存为新版本并替换", exact: true })
    .click();
  await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
    "睡眠时长（小时）",
  );
  await expect(page.getByLabel("题目标题", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  const id = page.url().match(/surveys\/([^/]+)/)![1],
    detail = await call(page, `/surveys/${id}`),
    source = detail.definition.questions[0].source;
  const family = await call(page, `/library/questions/${source.familyId}`);
  expect(family.family.versionCount).toBe(2);
  expect(family.versions.map((v: any) => v.content.title)).toEqual([
    "睡眠时长（小时）",
    "睡眠时长",
  ]);
  expect(source.versionId).toBe(family.versions[0]._id);
  expect(family.versions[0].parentVersionId).toBe(family.versions[1]._id);
  expect(errors).toEqual([]);
});

async function pauseRequest(page: Page, url: string) {
  let arrived = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(url, async (route) => {
    arrived = true;
    await pending;
    await route.continue();
  });
  return { release, wait: () => expect.poll(() => arrived).toBe(true) };
}

for (const remove of [false, true]) {
  test(`生成题库新版本期间${remove ? "删除原题不会恢复原题" : "修改标题、增加题目和排序均保留"}`, async ({
    page,
  }) => {
    await register(page, remove ? "libremove" : "librace");
    await newItem(page, "等待期间的原题");
    await page.goto("/new");
    await page.getByLabel("问卷标题", { exact: true }).fill("原始标题");
    await pick(page, "等待期间的原题");
    await page
      .getByRole("button", { name: "修改内容并保存为题库新版本", exact: true })
      .click();
    await page.getByLabel("常用题标题").fill("等待结束后的新版题");
    const paused = await pauseRequest(
      page,
      "**/api/v1/library/versions/*/derive",
    );
    try {
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "保存为新版本并替换", exact: true })
        .click();
      await paused.wait();
      await page
        .getByLabel("问卷标题", { exact: true })
        .fill("保存期间的新标题");
      if (remove)
        await page
          .getByRole("button", { name: "删除题目", exact: true })
          .click();
      await page
        .locator(".add-question")
        .getByRole("button", { name: "数字填空" })
        .click();
      await page
        .getByLabel("题目标题", { exact: true })
        .fill("等待时增加的题目");
      if (!remove)
        await page.getByRole("button", { name: "上移", exact: true }).click();
    } finally {
      paused.release();
    }
    if (remove) {
      await expect(
        page.getByText(
          "原题已删除或替换，本次未修改问卷；已创建的版本仍可在题库中选择。",
          { exact: true },
        ),
      ).toBeVisible();
    } else {
      await expect(
        page.getByText("已生成题库 v2 并替换本题，请保存问卷", { exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByLabel("问卷标题", { exact: true })).toHaveValue(
      "保存期间的新标题",
    );
    await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
      "等待时增加的题目",
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
    await page.reload();
    const id = page.url().match(/surveys\/([^/]+)/)![1];
    const detail = await call(page, `/surveys/${id}`);
    expect(detail.definition.title).toBe("保存期间的新标题");
    expect(
      detail.definition.questions.map((q: any) => [q.title, q.order]),
    ).toEqual(
      remove
        ? [["等待时增加的题目", 1]]
        : [
            ["等待时增加的题目", 1],
            ["等待结束后的新版题", 2],
          ],
    );
  });
}

test("题库导入等待期间保留新标题和新增题目", async ({ page }) => {
  await register(page, "libimport");
  await newItem(page, "延迟导入题");
  await page.goto("/new");
  const paused = await pauseRequest(
    page,
    "**/api/v1/library/versions/*/import",
  );
  try {
    await pick(page, "延迟导入题");
    await paused.wait();
    await page.getByLabel("问卷标题", { exact: true }).fill("导入期间的新标题");
    await page
      .locator(".add-question")
      .getByRole("button", { name: "文本填空" })
      .click();
    await page.getByLabel("题目标题", { exact: true }).fill("导入期间新增题");
  } finally {
    paused.release();
  }
  await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
    "延迟导入题",
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  const id = page.url().match(/surveys\/([^/]+)/)![1];
  const detail = await call(page, `/surveys/${id}`);
  expect(detail.definition.title).toBe("导入期间的新标题");
  expect(detail.definition.questions.map((q: any) => q.title)).toEqual([
    "导入期间新增题",
    "延迟导入题",
  ]);
});
