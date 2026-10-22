import { z } from "zod";

export type QuestionType =
  "single_choice" | "multiple_choice" | "text" | "number";
export type Value = string | string[] | number;
export interface Answer {
  questionId: string;
  value: Value;
  questionType?: QuestionType;
}
export interface FieldError {
  questionId?: string;
  code: string;
  message: string;
}
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
    public fieldErrors: FieldError[] = [],
  ) {
    super(message);
  }
}
const actionSchema = z
  .object({
    action: z.enum(["next", "goto", "end"]),
    targetQuestionId: z.string().optional(),
  })
  .strict();
const ruleSchema = z
  .object({
    id: z.string().uuid(),
    priority: z.number().int().min(1),
    when: z
      .object({
        operator: z.enum([
          "eq",
          "contains_any",
          "contains_all",
          "equals_set",
          "gt",
          "gte",
          "lt",
          "lte",
          "between",
        ]),
        value: z.union([
          z.string(),
          z.array(z.string()),
          z.number().finite(),
          z
            .object({ min: z.number().finite(), max: z.number().finite() })
            .strict(),
        ]),
      })
      .strict(),
    then: actionSchema,
  })
  .strict();
export const definitionSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(2000),
    settings: z
      .object({
        allowAnonymous: z.boolean(),
        allowMultipleSubmissions: z.boolean(),
        allowEditAfterSubmission: z.boolean(),
      })
      .strict(),
    questions: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            order: z.number().int().positive(),
            type: z.enum([
              "single_choice",
              "multiple_choice",
              "text",
              "number",
            ]),
            title: z.string().trim().min(1).max(500),
            description: z.string().max(2000).default(""),
            required: z.boolean(),
            options: z
              .array(
                z
                  .object({
                    id: z.string().uuid(),
                    label: z.string().trim().min(1).max(200),
                    order: z.number().int().positive(),
                  })
                  .strict(),
              )
              .max(50)
              .optional(),
            validation: z
              .object({
                minSelections: z.number().int().min(0).optional(),
                maxSelections: z.number().int().min(1).optional(),
                minLength: z.number().int().min(0).optional(),
                maxLength: z.number().int().min(1).max(2000).optional(),
                min: z.number().finite().optional(),
                max: z.number().finite().optional(),
                integerOnly: z.boolean().optional(),
              })
              .strict(),
            logic: z
              .object({
                matchMode: z.literal("first_match"),
                rules: z.array(ruleSchema).max(20),
                defaultAction: actionSchema,
              })
              .strict(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type Definition = z.infer<typeof definitionSchema>;
export type Question = Definition["questions"][number];
export type Rule = Question["logic"]["rules"][number];
export type Action = z.infer<typeof actionSchema>;
export function normalizeTextAnswer(value: string): string {
  return value.trim().replace(/\r\n?/g, "\n");
}
export function textAnswerLength(value: string): number {
  return Array.from(normalizeTextAnswer(value)).length;
}
export const answerSchema = z
  .array(
    z
      .object({
        questionId: z.string().uuid(),
        value: z.union([
          // Match the normalized code-point limit used by text questions.
          z.string().refine((value) => textAnswerLength(value) <= 2000, {
            message: "文本答案最多 2000 个字符（不计首尾空白）",
          }),
          z.array(z.string()).max(50),
          z.number().finite(),
        ]),
      })
      .strict(),
  )
  .max(100);

export function emptyDefinition(): Definition {
  return {
    title: "未命名问卷",
    description: "",
    settings: {
      allowAnonymous: true,
      allowMultipleSubmissions: false,
      allowEditAfterSubmission: true,
    },
    questions: [],
  };
}
export function orderedQuestions(def: Definition) {
  return [...def.questions].sort((a, b) => a.order - b.order);
}
export function validateDefinition(
  input: unknown,
  publish = false,
): Definition {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      "DEFINITION_INVALID",
      "问卷结构或字段不符合要求",
      422,
      parsed.error.issues.map((x) => ({
        code: "SCHEMA",
        message: `${x.path.join(".")}: ${x.message}`,
      })),
    );
  const def = parsed.data;
  const errors: FieldError[] = [];
  if (publish && !def.questions.length)
    errors.push({ code: "NO_QUESTIONS", message: "至少添加一道题目后再发布" });
  if (
    def.settings.allowMultipleSubmissions &&
    def.settings.allowEditAfterSubmission
  )
    errors.push({
      code: "POLICY",
      message: "重复填写模式下请关闭原答卷修改，使用再填一次",
    });
  const ids = new Set(def.questions.map((q) => q.id));
  if (
    ids.size !== def.questions.length ||
    new Set(def.questions.map((q) => q.order)).size !== def.questions.length
  )
    errors.push({
      code: "DUPLICATE_QUESTION",
      message: "题目 ID 和顺序必须唯一",
    });
  for (const q of def.questions) {
    const err = (message: string) =>
      errors.push({ questionId: q.id, code: "QUESTION_CONFIG", message });
    const v = q.validation,
      opts = q.options ?? [];
    const choice = q.type === "single_choice" || q.type === "multiple_choice";
    if (
      choice &&
      (opts.length < 2 ||
        new Set(opts.map((o) => o.id)).size !== opts.length ||
        new Set(opts.map((o) => o.label)).size !== opts.length ||
        new Set(opts.map((o) => o.order)).size !== opts.length)
    )
      err("选择题至少有两个选项，选项 ID、文字和顺序不得重复");
    if (!choice && opts.length) err("填空题不能包含选项");
    const allowed =
      q.type === "multiple_choice"
        ? ["minSelections", "maxSelections"]
        : q.type === "text"
          ? ["minLength", "maxLength"]
          : q.type === "number"
            ? ["min", "max", "integerOnly"]
            : [];
    if (Object.keys(v).some((k) => !allowed.includes(k)))
      err("校验字段不适用于当前题型");
    if (
      q.type === "multiple_choice" &&
      ((v.minSelections ?? 0) > (v.maxSelections ?? opts.length) ||
        (v.maxSelections ?? opts.length) > opts.length)
    )
      err("最少选择数、最多选择数和选项数不一致");
    if ((v.minLength ?? 0) > (v.maxLength ?? 2000))
      err("最小长度不能大于最大长度");
    if (
      (v.min ?? -Infinity) > (v.max ?? Infinity) ||
      (v.integerOnly &&
        Math.ceil(v.min ?? -Number.MAX_SAFE_INTEGER) >
          Math.floor(v.max ?? Number.MAX_SAFE_INTEGER))
    )
      err("数值范围无有效值");
    const checkAction = (a: Action) => {
      if (a.action === "goto") {
        const target = def.questions.find((t) => t.id === a.targetQuestionId);
        if (!target || target.order <= q.order)
          err("跳转目标必须是存在的后续题目");
      } else if (a.targetQuestionId) err("下一题或结束动作不能包含跳转目标");
    };
    checkAction(q.logic.defaultAction);
    if (
      new Set(q.logic.rules.map((r) => r.id)).size !== q.logic.rules.length ||
      new Set(q.logic.rules.map((r) => r.priority)).size !==
        q.logic.rules.length
    )
      err("规则 ID 和优先级必须唯一");
    for (const rule of q.logic.rules) {
      checkAction(rule.then);
      const { operator: op, value } = rule.when;
      if (q.type === "text") err("文本题不支持条件跳转");
      if (
        q.type === "single_choice" &&
        (op !== "eq" ||
          typeof value !== "string" ||
          !opts.some((o) => o.id === value))
      )
        err("单选跳转需指定本题的有效选项");
      if (
        q.type === "multiple_choice" &&
        (!["contains_any", "contains_all", "equals_set"].includes(op) ||
          !Array.isArray(value) ||
          !value.length ||
          new Set(value).size !== value.length ||
          value.some((id) => !opts.some((o) => o.id === id)))
      )
        err("多选规则需指定本题的不重复选项集合");
      if (
        q.type === "number" &&
        (!["eq", "gt", "gte", "lt", "lte", "between"].includes(op) ||
          (op === "between"
            ? typeof value !== "object" ||
              Array.isArray(value) ||
              value.min > value.max
            : typeof value !== "number"))
      )
        err("数字跳转的比较符或比较值无效");
    }
  }
  if (errors.length)
    throw new DomainError(
      "DEFINITION_INVALID",
      "请检查题目和跳转配置",
      422,
      errors,
    );
  return def;
}
export function normalizeValue(
  q: Question,
  raw: Value | undefined,
): Value | undefined {
  const empty =
    raw === undefined ||
    raw === "" ||
    (Array.isArray(raw) && raw.length === 0) ||
    (typeof raw === "string" && !raw.trim());
  if (empty) return undefined;
  const fail = (message: string): never => {
    throw new DomainError("ANSWER_INVALID", message, 422, [
      { questionId: q.id, code: "ANSWER_INVALID", message },
    ]);
  };
  const v = q.validation;
  if (q.type === "single_choice") {
    if (typeof raw !== "string" || !q.options?.some((o) => o.id === raw))
      fail("请选择本题的有效选项");
    return raw;
  }
  if (q.type === "multiple_choice") {
    if (!Array.isArray(raw)) return fail("请选择有效选项");
    if (
      new Set(raw).size !== raw.length ||
      raw.some((id) => !q.options?.some((o) => o.id === id))
    )
      fail("选项不存在或包含重复选项");
    if (
      raw.length < (v.minSelections ?? 0) ||
      raw.length > (v.maxSelections ?? q.options!.length)
    )
      fail(
        `请选择 ${v.minSelections ?? 0}～${v.maxSelections ?? q.options!.length} 项`,
      );
    return [...raw].sort();
  }
  if (q.type === "text") {
    if (typeof raw !== "string") return fail("请输入文本");
    const value = normalizeTextAnswer(raw);
    const length = textAnswerLength(value);
    if (length < (v.minLength ?? 0) || length > (v.maxLength ?? 2000))
      fail(`请输入 ${v.minLength ?? 0}～${v.maxLength ?? 2000} 个字符`);
    return value;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw))
    return fail("请输入有效数字");
  if (v.integerOnly && !Number.isSafeInteger(raw))
    fail("请输入安全范围内的整数");
  if (raw < (v.min ?? -Infinity) || raw > (v.max ?? Infinity))
    fail(`数值应在 ${v.min ?? "不限"}～${v.max ?? "不限"} 之间`);
  return raw;
}
export function evaluateRule(rule: Rule, value: Value | undefined): boolean {
  if (value === undefined) return false;
  const c = rule.when.value;
  switch (rule.when.operator) {
    case "eq":
      return value === c;
    case "contains_any":
      return (
        Array.isArray(value) &&
        Array.isArray(c) &&
        c.some((x) => value.includes(x))
      );
    case "contains_all":
      return (
        Array.isArray(value) &&
        Array.isArray(c) &&
        c.every((x) => value.includes(x))
      );
    case "equals_set":
      return (
        Array.isArray(value) &&
        Array.isArray(c) &&
        value.length === c.length &&
        c.every((x) => value.includes(x))
      );
    case "gt":
      return typeof value === "number" && typeof c === "number" && value > c;
    case "gte":
      return typeof value === "number" && typeof c === "number" && value >= c;
    case "lt":
      return typeof value === "number" && typeof c === "number" && value < c;
    case "lte":
      return typeof value === "number" && typeof c === "number" && value <= c;
    case "between":
      return (
        typeof value === "number" &&
        typeof c === "object" &&
        !Array.isArray(c) &&
        value >= c.min &&
        value <= c.max
      );
  }
}
export function getNextQuestion(
  def: Definition,
  q: Question,
  value: Value | undefined,
): string | null {
  const action =
    [...q.logic.rules]
      .sort((a, b) => a.priority - b.priority)
      .find((r) => evaluateRule(r, value))?.then ?? q.logic.defaultAction;
  if (action.action === "end") return null;
  if (action.action === "goto") return action.targetQuestionId!;
  const qs = orderedQuestions(def);
  return qs[qs.findIndex((x) => x.id === q.id) + 1]?.id ?? null;
}
export function replayPath(def: Definition, input: Answer[], complete = true) {
  const byId = new Map<string, Answer>();
  for (const a of input) {
    if (byId.has(a.questionId))
      throw new DomainError("DUPLICATE_ANSWER", "同一道题不能重复提交");
    const q = def.questions.find((q) => q.id === a.questionId);
    if (!q) throw new DomainError("UNKNOWN_QUESTION", "答案包含不存在的题目");
    const value = normalizeValue(q, a.value);
    if (value !== undefined)
      byId.set(q.id, { questionId: q.id, questionType: q.type, value });
  }
  const visitedQuestionIds: string[] = [],
    answers: Answer[] = [];
  let id: string | null = orderedQuestions(def)[0]?.id ?? null;
  while (id) {
    if (
      visitedQuestionIds.includes(id) ||
      visitedQuestionIds.length >= def.questions.length
    )
      throw new DomainError("LOGIC_CYCLE", "跳转出现循环");
    const q = def.questions.find((q) => q.id === id)!;
    visitedQuestionIds.push(id);
    const a = byId.get(id);
    if (!a && q.required) {
      if (complete)
        throw new DomainError("ANSWER_REQUIRED", "请完成必答题", 422, [
          {
            questionId: q.id,
            code: "ANSWER_REQUIRED",
            message: "此题为必答题",
          },
        ]);
      else break;
    }
    if (a) answers.push(a);
    id = getNextQuestion(def, q, a?.value);
  }
  if ([...byId.keys()].some((id) => !visitedQuestionIds.includes(id)))
    throw new DomainError("UNREACHABLE_ANSWER", "请清除已被跳过题目的答案");
  return { answers, visitedQuestionIds };
}
