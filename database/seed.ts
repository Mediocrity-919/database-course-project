import { randomUUID } from "node:crypto";
import type {
  Definition,
  Question,
  QuestionType,
} from "../packages/shared/src/domain.js";
export function makeQuestion(
  type: QuestionType,
  title: string,
  order: number,
): Question {
  return {
    id: randomUUID(),
    order,
    type,
    title,
    description: "",
    required: true,
    ...(type.includes("choice")
      ? {
          options: [
            { id: randomUUID(), label: "选项 A", order: 1 },
            { id: randomUUID(), label: "选项 B", order: 2 },
          ],
        }
      : {}),
    validation:
      type === "text"
        ? { maxLength: 500 }
        : type === "number"
          ? { min: 0, max: 120, integerOnly: true }
          : type === "multiple_choice"
            ? { minSelections: 1, maxSelections: 2 }
            : {},
    logic: {
      matchMode: "first_match",
      rules: [],
      defaultAction: { action: "next" },
    },
  };
}
export function demoDefinition(): Definition {
  const q1 = makeQuestion("single_choice", "你目前的身份是？", 1);
  q1.options![0].label = "在校学生";
  q1.options![1].label = "已经工作";
  const q2 = makeQuestion("multiple_choice", "你更喜欢哪些学习方式？", 2);
  q2.options![0].label = "阅读与自主练习";
  q2.options![1].label = "讨论与小组协作";
  q2.options!.push({ id: randomUUID(), label: "视频课程", order: 3 });
  const q3 = makeQuestion("number", "你每天用于自主学习的时间是多少小时？", 3);
  q3.validation = { min: 0, max: 24, integerOnly: false };
  const q4 = makeQuestion("text", "你对学习环境有什么建议？", 4);
  q4.required = false;
  q4.validation = { minLength: 2, maxLength: 500 };
  q1.logic.rules = [
    {
      id: randomUUID(),
      priority: 1,
      when: { operator: "eq", value: q1.options![1].id },
      then: { action: "goto", targetQuestionId: q3.id },
    },
  ];
  return {
    title: "学习与生活观察",
    description:
      "每一份回答，都让我们更了解彼此。约需 2 分钟，答案仅用于课程项目展示。",
    settings: {
      allowAnonymous: true,
      allowMultipleSubmissions: false,
      allowEditAfterSubmission: true,
    },
    questions: [q1, q2, q3, q4],
  };
}
