import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PNG } from "pngjs";
import jsQR from "jsqr";
test("浏览器冒烟：注册、创建四题、发布、二维码、跳题填写、修改、统计、关闭", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const username = `browser_${Date.now().toString(36)}`,
    password = "Browser-check-438!";
  await page.goto("/register");
  await expect(page).toHaveTitle("问笺 · 问卷工作台");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "注册并进入工作台" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole("link", { name: "新建问卷", exact: true }).click();
  await expect(page.getByLabel("问卷标题", { exact: true })).toBeVisible();
  await page.getByLabel("问卷标题", { exact: true }).click();
  await page.keyboard.insertText("浏览器完整流程测试");
  await expect(page.getByLabel("问卷标题", { exact: true })).toHaveValue(
    "浏览器完整流程测试",
  );
  await page.getByRole("button", { name: "单选题", exact: true }).click();
  await page.getByLabel("题目标题", { exact: true }).click();
  await page.keyboard.insertText("你是否继续填写？");
  await expect(page.getByLabel("题目标题", { exact: true })).toHaveValue(
    "你是否继续填写？",
  );
  await page.getByLabel("选项 1", { exact: true }).click();
  await page.keyboard.insertText("继续");
  await expect(page.getByLabel("选项 1", { exact: true })).toHaveValue("继续");
  await page.getByLabel("选项 2", { exact: true }).click();
  await page.keyboard.insertText("直接结束");
  await expect(page.getByLabel("选项 2", { exact: true })).toHaveValue(
    "直接结束",
  );
  await page.getByRole("button", { name: "添加条件", exact: true }).click();
  await page.getByLabel("条件选项").selectOption({ label: "直接结束" });
  await page.getByLabel("跳转动作").first().selectOption("end");
  await page.getByRole("button", { name: "多选题", exact: true }).click();
  await page.getByLabel("题目标题", { exact: true }).fill("喜欢哪些活动？");
  await page.getByRole("button", { name: "数字填空", exact: true }).click();
  await page.getByLabel("题目标题", { exact: true }).fill("每天学习小时数");
  await page.getByRole("button", { name: "文本填空", exact: true }).click();
  await page.getByLabel("题目标题", { exact: true }).fill("你的建议");
  await page.getByLabel("此题必答").uncheck();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByText("预览模式 · 不保存答卷")).toBeVisible();
  await page.getByText("直接结束", { exact: true }).click();
  await page.getByRole("button", { name: "完成预览" }).click();
  await expect(page.getByRole("heading", { name: "预览完成" })).toBeVisible();
  const editUrl = page.url().replace("/preview", "/edit");
  await page.goto(editUrl);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "发布问卷", exact: true }).click();
  await expect(page.getByLabel("问卷链接")).toBeVisible();
  await expect(page.getByText(/当前链接使用本机地址/)).toHaveCount(0);
  const url = await page.getByLabel("问卷链接").inputValue();
  await expect(page.getByAltText(/填写二维码/)).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  const png = PNG.sync.read(
    Buffer.from(
      (await page.getByAltText(/填写二维码/).getAttribute("src"))!.split(
        ",",
      )[1],
      "base64",
    ),
  );
  expect(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
  ).toBe(url);
  mkdirSync(".local/qa", { recursive: true });
  await page.screenshot({
    path: ".local/qa/share-desktop.png",
    fullPage: true,
  });
  await page.goto(url);
  await page.getByRole("button", { name: "开始填写", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "你是否继续填写？" }),
  ).toBeVisible();
  await page.getByText("继续", { exact: true }).click();
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "喜欢哪些活动？" }),
  ).toBeVisible();
  await page.getByText("选项 1", { exact: true }).click();
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await page.getByLabel("每天学习小时数").fill("3");
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await page.getByLabel("你的建议").fill("希望活动更丰富");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "回答已收到，谢谢你。" }),
  ).toBeVisible();
  const receiptUrl = page.url();
  await page.getByRole("button", { name: "修改我的答案", exact: true }).click();
  await page.getByText("直接结束", { exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page).toHaveURL(receiptUrl);
  await expect(page.getByText("已修改 1 次，保留同一份答卷")).toBeVisible();
  await page.goto("/dashboard");
  await page.screenshot({
    path: ".local/qa/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "统计", exact: true }).first().click();
  await expect(page.getByText("有效答卷", { exact: true })).toBeVisible();
  await expect(page.getByText("去重填写人数", { exact: true })).toBeVisible();
  await expect(page.getByText("1 份 · 1 人", { exact: true })).toBeVisible();
  await page.screenshot({
    path: ".local/qa/results-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  await page.screenshot({ path: ".local/qa/fill-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  // A fresh, unauthenticated browser must return to the same survey after login.
  const guest = await context
      .browser()!
      .newContext({ viewport: { width: 390, height: 844 } }),
    p = await guest.newPage();
  await p.goto(url);
  await p.getByRole("button", { name: "开始填写", exact: true }).click();
  await expect(p).toHaveURL(/login\?returnTo/);
  await p.getByLabel("用户名", { exact: true }).fill(username);
  await p.getByLabel("密码", { exact: true }).fill(password);
  await p.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(p).toHaveURL(url);
  await expect(
    p.getByRole("link", { name: "查看或修改我的答案" }),
  ).toBeVisible();
  await guest.close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(editUrl.replace("/edit", "/share"));
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "关闭问卷", exact: true }).click();
  await expect(page.getByText("已关闭", { exact: true })).toBeVisible();
  await page.goto(receiptUrl);
  await expect(page.getByRole("button", { name: "修改我的答案" })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
test("浏览器冒烟：允许重复填写时生成新答卷，份数增加但人数保持为1", async ({
  page,
}) => {
  await page.goto("/register");
  await page
    .getByLabel("用户名", { exact: true })
    .fill(`repeat_${Date.now().toString(36)}`);
  await page.getByLabel("密码", { exact: true }).fill("Browser-repeat-843!");
  await page.getByRole("button", { name: "注册并进入工作台" }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.getByRole("link", { name: "新建问卷", exact: true }).click();
  await page.getByLabel("问卷标题", { exact: true }).fill("重复填写浏览器测试");
  await page.getByLabel("允许重复填写，每次生成新答卷").check();
  await page.getByRole("button", { name: "数字填空", exact: true }).click();
  await page.getByLabel("题目标题", { exact: true }).fill("测试数值");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "发布问卷", exact: true }).click();
  const url = await page.getByLabel("问卷链接").inputValue();
  const results = page.url().replace("/share", "/results");
  const receipts: string[] = [];
  for (const value of ["10", "20"]) {
    await page.goto(url);
    await page
      .getByRole("button", {
        name: value === "10" ? "开始填写" : "再填写一次",
        exact: true,
      })
      .click();
    await page.getByLabel("测试数值").fill(value);
    await page.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "回答已收到，谢谢你。" }),
    ).toBeVisible();
    receipts.push(page.url());
  }
  expect(receipts[0]).not.toBe(receipts[1]);
  await page.goto(results);
  await expect(
    page.locator(".results-summary .panel").nth(0).locator("strong"),
  ).toHaveText("2份");
  await expect(
    page.locator(".results-summary .panel").nth(1).locator("strong"),
  ).toHaveText("1人");
  await expect(page.locator(".average strong")).toHaveText("15");
});
