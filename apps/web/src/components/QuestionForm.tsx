import type {
  Question,
  QuestionType,
} from "../../../../packages/shared/src/domain.js";
import { Button } from "../ui.js";
import { createQuestion } from "../pages/Editor.js";
import { createUuid } from "../uuid.js";

const labels: Record<QuestionType, string> = {
  single_choice: "单选题",
  multiple_choice: "多选题",
  text: "文本填空",
  number: "数字填空",
};
// Content editor for a reusable library item (no survey jump logic).
export function QuestionForm({
  value: q,
  onChange,
}: {
  value: Question;
  onChange: (q: Question) => void;
}) {
  const choice = q.type.includes("choice");
  const keys =
    q.type === "number"
      ? ["min", "max"]
      : q.type === "text"
        ? ["minLength", "maxLength"]
        : q.type === "multiple_choice"
          ? ["minSelections", "maxSelections"]
          : [];
  const names: Record<string, string> = {
    min: "最小值",
    max: "最大值",
    minLength: "最少字符",
    maxLength: "最多字符",
    minSelections: "最少选择",
    maxSelections: "最多选择",
  };
  return (
    <div className="library-fields">
      <label>
        常用题标题
        <input
          value={q.title}
          onFocus={(e) => {
            if (Object.values(labels).some((label) => q.title === `新${label}`))
              e.currentTarget.select();
          }}
          onChange={(e) => onChange({ ...q, title: e.target.value })}
          maxLength={500}
        />
      </label>
      <label>
        常用题类型
        <select
          value={q.type}
          onChange={(e) =>
            onChange({
              ...createQuestion(e.target.value as QuestionType, 1),
              title: q.title,
              description: q.description,
            })
          }
        >
          {Object.entries(labels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        题目说明
        <textarea
          value={q.description}
          onChange={(e) => onChange({ ...q, description: e.target.value })}
          maxLength={2000}
        />
      </label>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={q.required}
          onChange={(e) => onChange({ ...q, required: e.target.checked })}
        />
        此题必答
      </label>
      {choice && (
        <div>
          {q.options?.map((o, i) => (
            <div className="library-option" key={o.id}>
              <label>
                选项 {i + 1}
                <input
                  value={o.label}
                  onFocus={(e) => {
                    if (/^选项 [1-9]\d*$/.test(o.label))
                      e.currentTarget.select();
                  }}
                  maxLength={200}
                  onChange={(e) =>
                    onChange({
                      ...q,
                      options: q.options!.map((x) =>
                        x.id === o.id ? { ...x, label: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <Button
                variant="secondary"
                disabled={q.options!.length <= 2}
                onClick={() =>
                  onChange({
                    ...q,
                    options: q
                      .options!.filter((x) => x.id !== o.id)
                      .map((x, i) => ({ ...x, order: i + 1 })),
                  })
                }
              >
                删除选项
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={(q.options?.length ?? 0) >= 50}
            onClick={() =>
              onChange({
                ...q,
                options: [
                  ...q.options!,
                  { id: createUuid(), label: "", order: q.options!.length + 1 },
                ],
              })
            }
          >
            添加选项
          </Button>
        </div>
      )}
      <div className="settings-grid">
        {keys.map((k) => (
          <label key={k}>
            {names[k]}
            <input
              type="number"
              value={(q.validation as any)[k] ?? ""}
              onChange={(e) => {
                const validation = { ...q.validation };
                if (e.target.value === "") delete (validation as any)[k];
                else (validation as any)[k] = Number(e.target.value);
                onChange({ ...q, validation });
              }}
            />
          </label>
        ))}
      </div>
      {q.type === "number" && (
        <label className="inline-check">
          <input
            type="checkbox"
            checked={q.validation.integerOnly ?? false}
            onChange={(e) =>
              onChange({
                ...q,
                validation: { ...q.validation, integerOnly: e.target.checked },
              })
            }
          />
          必须为整数
        </label>
      )}
    </div>
  );
}
