import { describe, expect, it } from "vitest";
import { makeQuestion } from "../database/seed.js";
import { emptyDefinition, replayPath } from "../packages/shared/src/domain.js";
import { prepareProgress } from "../apps/web/src/components/progress.js";

function fixture() {
  const def = emptyDefinition();
  def.questions = [
    makeQuestion("single_choice", "选择路径", 1),
    makeQuestion("text", "至少三个字符", 2),
    makeQuestion("number", "年龄", 3),
  ];
  def.questions[1].validation.minLength = 3;
  return def;
}
describe("填写导航的有效保存前缀", () => {
  it("有效答案规范化后全部保存，刷新可恢复", () => {
    const d = fixture(),
      [a, b, c] = d.questions;
    const p = prepareProgress(d, [
      { questionId: a.id, value: a.options![0].id },
      { questionId: b.id, value: "  有效答案  " },
      { questionId: c.id, value: 0 },
    ]);
    expect(p.hasUnsavedInput).toBe(false);
    expect(p.answers).toEqual(replayPath(d, p.answers).answers);
    expect(p.answers[1].value).toBe("有效答案");
  });
  it("后续无效输入保留在页面，不阻止返回该题修正", () => {
    const d = fixture(),
      [a, b, c] = d.questions;
    const input = [
      { questionId: a.id, value: a.options![0].id },
      { questionId: b.id, value: "短" },
      { questionId: c.id, value: 20 },
    ];
    const p = prepareProgress(d, input);
    expect(p.answers.map((a) => a.questionId)).toEqual([a.id]);
    expect(p.retained.find((a) => a.questionId === b.id)?.value).toBe("短");
    expect(p.retained.find((a) => a.questionId === c.id)?.value).toBe(20);
    expect(p.hasUnsavedInput).toBe(true);
    expect(() => replayPath(d, p.answers, false)).not.toThrow();
  });
  it("修正未完成输入后恢复后续有效答案的保存", () => {
    const d = fixture(),
      [a, b, c] = d.questions;
    const before = prepareProgress(d, [
      { questionId: a.id, value: a.options![0].id },
      { questionId: b.id, value: "短" },
      { questionId: c.id, value: 20 },
    ]);
    const after = prepareProgress(
      d,
      before.retained.map((x) =>
        x.questionId === b.id ? { ...x, value: "修正后的答案" } : x,
      ),
    );
    expect(after.hasUnsavedInput).toBe(false);
    expect(after.answers).toHaveLength(3);
  });
  it("更改分支后移除已跳过的无效输入，允许提前结束", () => {
    const d = fixture(),
      [a, b, c] = d.questions;
    a.logic.defaultAction = { action: "end" };
    const p = prepareProgress(d, [
      { questionId: a.id, value: a.options![0].id },
      { questionId: b.id, value: "短" },
      { questionId: c.id, value: -1 },
    ]);
    expect(p.retained).toHaveLength(1);
    expect(replayPath(d, p.answers).visitedQuestionIds).toEqual([a.id]);
  });
  it("新路径遇到未填必答题时保留后面的页面输入，但不向服务器发送", () => {
    const d = fixture(),
      [a, , c] = d.questions;
    const p = prepareProgress(d, [
      { questionId: a.id, value: a.options![0].id },
      { questionId: c.id, value: 20 },
    ]);
    expect(p.answers).toHaveLength(1);
    expect(p.retained).toHaveLength(2);
    expect(() => replayPath(d, p.answers, false)).not.toThrow();
  });
  it("空的选答题可略过，后续有效答案仍保存", () => {
    const d = fixture(),
      [a, b, c] = d.questions;
    b.required = false;
    const p = prepareProgress(d, [
      { questionId: a.id, value: a.options![0].id },
      { questionId: c.id, value: 20 },
    ]);
    expect(p.hasUnsavedInput).toBe(false);
    expect(p.answers).toHaveLength(2);
    expect(() => replayPath(d, p.answers)).not.toThrow();
  });
});
