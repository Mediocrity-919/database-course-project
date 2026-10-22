import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("登录不存在的账号引导注册，密码逐项提醒，区分密码错误与用户名重名", async ({
  page,
}) => {
  const username = `auth_ui_${Date.now().toString(36)}`;
  const password = "Valid-password-843!";
  await page.goto("/login?returnTo=%2Fguide");
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("1");
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "该用户名尚未注册，请先创建账号",
  );
  mkdirSync(".local/qa", { recursive: true });
  await page.screenshot({
    path: ".local/qa/login-user-not-found.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: `创建账号「${username}」`, exact: true })
    .click();
  await expect(page.getByLabel("用户名", { exact: true })).toHaveValue(
    username,
  );
  const input = page.getByLabel("密码", { exact: true });
  const submit = page.getByRole("button", {
    name: "注册并进入工作台",
    exact: true,
  });
  for (const [value, missing] of [
    ["abc12345", "大写字母"],
    ["ABC12345", "小写字母"],
    ["Abcdefgh", "数字"],
    ["Ab1", "至少需要 8 个字符"],
  ]) {
    await input.fill(value);
    await submit.click();
    await expect(page.getByRole("alert")).toContainText(missing);
    await expect(page).toHaveURL(/register/);
  }
  await input.fill("abcdefgh");
  await submit.click();
  await expect(page.getByRole("alert")).toContainText("缺少大写字母");
  await expect(page.getByRole("alert")).toContainText("缺少数字");
  await expect(page.locator(".password-requirements .met")).toHaveCount(2);
  await expect(page.locator(".password-requirements .missing")).toHaveCount(2);
  await page.screenshot({
    path: ".local/qa/register-password-rules.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await input.fill(password);
  await expect(page.locator(".password-requirements .met")).toHaveCount(4);
  await submit.click();
  await expect(page).toHaveURL(/guide$/);
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("x");
  await page.getByRole("button", { name: "登录工作台", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("密码错误，请重新输入");
  await expect(
    page.getByRole("link", { name: `创建账号「${username}」`, exact: true }),
  ).toHaveCount(0);
  await page.goto(`/register?username=${username}`);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "注册并进入工作台", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText("用户名已被使用");
});
