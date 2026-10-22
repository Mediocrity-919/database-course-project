import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { demoDefinition, makeQuestion } from "../database/seed.js";
import {
  answerSchema,
  evaluateRule,
  getNextQuestion,
  normalizeValue,
  textAnswerLength,
  replayPath,
  validateDefinition,
  type Rule,
} from "../packages/shared/src/domain.js";
describe("问卷定义与校验", () => {
  it("接受四种题型与有效跳转", () =>
    expect(validateDefinition(demoDefinition(), true).questions).toHaveLength(
      4,
    ));
  it("拒绝空问卷发布，允许保存空草稿", () => {
    const d = demoDefinition();
    d.questions = [];
    expect(() => validateDefinition(d, true)).toThrow();
    expect(() => validateDefinition(d)).not.toThrow();
  });
  it("拒绝重复题目ID", () => {
    const d = demoDefinition();
    d.questions[1].id = d.questions[0].id;
    expect(() => validateDefinition(d, true)).toThrow();
  });
  it("拒绝前向循环与不存在目标", () => {
    const d = demoDefinition();
    d.questions[0].logic.rules[0].then.targetQuestionId = d.questions[0].id;
    expect(() => validateDefinition(d, true)).toThrow();
    d.questions[0].logic.rules[0].then.targetQuestionId = randomUUID();
    expect(() => validateDefinition(d, true)).toThrow();
  });
  it("拒绝数量min>max和超过选项数", () => {
    const d = demoDefinition();
    d.questions[1].validation = { minSelections: 3, maxSelections: 2 };
    expect(() => validateDefinition(d)).toThrow();
    d.questions[1].validation = { maxSelections: 10 };
    expect(() => validateDefinition(d)).toThrow();
  });
  it("拒绝同优先级规则", () => {
    const d = demoDefinition();
    const r = structuredClone(d.questions[0].logic.rules[0]);
    r.id = randomUUID();
    d.questions[0].logic.rules.push(r);
    expect(() => validateDefinition(d)).toThrow();
  });
  it("拒绝重复填写同时启用原答卷编辑", () => {
    const d = demoDefinition();
    d.settings.allowMultipleSubmissions = true;
    expect(() => validateDefinition(d)).toThrow();
  });
  it("拒绝非法操作符、悬空选项及不适用的校验字段", () => {
    const d = demoDefinition();
    d.questions[0].logic.rules[0].when.value = randomUUID();
    expect(() => validateDefinition(d)).toThrow();
    const d2 = demoDefinition();
    d2.questions[0].validation = { minLength: 1 };
    expect(() => validateDefinition(d2)).toThrow();
  });
  it("拒绝空的整数范围", () => {
    const d = demoDefinition();
    d.questions[2].validation = { integerOnly: true, min: 0.1, max: 0.9 };
    expect(() => validateDefinition(d)).toThrow();
  });
  it("文本长度按Unicode码点，规范化首尾与换行", () => {
    const q = makeQuestion("text", "文本", 1);
    q.validation = { minLength: 2, maxLength: 3 };
    expect(normalizeValue(q, " 😀好 ")).toBe("😀好");
    expect(() => normalizeValue(q, "好")).toThrow();
    expect(() => normalizeValue(q, "1234")).toThrow();
  });
  it("答案请求与业务校验均接受2000码点并拒绝2001码点", () => {
    const q = makeQuestion("text", "文本", 1);
    q.validation = { maxLength: 2000 };
    const value = "😀𠀀".repeat(1000);
    expect(answerSchema.parse([{ questionId: q.id, value }])[0].value).toBe(
      value,
    );
    expect(normalizeValue(q, value)).toBe(value);
    expect(textAnswerLength(value)).toBe(2000);
    expect(() =>
      answerSchema.parse([{ questionId: q.id, value: value + "好" }]),
    ).toThrow();
    expect(() => normalizeValue(q, value + "好")).toThrow();
  });
  it("请求上限与界面计数在去除首尾空白及规范化换行之后判断", () => {
    const q = makeQuestion("text", "文本", 1);
    q.validation = { minLength: 2000, maxLength: 2000 };
    const value = ` \r\n${"😀".repeat(999)}\r\n${"𠀀".repeat(1000)}\t `;
    const normalized = `${"😀".repeat(999)}\n${"𠀀".repeat(1000)}`;
    expect(textAnswerLength(value)).toBe(2000);
    expect(answerSchema.parse([{ questionId: q.id, value }])[0].value).toBe(
      value,
    );
    expect(normalizeValue(q, value)).toBe(normalized);
  });
  it("数字0合法，空字符串不转换成0", () => {
    const q = makeQuestion("number", "年龄", 1);
    expect(normalizeValue(q, 0)).toBe(0);
    expect(normalizeValue(q, "")).toBeUndefined();
    expect(() => normalizeValue(q, "12abc")).toThrow();
  });
  it.each([-1, 121, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])(
    "拒绝非法年龄 %s",
    (value) =>
      expect(() =>
        normalizeValue(makeQuestion("number", "年龄", 1), value),
      ).toThrow(),
  );
  it("接受年龄上下边界与可选题空答案", () => {
    const q = makeQuestion("number", "年龄", 1);
    expect(normalizeValue(q, 120)).toBe(120);
    expect(normalizeValue(q, undefined)).toBeUndefined();
  });
  it("多选拒绝重复选项、少选和超选", () => {
    const q = makeQuestion("multiple_choice", "多选", 1);
    q.validation = { minSelections: 2, maxSelections: 2 };
    const [a, b] = q.options!;
    expect(() => normalizeValue(q, [a.id])).toThrow();
    expect(() => normalizeValue(q, [a.id, a.id])).toThrow();
    expect(normalizeValue(q, [b.id, a.id])).toEqual([a.id, b.id].sort());
    expect(normalizeValue(q, [])).toBeUndefined();
  });
});
describe("数据驱动的跳转与路径重放", () => {
  it("单选跳过必答题，后端仅校验实际经过的题", () => {
    const d = demoDefinition(),
      [q1, , q3] = d.questions;
    const out = replayPath(d, [
      { questionId: q1.id, value: q1.options![1].id },
      { questionId: q3.id, value: 0 },
    ]);
    expect(out.visitedQuestionIds).toEqual([q1.id, q3.id, d.questions[3].id]);
  });
  it("必答缺失、重复答案、未知题目、隐藏旧答案均拒绝", () => {
    const d = demoDefinition(),
      [q1, q2, q3] = d.questions;
    expect(() => replayPath(d, [])).toThrow();
    expect(() =>
      replayPath(d, [
        { questionId: q1.id, value: q1.options![0].id },
        { questionId: q1.id, value: q1.options![0].id },
      ]),
    ).toThrow();
    expect(() =>
      replayPath(d, [{ questionId: randomUUID(), value: 2 }]),
    ).toThrow();
    expect(() =>
      replayPath(d, [
        { questionId: q1.id, value: q1.options![1].id },
        { questionId: q2.id, value: [q2.options![0].id] },
        { questionId: q3.id, value: 4 },
      ]),
    ).toThrow();
  });
  it("多选同时命中时使用最低priority", () => {
    const d = demoDefinition(),
      q = d.questions[1],
      r: Rule = {
        id: randomUUID(),
        priority: 2,
        when: { operator: "contains_any", value: [q.options![0].id] },
        then: { action: "goto", targetQuestionId: d.questions[2].id },
      };
    q.logic.rules = [
      r,
      { ...r, id: randomUUID(), priority: 1, then: { action: "end" } },
    ];
    expect(getNextQuestion(d, q, [q.options![0].id])).toBeNull();
  });
  it.each(["contains_any", "contains_all", "equals_set"] as const)(
    "多选集合操作 %s 不受顺序影响",
    (operator) => {
      const r: Rule = {
        id: randomUUID(),
        priority: 1,
        when: { operator, value: ["a", "b"] },
        then: { action: "end" },
      };
      expect(evaluateRule(r, ["b", "a"])).toBe(true);
      expect(evaluateRule(r, undefined)).toBe(false);
    },
  );
  it("数字闭区间和边界比较", () => {
    const rule: Rule = {
      id: randomUUID(),
      priority: 1,
      when: { operator: "between", value: { min: 18, max: 60 } },
      then: { action: "end" },
    };
    expect(evaluateRule(rule, 18)).toBe(true);
    expect(evaluateRule(rule, 60)).toBe(true);
    expect(evaluateRule(rule, 17)).toBe(false);
    rule.when = { operator: "lt", value: 18 };
    expect(evaluateRule(rule, 18)).toBe(false);
    expect(evaluateRule(rule, 17)).toBe(true);
  });
  it("草稿不要求所有必答题已完成", () => {
    const d = demoDefinition();
    expect(replayPath(d, [], false).answers).toHaveLength(0);
  });
});
