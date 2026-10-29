import { describe, expect, it } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// Run the real orchestrator in a temporary project with fake commands. No database
// or build command is executed, including when verifying the backup failure path.
describe.skipIf(process.platform !== "win32")("一键验收的失败保护", () => {
  it.each([
    { fail: "run db:backup", last: "run db:backup", ok: false },
    { fail: "run build", last: "run build", ok: false },
    { fail: "", last: "run test:e2e -- --reporter=list,json", ok: true },
  ])("失败步骤 $fail 后不运行依赖步骤", ({ fail, last, ok }) => {
    const root = mkdtempSync(join(tmpdir(), "survey-acceptance-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "bin"));
      const script = join(root, "scripts/acceptance.ps1");
      copyFileSync(resolve("scripts/acceptance.ps1"), script);
      for (const command of ["node", "git"])
        writeFileSync(
          join(root, "bin", `${command}.cmd`),
          "@echo off\r\nexit /b 0\r\n",
        );
      writeFileSync(
        join(root, "bin/npm.cmd"),
        [
          "@echo off",
          'echo %*>>"%ACCEPT_TEST_CALLS%"',
          'if "%*"=="%ACCEPT_TEST_FAIL%" exit /b 13',
          "exit /b 0",
          "",
        ].join("\r\n"),
      );
      const calls = join(root, "calls.txt");
      const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${join(root, "bin")};${process.env.PATH}`,
            ACCEPT_TEST_FAIL: fail,
            ACCEPT_TEST_CALLS: calls,
          },
          encoding: "utf8",
          timeout: 20000,
          windowsHide: true,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stdout + result.stderr).toBe(ok ? 0 : 1);
      const ran = readFileSync(calls, "utf8").trim().split(/\r?\n/);
      expect(ran.at(-1)).toBe(last);
      if (fail === "run db:backup") expect(ran).not.toContain("run db:init");
      if (fail === "run build") expect(ran).not.toContain("run smoke");
      const qa = join(root, ".local/qa");
      const log = readFileSync(
        join(
          qa,
          readdirSync(qa).find((f) => f.endsWith(".log"))!,
        ),
        "utf8",
      );
      expect(log).toContain("SUMMARY");
      expect(log).toContain(`Failed steps: ${ok ? 0 : 1}`);
      expect(log.includes("STOP:")).toBe(!ok);
    } finally {
      // Only remove the exact temporary project created by this test.
      if (!resolve(root).startsWith(resolve(tmpdir()) + "\\survey-acceptance-"))
        throw new Error("Unexpected acceptance fixture path");
      rmSync(root, { recursive: true, force: true });
    }
  });
});
