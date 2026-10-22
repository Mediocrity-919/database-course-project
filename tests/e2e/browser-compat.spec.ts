import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PNG } from "pngjs";
import jsQR from "jsqr";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50",
});

test("HTTP微信兼容：四类题、选项、跳转、分享、填写及修改在缺少安全上下文API时可用", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Also exercise this path when the suite runs against trusted localhost.
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto("/register");
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
  expect(await page.evaluate(() => typeof crypto.getRandomValues)).toBe(
    "function",
  );
  if (process.env.PLAYWRIGHT_TEST_ORIGIN)
    expect(await page.evaluate(() => isSecureContext)).toBe(false);
  await page
    .getByLabel("用户名", { exact: true })
    .fill(`wechat_${Date.now().toString(36)}`);
  await page.getByLabel("密码", { exact: true }).fill("Wechat-check-438!");
  await page.getByRole("button", { name: "注册并进入工作台" }).click();
  await page.getByRole("link", { name: "新建问卷", exact: true }).click();
  await page.getByLabel("问卷标题", { exact: true }).fill("微信局域网兼容验证");
  await page.getByRole("button", { name: "单选题", exact: true }).click();
  await expect(page.getByLabel("题目标题", { exact: true })).toBeVisible();
  await page.getByLabel("题目标题", { exact: true }).fill("是否继续？");
  await page.getByLabel("选项 1", { exact: true }).fill("继续");
  await page.getByLabel("选项 2", { exact: true }).fill("提前结束");
  await page.getByRole("button", { name: "添加选项", exact: true }).click();
  await page.getByLabel("选项 3", { exact: true }).fill("其他");
  await page.getByRole("button", { name: "添加条件", exact: true }).click();
  await page.getByLabel("条件选项").selectOption({ label: "提前结束" });
  await page.getByLabel("跳转动作").first().selectOption("end");
  await page.getByRole("button", { name: "多选题", exact: true }).click();
  await page.getByLabel("题目标题", { exact: true }).fill("你的选择");
  await page.getByRole("button", { name: "添加选项", exact: true }).click();
  await expect(page.getByLabel("选项 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "添加条件", exact: true }).click();
  await page.getByLabel("跳转动作").first().selectOption("next");
  await page.getByRole("button", { name: "数字填空", exact: true }).click();
  await page.getByLabel("题目标题", { exact: true }).fill("学习小时数");
  await page.getByRole("button", { name: "添加条件", exact: true }).click();
  await page.getByLabel("跳转动作").first().selectOption("next");
  await page.getByRole("button", { name: "文本填空", exact: true }).click();
  await page.getByLabel("题目标题", { exact: true }).fill("填写建议");
  await expect(page.locator(".question-directory .question-tab")).toHaveCount(
    4,
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("草稿已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".question-directory .question-tab")).toHaveCount(
    4,
  );
  const editUrl = page.url();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await page.getByText("提前结束", { exact: true }).click();
  await page.getByRole("button", { name: "完成预览", exact: true }).click();
  await expect(page.getByRole("heading", { name: "预览完成" })).toBeVisible();
  await page.goto(editUrl);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "发布问卷", exact: true }).click();
  const link = page.getByLabel("问卷链接");
  await expect(link).toBeVisible();
  const shareUrl = await link.inputValue();
  const pngUrl = await page.getByAltText(/填写二维码/).getAttribute("src");
  const png = PNG.sync.read(Buffer.from(pngUrl!.split(",")[1], "base64"));
  expect(
    jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data,
  ).toBe(shareUrl);
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await expect(
    page.getByText("链接已选中，请长按或使用系统菜单复制", { exact: true }),
  ).toBeVisible();
  expect(
    await link.evaluate(
      (input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!,
    ),
  ).toBe(shareUrl.length);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync(".local/qa", { recursive: true });
  await page.screenshot({
    path: ".local/qa/wechat-http-share-mobile.png",
    fullPage: true,
  });
  await page.goto(shareUrl);
  await page.getByRole("button", { name: "开始填写", exact: true }).click();
  await page.getByText("继续", { exact: true }).click();
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await page.getByText("选项 1", { exact: true }).click();
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await page.getByLabel("学习小时数").fill("1.5");
  await page.getByRole("button", { name: "保存并继续", exact: true }).click();
  await page.getByLabel("填写建议").fill("微信局域网填写😀");
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "回答已收到，谢谢你。" }),
  ).toBeVisible();
  const receiptUrl = page.url();
  await page.getByRole("button", { name: "修改我的答案", exact: true }).click();
  await page.getByText("提前结束", { exact: true }).click();
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page).toHaveURL(receiptUrl);
  await expect(page.getByText("已修改 1 次，保留同一份答卷")).toBeVisible();
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "统计", exact: true }).first().click();
  await expect(page.getByText("1 份 · 1 人", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
