import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createUuid } from "../apps/web/src/uuid.js";

const getRandomValues = globalThis.crypto.getRandomValues.bind(
  globalThis.crypto,
);
afterEach(() => vi.unstubAllGlobals());

describe("局域网HTTP的UUID兼容", () => {
  it("有原生randomUUID时正常调用", () => {
    const value = "550e8400-e29b-41d4-a716-446655440000";
    vi.stubGlobal("crypto", { randomUUID: () => value });
    expect(createUuid()).toBe(value);
  });
  it("缺少randomUUID时生成符合UUID v4格式及版本/变体的标识", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
    });
    expect(createUuid()).toBe("00000000-0000-4000-8000-000000000000");
    expect(z.string().uuid().safeParse(createUuid()).success).toBe(true);
  });
  it("真实安全随机数回退可连续生成不同且能通过接口校验的UUID", () => {
    vi.stubGlobal("crypto", { getRandomValues });
    const values = Array.from({ length: 100 }, () => createUuid());
    expect(new Set(values).size).toBe(100);
    expect(
      values.every((value) => z.string().uuid().safeParse(value).success),
    ).toBe(true);
    expect(values.every((value) => /^.{14}4.{3}-[89ab]/.test(value))).toBe(
      true,
    );
  });
  it("缺少安全随机数来源时明确失败，不使用Math.random伪造标识", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => createUuid()).toThrow("当前浏览器不支持安全随机数");
  });
});
